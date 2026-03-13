// index.ts — Entry point
// Loads config, initializes clients, and starts the Express server
// with the webhook endpoint.

import express from "express";
import { loadConfig } from "./config";
import { createGitHubClient } from "./github";
import { createReviewerClient } from "./reviewer";
import { handleWebhook } from "./webhook";

function main(): void {
  // TODO:
  // 1. Load and validate config via loadConfig()
  // 2. Initialize GitHub client via createGitHubClient()
  // 3. Initialize Anthropic client via createReviewerClient()
  // 4. Create Express app
  // 5. Register POST /webhook route → handleWebhook
  // 6. Start listening on config.port
}

main();
