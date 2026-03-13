// config.ts — Environment variable loading and validation
// Loads .env via dotenv and exports a validated config object.
// Throws on startup if any required variable is missing.

import dotenv from "dotenv";

dotenv.config();

export interface Config {
  port: number;
  anthropicApiKey: string;
  githubAppId: string;
  githubWebhookSecret: string;
  githubPrivateKeyPath: string;
  githubRepo: string;
}

/** Load and validate all required environment variables. */
export function loadConfig(): Config {
  // TODO: Read from process.env, validate presence, return Config
  throw new Error("Not implemented");
}
