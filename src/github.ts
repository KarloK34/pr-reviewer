import * as actionsGitHub from "@actions/github";
import { reviewCode, PRContext, FileDiff } from "./reviewer.js";
import { isIgnoredFile, MAX_TOTAL_DIFF_LENGTH } from "./filter.js";

type GitHubClient = ReturnType<typeof actionsGitHub.getOctokit>;

export interface PRRunConfig {
  githubToken: string;
  anthropicApiKey: string;
  systemPrompt: string;
  owner: string;
  repo: string;
  prNumber: number;
  prTitle: string;
  prAuthor: string;
  baseBranch: string;
  headBranch: string;
}

interface PRFile {
  filename: string;
  status: string;
  patch: string;
}

/** Fetch the list of changed files for a PR, filtering out non-reviewable files. */
async function getPRFiles(
  octokit: GitHubClient,
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
  octokit: GitHubClient,
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

/** Convert PRFiles to FileDiffs, throwing if the total diff exceeds the budget. */
function toFileDiffs(files: PRFile[]): FileDiff[] {
  const total = files.reduce((sum, f) => sum + f.patch.length, 0);
  if (total > MAX_TOTAL_DIFF_LENGTH) {
    throw new Error(`Diff too large to review (${total} chars across ${files.length} files; limit is ${MAX_TOTAL_DIFF_LENGTH})`);
  }
  return files.map(({ filename, status, patch }) => ({ filename, status, patch }));
}

/** Orchestrate the full PR review: fetch diff, run AI review, post result. */
export async function handlePRReview(config: PRRunConfig): Promise<void> {
  try {
    console.log(`[github] Starting review for PR #${config.prNumber}`);

    const octokit = actionsGitHub.getOctokit(config.githubToken);
    const files = await getPRFiles(octokit, config.owner, config.repo, config.prNumber);

    if (files.length === 0) {
      console.log(`[github] PR #${config.prNumber}: no reviewable files, skipping`);
      return;
    }

    console.log(`[github] PR #${config.prNumber}: reviewing ${files.length} file(s)`);

    const fileDiffs = toFileDiffs(files);
    const prContext: PRContext = {
      title: config.prTitle,
      author: config.prAuthor,
      baseBranch: config.baseBranch,
      headBranch: config.headBranch,
      pullNumber: config.prNumber,
    };
    const review = await reviewCode(prContext, fileDiffs, config.systemPrompt);

    await postReviewComment(octokit, config.owner, config.repo, config.prNumber, review);

    console.log(`[github] PR #${config.prNumber}: review posted successfully`);
  } catch (err) {
    console.error(`[github] PR #${config.prNumber}: review failed`, err);
    throw err;
  }
}
