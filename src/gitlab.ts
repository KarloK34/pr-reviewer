import http from "http";
import https from "https";
import { GitLabConfig } from "./config.js";
import { reviewCode, PRContext, FileDiff } from "./reviewer.js";
import { isIgnoredFile, MAX_TOTAL_DIFF_LENGTH } from "./filter.js";

export interface MREvent {
  iid: number;
  title: string;
  author: string;
  sourceBranch: string;
  targetBranch: string;
  projectId: number;
  projectPath: string;
}

interface MRFile {
  filename: string;
  status: string;
  patch: string;
}

/** Make an HTTP/HTTPS request to the GitLab API. */
function gitlabRequest(
  method: string,
  url: string,
  token: string,
  body?: string
): Promise<{ statusCode: number; data: string }> {
  const parsed = new URL(url);
  const transport = parsed.protocol === "https:" ? https : http;

  return new Promise((resolve, reject) => {
    const req = transport.request(
      parsed,
      {
        method,
        headers: {
          "Private-Token": token,
          "Content-Type": "application/json",
          ...(body ? { "Content-Length": Buffer.byteLength(body) } : {}),
        },
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () =>
          resolve({ statusCode: res.statusCode ?? 0, data })
        );
      }
    );
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

/** Map GitLab's renamed/deleted/new status to a simpler label. */
function mapDiffStatus(
  newFile: boolean,
  deletedFile: boolean,
  renamedFile: boolean
): string {
  if (newFile) return "added";
  if (deletedFile) return "removed";
  if (renamedFile) return "renamed";
  return "modified";
}

/** Fetch the list of changed files for a merge request. */
async function getMRFiles(
  projectId: number,
  mrIid: number,
  gitlabConfig: GitLabConfig
): Promise<MRFile[]> {
  const url = `${gitlabConfig.url}/api/v4/projects/${projectId}/merge_requests/${mrIid}/changes`;
  const { statusCode, data } = await gitlabRequest("GET", url, gitlabConfig.accessToken);

  if (statusCode !== 200) {
    throw new Error(`GitLab API error fetching MR changes: ${statusCode} ${data}`);
  }

  const parsed = JSON.parse(data);
  const changes: any[] = parsed.changes || [];
  const files: MRFile[] = [];

  for (const change of changes) {
    const filename: string = change.new_path || change.old_path;
    if (isIgnoredFile(filename)) continue;
    if (!change.diff) continue;

    files.push({
      filename,
      status: mapDiffStatus(change.new_file, change.deleted_file, change.renamed_file),
      patch: change.diff,
    });
  }

  return files;
}

/** Post a comment (note) on a merge request. */
async function postMRComment(
  projectId: number,
  mrIid: number,
  body: string,
  gitlabConfig: GitLabConfig
): Promise<void> {
  const url = `${gitlabConfig.url}/api/v4/projects/${projectId}/merge_requests/${mrIid}/notes`;
  const payload = JSON.stringify({ body });
  const { statusCode, data } = await gitlabRequest("POST", url, gitlabConfig.accessToken, payload);

  if (statusCode !== 201) {
    throw new Error(`GitLab API error posting MR comment: ${statusCode} ${data}`);
  }
}

/** Convert MRFiles to FileDiffs, throwing if the total diff exceeds the budget. */
function toFileDiffs(files: MRFile[]): FileDiff[] {
  const total = files.reduce((sum, f) => sum + f.patch.length, 0);
  if (total > MAX_TOTAL_DIFF_LENGTH) {
    throw new Error(`Diff too large to review (${total} chars across ${files.length} files; limit is ${MAX_TOTAL_DIFF_LENGTH})`);
  }
  return files.map(({ filename, status, patch }) => ({ filename, status, patch }));
}

/** Orchestrate the full MR review: fetch files, run AI review, post comment. */
export async function handleMRReview(
  event: MREvent,
  gitlabConfig: GitLabConfig,
  systemPrompt: string
): Promise<void> {
  try {
    console.log(`[gitlab] Starting review for MR !${event.iid} in ${event.projectPath}`);

    const files = await getMRFiles(event.projectId, event.iid, gitlabConfig);

    if (files.length === 0) {
      console.log(`[gitlab] MR !${event.iid}: no reviewable files, skipping`);
      return;
    }

    console.log(`[gitlab] MR !${event.iid}: reviewing ${files.length} file(s)`);

    const fileDiffs = toFileDiffs(files);
    const prContext: PRContext = {
      title: event.title,
      author: event.author,
      baseBranch: event.targetBranch,
      headBranch: event.sourceBranch,
      pullNumber: event.iid,
    };
    const review = await reviewCode(prContext, fileDiffs, systemPrompt);

    await postMRComment(event.projectId, event.iid, review, gitlabConfig);

    console.log(`[gitlab] MR !${event.iid}: review posted successfully`);
  } catch (err) {
    console.error(`[gitlab] MR !${event.iid}: review failed`, err);
    throw err;
  }
}
