// index.ts — Entry point
// Loads config, initializes clients, and starts the Express server
// with the webhook endpoint.

import express from "express";
import { loadConfig } from "./config";
import { handleWebhook } from "./webhook";

function main(): void {
  const config = loadConfig();

  const app = express();

  // Parse JSON bodies (needed for webhook payloads)
  app.use(express.json());

  // Health check
  app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  // GitHub webhook endpoint
  app.post("/webhook", handleWebhook);

  app.listen(config.port, () => {
    console.log(`pr-reviewer listening on port ${config.port}`);
  });
}

main();
