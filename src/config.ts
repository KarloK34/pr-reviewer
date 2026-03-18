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

export interface GitLabConfig {
  url: string; // Base URL, e.g. "https://gitlab.com" or "https://gitlab.company.com"
  accessToken: string;
  webhookSecret: string;
  repos: string[]; // "namespace/repo" format
}

export interface Config {
  port: number;
  anthropicApiKey: string;
  githubAppId: string;
  githubWebhookSecret: string;
  githubPrivateKey: string;
  githubRepos: RepoRef[];
  gitlab: GitLabConfig | null;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function parseRepos(raw: string, envName: string): RepoRef[] {
  const repos: RepoRef[] = [];

  for (const entry of raw.split(",")) {
    const trimmed = entry.trim();
    if (!trimmed) continue;

    const parts = trimmed.split("/");
    if (parts.length !== 2 || !parts[0] || !parts[1]) {
      throw new Error(
        `${envName}: each entry must be "owner/repo", got: "${trimmed}"`
      );
    }
    repos.push({ owner: parts[0], repo: parts[1] });
  }

  if (repos.length === 0) {
    throw new Error(
      `${envName} must contain at least one repository (e.g. owner/repo1,owner/repo2)`
    );
  }

  return repos;
}

function parseGitLabRepos(raw: string): string[] {
  const repos: string[] = [];

  for (const entry of raw.split(",")) {
    const trimmed = entry.trim();
    if (!trimmed) continue;

    if (!trimmed.includes("/")) {
      throw new Error(
        `GITLAB_REPOS: each entry must be "namespace/repo", got: "${trimmed}"`
      );
    }
    repos.push(trimmed);
  }

  if (repos.length === 0) {
    throw new Error(
      "GITLAB_REPOS must contain at least one repository (e.g. namespace/repo1,namespace/repo2)"
    );
  }

  return repos;
}

function loadGitLabConfig(): GitLabConfig | null {
  const accessToken = process.env.GITLAB_ACCESS_TOKEN;
  const webhookSecret = process.env.GITLAB_WEBHOOK_SECRET;
  const reposRaw = process.env.GITLAB_REPOS;

  // All three must be set to enable GitLab support
  if (!accessToken && !webhookSecret && !reposRaw) {
    return null;
  }

  if (!accessToken || !webhookSecret || !reposRaw) {
    const missing = [
      !accessToken && "GITLAB_ACCESS_TOKEN",
      !webhookSecret && "GITLAB_WEBHOOK_SECRET",
      !reposRaw && "GITLAB_REPOS",
    ].filter(Boolean);
    throw new Error(
      `Partial GitLab configuration: missing ${missing.join(", ")}. Set all GITLAB_* variables or none.`
    );
  }

  // Default to gitlab.com, strip trailing slash
  const url = (process.env.GITLAB_URL || "https://gitlab.com").replace(
    /\/+$/,
    ""
  );

  return {
    url,
    accessToken,
    webhookSecret,
    repos: parseGitLabRepos(reposRaw),
  };
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

  const githubRepos = parseRepos(githubReposRaw, "GITHUB_REPOS");
  const gitlab = loadGitLabConfig();

  if (gitlab) {
    console.log(
      `[config] GitLab support enabled for ${gitlab.repos.length} repo(s)`
    );
  }

  return {
    port,
    anthropicApiKey,
    githubAppId,
    githubWebhookSecret,
    githubPrivateKey,
    githubRepos,
    gitlab,
  };
}
