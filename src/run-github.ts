import * as core from "@actions/core";
import * as github from "@actions/github";
import * as fs from "fs";
import { handlePRReview } from "./github.js";

async function run(): Promise<void> {
  const pr = github.context.payload.pull_request;
  if (!pr) {
    core.info("Not a pull_request event, skipping.");
    return;
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    core.setFailed("ANTHROPIC_API_KEY is not set");
    return;
  }
  if (!process.env.GITHUB_TOKEN) {
    core.setFailed("GITHUB_TOKEN is not set");
    return;
  }

  const promptFile = process.env.SYSTEM_PROMPT_FILE;
  if (!promptFile) {
    core.setFailed("SYSTEM_PROMPT_FILE is not set");
    return;
  }
  if (!fs.existsSync(promptFile)) {
    core.setFailed(`System prompt file not found: ${promptFile}`);
    return;
  }
  const systemPrompt = fs.readFileSync(promptFile, "utf-8");

  const config = {
    githubToken: process.env.GITHUB_TOKEN,
    anthropicApiKey: process.env.ANTHROPIC_API_KEY,
    systemPrompt,
    owner: github.context.repo.owner,
    repo: github.context.repo.repo,
    prNumber: pr.number as number,
    prTitle: pr.title as string,
    prAuthor: (pr.user as { login: string }).login,
    baseBranch: (pr.base as { ref: string }).ref,
    headBranch: (pr.head as { ref: string }).ref,
  };

  await handlePRReview(config);
}

run().catch(core.setFailed);
