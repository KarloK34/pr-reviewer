// github.ts — GitHub API interactions
// Authenticates as a GitHub App using manual JWT + installation token flow.
// Uses @octokit/rest for all API calls.

import jwt from "jsonwebtoken";
import { Octokit } from "@octokit/rest";
import { loadConfig } from "./config";
import { reviewCode, PRContext, FileDiff } from "./reviewer";

export interface PREvent {
  number: number;
  title: string;
  author: string;
  baseBranch: string;
  headBranch: string;
  repoFullName: string;
}

export interface PRFile {
  filename: string;
  status: string;
  patch: string;
}

const MAX_PATCH_LENGTH = 3000;

const IGNORED_EXTENSIONS = [
  ".g.dart",
  ".freezed.dart",
  ".mocks.dart",
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".bmp",
  ".ico",
  ".svg",
  ".webp",
];

const IGNORED_FILENAMES = ["pubspec.lock"];

function isIgnoredFile(filename: string): boolean {
  if (IGNORED_FILENAMES.includes(filename.split("/").pop() || "")) return true;
  if (filename.startsWith("assets/")) return true;
  const lower = filename.toLowerCase();
  return IGNORED_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

/** Create a short-lived JWT to authenticate as the GitHub App. */
function createAppJWT(): string {
  const config = loadConfig();
  const now = Math.floor(Date.now() / 1000);

  return jwt.sign(
    {
      iat: now - 60, // issued 60s in the past to account for clock drift
      exp: now + 10 * 60, // expires in 10 minutes (max allowed)
      iss: config.githubAppId,
    },
    config.githubPrivateKey,
    { algorithm: "RS256" }
  );
}

/** Get an authenticated Octokit instance for the given repository installation. */
async function getInstallationOctokit(
  owner: string,
  repo: string
): Promise<Octokit> {
  const appJwt = createAppJWT();

  // Use the JWT to find the installation for this repo
  const appOctokit = new Octokit({ auth: appJwt });
  const { data: installation } =
    await appOctokit.rest.apps.getRepoInstallation({ owner, repo });

  // Exchange the JWT for a scoped installation access token
  const { data: tokenData } =
    await appOctokit.rest.apps.createInstallationAccessToken({
      installation_id: installation.id,
    });

  return new Octokit({ auth: tokenData.token });
}

/** Fetch the list of changed files for a PR, filtering out non-reviewable files. */
async function getPRFiles(
  octokit: Octokit,
  owner: string,
  repo: string,
  pullNumber: number
): Promise<PRFile[]> {
  const files: PRFile[] = [];
  let page = 1;

  while (true) {
    const { data } = await octokit.rest.pulls.listFiles({
      owner,
      repo,
      pull_number: pullNumber,
      per_page: 100,
      page,
    });

    if (data.length === 0) break;

    for (const file of data) {
      if (isIgnoredFile(file.filename)) continue;
      if (!file.patch) continue;

      files.push({
        filename: file.filename,
        status: file.status,
        patch: file.patch,
      });
    }

    if (data.length < 100) break;
    page++;
  }

  return files;
}

/** Post a PR review comment with the given body. */
async function postReviewComment(
  octokit: Octokit,
  owner: string,
  repo: string,
  pullNumber: number,
  reviewBody: string
): Promise<void> {
  await octokit.rest.pulls.createReview({
    owner,
    repo,
    pull_number: pullNumber,
    body: reviewBody,
    event: "COMMENT",
  });
}

/** Truncate patches and convert PRFiles to FileDiffs for the reviewer. */
function toFileDiffs(files: PRFile[]): FileDiff[] {
  return files.map((file) => ({
    filename: file.filename,
    status: file.status,
    patch:
      file.patch.length > MAX_PATCH_LENGTH
        ? file.patch.slice(0, MAX_PATCH_LENGTH) + "\n... [truncated]"
        : file.patch,
  }));
}

/** Orchestrate the full PR review: fetch diff, run AI review, post result. */
export async function handlePRReview(event: PREvent): Promise<void> {
  const [owner, repo] = event.repoFullName.split("/");

  try {
    console.log(`[github] Starting review for PR #${event.number}`);

    const octokit = await getInstallationOctokit(owner, repo);
    const files = await getPRFiles(octokit, owner, repo, event.number);

    if (files.length === 0) {
      console.log(
        `[github] PR #${event.number}: no reviewable files, skipping`
      );
      return;
    }

    console.log(
      `[github] PR #${event.number}: reviewing ${files.length} file(s)`
    );

    const fileDiffs = toFileDiffs(files);
    const prContext: PRContext = {
      title: event.title,
      author: event.author,
      baseBranch: event.baseBranch,
      headBranch: event.headBranch,
      pullNumber: event.number,
    };
    const review = await reviewCode(prContext, fileDiffs);

    await postReviewComment(octokit, owner, repo, event.number, review);

    console.log(`[github] PR #${event.number}: review posted successfully`);
  } catch (err) {
    console.error(`[github] PR #${event.number}: review failed`, err);
  }
}
