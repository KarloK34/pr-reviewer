// github.ts — GitHub API interactions
// Uses @octokit/app to authenticate as a GitHub App and @octokit/rest
// to fetch PR diffs and post review comments.

import { App } from "@octokit/app";
import { Octokit } from "@octokit/rest";
import { loadConfig, Config } from "./config";
import { reviewCode } from "./reviewer";

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

let app: App | null = null;

function getApp(): App {
  if (!app) {
    const config = loadConfig();
    app = new App({
      appId: config.githubAppId,
      privateKey: config.githubPrivateKey,
    });
  }
  return app;
}

/** Get an authenticated Octokit instance for the given repository installation. */
async function getInstallationOctokit(
  owner: string,
  repo: string
): Promise<Octokit> {
  const githubApp = getApp();

  // Find the installation for this repository
  const {
    data: installation,
  } = await (githubApp.octokit as Octokit).rest.apps.getRepoInstallation({
    owner,
    repo,
  });

  const octokit = (await githubApp.getInstallationOctokit(
    installation.id
  )) as unknown as Octokit;

  return octokit;
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

  // Paginate through all files
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
      if (!file.patch) continue; // binary files or files with no diff

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

/** Format PR files into a diff string suitable for AI review. */
function formatDiffForReview(files: PRFile[]): string {
  return files
    .map((file) => {
      const patch =
        file.patch.length > MAX_PATCH_LENGTH
          ? file.patch.slice(0, MAX_PATCH_LENGTH) + "\n... [truncated]"
          : file.patch;
      return `### ${file.filename} (${file.status})\n\`\`\`diff\n${patch}\n\`\`\``;
    })
    .join("\n\n");
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

    const formattedDiff = formatDiffForReview(files);
    const review = await reviewCode(formattedDiff, {
      title: event.title,
      author: event.author,
      baseBranch: event.baseBranch,
      headBranch: event.headBranch,
    });

    await postReviewComment(octokit, owner, repo, event.number, review);

    console.log(`[github] PR #${event.number}: review posted successfully`);
  } catch (err) {
    console.error(`[github] PR #${event.number}: review failed`, err);
  }
}
