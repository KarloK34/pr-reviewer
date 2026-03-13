// github.ts — GitHub API interactions
// Uses @octokit/app to authenticate as a GitHub App and @octokit/rest
// to fetch PR diffs and post review comments.

import { Config } from "./config";

export interface PREvent {
  number: number;
  title: string;
  author: string;
  baseBranch: string;
  headBranch: string;
  repoFullName: string;
}

/** Initialize an authenticated Octokit instance for the installed app. */
export function createGitHubClient(config: Config): void {
  // TODO: Read the private key from config.githubPrivateKey,
  // create an App instance, and return an authenticated Octokit client
  // for the installation on config.githubRepo.
}

/** Fetch the diff for a given pull request number. */
export async function fetchPRDiff(prNumber: number): Promise<string> {
  // TODO: Use Octokit to get the PR diff (Accept: application/vnd.github.v3.diff)
  throw new Error("Not implemented");
}

/** Post a review comment on a pull request. */
export async function postReview(
  prNumber: number,
  body: string
): Promise<void> {
  // TODO: Use Octokit to create a PR review with the given body
}

/** Orchestrate the full PR review: fetch diff, run AI review, post result. */
export async function handlePRReview(event: PREvent): Promise<void> {
  // TODO: Call fetchPRDiff, then reviewDiff, then postReview
  throw new Error("Not implemented");
}
