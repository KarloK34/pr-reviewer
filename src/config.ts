import dotenv from "dotenv";

dotenv.config();

export interface RepoRef {
  owner: string;
  repo: string;
}

export interface GitLabConfig {
  url: string;
  accessToken: string;
  webhookSecret: string;
  repos: string[];
}

export interface Config {
  anthropicApiKey: string;
}

export function loadConfig(): Config {
  const anthropicApiKey = process.env.ANTHROPIC_API_KEY;
  if (!anthropicApiKey) throw new Error("Missing required environment variable: ANTHROPIC_API_KEY");
  return { anthropicApiKey };
}
