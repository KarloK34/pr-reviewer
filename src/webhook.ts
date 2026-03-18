// webhook.ts — Webhook event handlers for GitHub and GitLab
// Receives incoming webhook POST requests, verifies authenticity,
// and dispatches events to the review pipeline.

import crypto from "crypto";
import express, { Request, Response, Router } from "express";
import { Config } from "./config";
import { handlePRReview, PREvent } from "./github";
import { handleMRReview, MREvent } from "./gitlab";

/** Verify the GitHub webhook signature using HMAC SHA-256. */
function verifyGitHubSignature(
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

/** Create the webhook router with GitHub and GitLab endpoints. */
export function createWebhookRouter(config: Config): Router {
  const router = Router();

  // Parse body as raw buffer so we can verify HMACs before trusting the payload
  router.use(express.raw({ type: "application/json" }));

  // --- GitHub: POST /webhook ---
  router.post("/", (req: Request, res: Response) => {
    const event = req.headers["x-github-event"] as string | undefined;
    const signature = req.headers["x-hub-signature-256"] as string | undefined;
    const deliveryId = req.headers["x-github-delivery"] as string | undefined;

    console.log(
      `[webhook/github] Received event=${event ?? "unknown"} delivery=${deliveryId ?? "unknown"}`
    );

    // Verify signature
    if (!signature) {
      console.error("[webhook/github] Missing x-hub-signature-256 header");
      res.status(401).json({ error: "Missing signature" });
      return;
    }

    const rawBody = req.body as Buffer;
    if (!verifyGitHubSignature(rawBody, signature, config.githubWebhookSecret)) {
      console.error("[webhook/github] Invalid signature");
      res.status(401).json({ error: "Invalid signature" });
      return;
    }

    // Parse the verified payload
    let payload: Record<string, any>;
    try {
      payload = JSON.parse(rawBody.toString("utf-8"));
    } catch {
      console.error("[webhook/github] Failed to parse JSON body");
      res.status(400).json({ error: "Invalid JSON" });
      return;
    }

    // Only process pull_request events
    if (event !== "pull_request") {
      console.log(`[webhook/github] Ignoring event: ${event}`);
      res.status(200).json({ ignored: true, reason: `event: ${event}` });
      return;
    }

    // Check if the repo is in the allowed list
    const repoFullName: string = payload.repository?.full_name ?? "";
    const allowedRepos = config.githubRepos.map(
      (r) => `${r.owner}/${r.repo}`
    );
    if (!allowedRepos.includes(repoFullName)) {
      console.log(
        `[webhook/github] Repo "${repoFullName}" is not in the allowed list, skipping`
      );
      res
        .status(200)
        .json({ ignored: true, reason: `repo not allowed: ${repoFullName}` });
      return;
    }

    const action: string = payload.action;
    if (action !== "opened" && action !== "synchronize") {
      console.log(`[webhook/github] Ignoring pull_request action: ${action}`);
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
      `[webhook/github] Processing PR #${prEvent.number} "${prEvent.title}" by ${prEvent.author} (${prEvent.headBranch} → ${prEvent.baseBranch})`
    );

    // Fire and forget — respond immediately so GitHub doesn't time out
    res.status(200).json({ received: true, pr: prEvent.number });

    handlePRReview(prEvent).catch((err) => {
      console.error(
        `[webhook/github] Error reviewing PR #${prEvent.number}:`,
        err
      );
    });
  });

  // --- GitLab: POST /webhook/gitlab ---
  router.post("/gitlab", (req: Request, res: Response) => {
    if (!config.gitlab) {
      console.log("[webhook/gitlab] GitLab support is not configured");
      res.status(404).json({ error: "GitLab support not configured" });
      return;
    }

    const gitlabToken = req.headers["x-gitlab-token"] as string | undefined;
    const gitlabEvent = req.headers["x-gitlab-event"] as string | undefined;

    console.log(
      `[webhook/gitlab] Received event="${gitlabEvent ?? "unknown"}"`
    );

    // Verify token
    if (!gitlabToken || gitlabToken !== config.gitlab.webhookSecret) {
      console.error("[webhook/gitlab] Invalid or missing X-Gitlab-Token");
      res.status(401).json({ error: "Invalid token" });
      return;
    }

    // Parse the payload
    const rawBody = req.body as Buffer;
    let payload: Record<string, any>;
    try {
      payload = JSON.parse(rawBody.toString("utf-8"));
    } catch {
      console.error("[webhook/gitlab] Failed to parse JSON body");
      res.status(400).json({ error: "Invalid JSON" });
      return;
    }

    // Only process Merge Request Hook events
    if (gitlabEvent !== "Merge Request Hook") {
      console.log(`[webhook/gitlab] Ignoring event: ${gitlabEvent}`);
      res
        .status(200)
        .json({ ignored: true, reason: `event: ${gitlabEvent}` });
      return;
    }

    const attrs = payload.object_attributes;
    const action: string = attrs?.action ?? "";
    if (action !== "open" && action !== "update") {
      console.log(`[webhook/gitlab] Ignoring MR action: ${action}`);
      res.status(200).json({ ignored: true, reason: `action: ${action}` });
      return;
    }

    // Check if the repo is in the allowed list
    const projectPath: string = payload.project?.path_with_namespace ?? "";
    if (!config.gitlab.repos.includes(projectPath)) {
      console.log(
        `[webhook/gitlab] Repo "${projectPath}" is not in the allowed list, skipping`
      );
      res
        .status(200)
        .json({ ignored: true, reason: `repo not allowed: ${projectPath}` });
      return;
    }

    const mrEvent: MREvent = {
      iid: attrs.iid,
      title: attrs.title,
      author: payload.user?.username ?? attrs.author_id?.toString() ?? "unknown",
      sourceBranch: attrs.source_branch,
      targetBranch: attrs.target_branch,
      projectId: payload.project.id,
      projectPath,
    };

    console.log(
      `[webhook/gitlab] Processing MR !${mrEvent.iid} "${mrEvent.title}" by ${mrEvent.author} (${mrEvent.sourceBranch} → ${mrEvent.targetBranch})`
    );

    // Fire and forget
    res.status(200).json({ received: true, mr: mrEvent.iid });

    handleMRReview(mrEvent, config.gitlab).catch((err) => {
      console.error(
        `[webhook/gitlab] Error reviewing MR !${mrEvent.iid}:`,
        err
      );
    });
  });

  return router;
}
