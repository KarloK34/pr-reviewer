// webhook.ts — GitHub webhook event handler
// Receives incoming webhook POST requests, verifies the signature,
// and dispatches pull_request events to the review pipeline.

import crypto from "crypto";
import express, { Request, Response, Router } from "express";
import { Config } from "./config";
import { handlePRReview, PREvent } from "./github";

/** Verify the webhook signature using HMAC SHA-256. */
function verifySignature(
  payload: Buffer,
  signature: string,
  secret: string
): boolean {
  const expected =
    "sha256=" +
    crypto.createHmac("sha256", secret).update(payload).digest("hex");
  return crypto.timingSafeEqual(
    Buffer.from(expected),
    Buffer.from(signature)
  );
}

/** Create the webhook router. Uses express.raw() to preserve the raw body for signature verification. */
export function createWebhookRouter(config: Config): Router {
  const router = Router();

  // Parse body as raw buffer so we can verify the HMAC before trusting the payload
  router.use(express.raw({ type: "application/json" }));

  router.post("/", (req: Request, res: Response) => {
    const event = req.headers["x-github-event"] as string | undefined;
    const signature = req.headers["x-hub-signature-256"] as string | undefined;
    const deliveryId = req.headers["x-github-delivery"] as string | undefined;

    console.log(
      `[webhook] Received event=${event ?? "unknown"} delivery=${deliveryId ?? "unknown"}`
    );

    // Verify signature
    if (!signature) {
      console.error("[webhook] Missing x-hub-signature-256 header");
      res.status(401).json({ error: "Missing signature" });
      return;
    }

    const rawBody = req.body as Buffer;
    if (!verifySignature(rawBody, signature, config.githubWebhookSecret)) {
      console.error("[webhook] Invalid signature");
      res.status(401).json({ error: "Invalid signature" });
      return;
    }

    // Parse the verified payload
    let payload: Record<string, any>;
    try {
      payload = JSON.parse(rawBody.toString("utf-8"));
    } catch {
      console.error("[webhook] Failed to parse JSON body");
      res.status(400).json({ error: "Invalid JSON" });
      return;
    }

    // Only process pull_request events
    if (event !== "pull_request") {
      console.log(`[webhook] Ignoring event: ${event}`);
      res.status(200).json({ ignored: true, reason: `event: ${event}` });
      return;
    }

    const action: string = payload.action;
    if (action !== "opened" && action !== "synchronize") {
      console.log(`[webhook] Ignoring pull_request action: ${action}`);
      res
        .status(200)
        .json({ ignored: true, reason: `action: ${action}` });
      return;
    }

    const pr = payload.pull_request;
    const prEvent: PREvent = {
      number: pr.number,
      title: pr.title,
      author: pr.user.login,
      baseBranch: pr.base.ref,
      headBranch: pr.head.ref,
      repoFullName: payload.repository.full_name,
    };

    console.log(
      `[webhook] Processing PR #${prEvent.number} "${prEvent.title}" by ${prEvent.author} (${prEvent.headBranch} → ${prEvent.baseBranch})`
    );

    // Fire and forget — respond immediately so GitHub doesn't time out
    res.status(200).json({ received: true, pr: prEvent.number });

    handlePRReview(prEvent).catch((err) => {
      console.error(
        `[webhook] Error reviewing PR #${prEvent.number}:`,
        err
      );
    });
  });

  return router;
}
