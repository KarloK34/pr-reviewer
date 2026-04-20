import * as fs from "fs";
import { handleMRReview } from "./gitlab";

async function run(): Promise<void> {
  if (!process.env.CI_MERGE_REQUEST_IID) {
    console.log("CI_MERGE_REQUEST_IID not set — not an MR pipeline, skipping.");
    process.exit(0);
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("ANTHROPIC_API_KEY not set");
    process.exit(1);
  }
  if (!process.env.GITLAB_ACCESS_TOKEN) {
    console.error("GITLAB_ACCESS_TOKEN not set");
    process.exit(1);
  }

  const promptFile = process.env.SYSTEM_PROMPT_FILE;
  if (!promptFile) {
    console.error("SYSTEM_PROMPT_FILE not set");
    process.exit(1);
  }
  if (!fs.existsSync(promptFile)) {
    console.error(`System prompt file not found: ${promptFile}`);
    process.exit(1);
  }
  const systemPrompt = fs.readFileSync(promptFile, "utf-8");

  const gitlabConfig = {
    url: process.env.CI_SERVER_URL!.replace(/\/+$/, ""),
    accessToken: process.env.GITLAB_ACCESS_TOKEN!,
    webhookSecret: "",
    repos: [],
  };

  const mrEvent = {
    iid: parseInt(process.env.CI_MERGE_REQUEST_IID!, 10),
    title: process.env.CI_MERGE_REQUEST_TITLE ?? "",
    author: process.env.GITLAB_USER_LOGIN ?? "unknown",
    sourceBranch: process.env.CI_MERGE_REQUEST_SOURCE_BRANCH_NAME ?? "",
    targetBranch: process.env.CI_MERGE_REQUEST_TARGET_BRANCH_NAME ?? "",
    projectId: parseInt(process.env.CI_PROJECT_ID!, 10),
    projectPath: process.env.CI_PROJECT_PATH ?? "",
  };

  await handleMRReview(mrEvent, gitlabConfig, systemPrompt);
}

run().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
