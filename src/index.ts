// index.ts — Entry point
// Loads config, initializes clients, and starts the Express server
// with the webhook endpoint.

import express from "express";
import { loadConfig } from "./config";
import { createWebhookRouter } from "./webhook";

function main(): void {
  const config = loadConfig();

  const app = express();

  // Mount webhook router before express.json() — it uses express.raw() internally
  // so it can verify the HMAC signature against the raw body.
  app.use("/webhook", createWebhookRouter(config));

  // Parse JSON for all other routes
  app.use(express.json());

  // Health check
  app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  app.listen(config.port, () => {
    console.log(`pr-reviewer listening on port ${config.port}`);
  });
}

main();
