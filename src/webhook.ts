// webhook.ts — GitHub webhook event handler
// Receives incoming webhook POST requests, verifies the signature,
// and dispatches pull_request events to the review pipeline.

import { Request, Response } from "express";

/** Verify the webhook signature using the shared secret. */
export function verifyWebhookSignature(
  payload: string,
  signature: string,
  secret: string
): boolean {
  // TODO: Compute HMAC-SHA256 of payload with secret,
  // compare against the X-Hub-Signature-256 header value.
  throw new Error("Not implemented");
}

/** Handle incoming GitHub webhook requests. */
export async function handleWebhook(
  req: Request,
  res: Response
): Promise<void> {
  // TODO:
  // 1. Verify signature via verifyWebhookSignature
  // 2. Check event type (X-GitHub-Event header) — only process "pull_request"
  // 3. Check action — only process "opened" and "synchronize"
  // 4. Extract PR number, call fetchPRDiff, then reviewDiff, then postReview
  // 5. Respond 200 on success, 4xx/5xx on error
}
