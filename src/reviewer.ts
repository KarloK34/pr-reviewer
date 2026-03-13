// reviewer.ts — Claude AI review logic
// Sends the PR diff to Claude via @anthropic-ai/sdk and returns
// a structured code review.

import { Config } from "./config";

export interface PRContext {
  title: string;
  author: string;
  baseBranch: string;
  headBranch: string;
}

/** Initialize the Anthropic client. */
export function createReviewerClient(config: Config): void {
  // TODO: Create an Anthropic client using config.anthropicApiKey
}

/** Send a PR diff to Claude and get a code review back. */
export async function reviewCode(
  diff: string,
  context: PRContext
): Promise<string> {
  // TODO: Build a prompt with the diff and context, call Claude API (messages.create),
  // parse the response, and return the review as markdown.
  throw new Error("Not implemented");
}
