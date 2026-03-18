// config.ts — Environment variable loading and validation
// Loads .env via dotenv and exports a validated config object.
// Throws on startup if any required variable is missing.

import dotenv from "dotenv";
import fs from "fs";

dotenv.config();

export interface RepoRef {
  owner: string;
  repo: string;
}

export interface Config {
  port: number;
  anthropicApiKey: string;
  githubAppId: string;
  githubWebhookSecret: string;
  githubPrivateKey: string;
  githubRepos: RepoRef[];
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function parseRepos(raw: string): RepoRef[] {
  const repos: RepoRef[] = [];

  for (const entry of raw.split(",")) {
    const trimmed = entry.trim();
    if (!trimmed) continue;

    const parts = trimmed.split("/");
    if (parts.length !== 2 || !parts[0] || !parts[1]) {
      throw new Error(
        `GITHUB_REPOS: each entry must be "owner/repo", got: "${trimmed}"`
      );
    }
    repos.push({ owner: parts[0], repo: parts[1] });
  }

  if (repos.length === 0) {
    throw new Error(
      "GITHUB_REPOS must contain at least one repository (e.g. owner/repo1,owner/repo2)"
    );
  }

  return repos;
}

/** Load and validate all required environment variables. */
export function loadConfig(): Config {
  const anthropicApiKey = requireEnv("ANTHROPIC_API_KEY");
  const githubAppId = requireEnv("GITHUB_APP_ID");
  const githubWebhookSecret = requireEnv("GITHUB_WEBHOOK_SECRET");
  const githubPrivateKeyPath = requireEnv("GITHUB_PRIVATE_KEY_PATH");
  const githubReposRaw = requireEnv("GITHUB_REPOS");

  const port = parseInt(process.env.PORT || "3000", 10);
  if (isNaN(port)) {
    throw new Error("PORT must be a valid number");
  }

  // Read private key from file
  if (!fs.existsSync(githubPrivateKeyPath)) {
    throw new Error(
      `GitHub private key file not found: ${githubPrivateKeyPath}`
    );
  }
  const githubPrivateKey = fs.readFileSync(githubPrivateKeyPath, "utf-8");

  const githubRepos = parseRepos(githubReposRaw);

  return {
    port,
    anthropicApiKey,
    githubAppId,
    githubWebhookSecret,
    githubPrivateKey,
    githubRepos,
  };
}
