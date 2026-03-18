// gitlab.ts — GitLab API interactions
// Uses the GitLab REST API with a personal/project access token.

import https from "https";
import { GitLabConfig } from "./config";
import { reviewCode, PRContext, FileDiff } from "./reviewer";
import { isIgnoredFile, MAX_PATCH_LENGTH } from "./filter";

const GITLAB_API_BASE = "https://gitlab.com/api/v4";

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

/** Make an HTTPS request to the GitLab API. */
function gitlabRequest(
  method: string,
  path: string,
  token: string,
  body?: string
): Promise<{ statusCode: number; data: string }> {
  const url = new URL(path, GITLAB_API_BASE);

  return new Promise((resolve, reject) => {
    const req = https.request(
      url,
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
  token: string
): Promise<MRFile[]> {
  const path = `${GITLAB_API_BASE}/projects/${projectId}/merge_requests/${mrIid}/changes`;
  const { statusCode, data } = await gitlabRequest("GET", path, token);

  if (statusCode !== 200) {
    throw new Error(
      `GitLab API error fetching MR changes: ${statusCode} ${data}`
    );
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
      status: mapDiffStatus(
        change.new_file,
        change.deleted_file,
        change.renamed_file
      ),
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
  token: string
): Promise<void> {
  const path = `${GITLAB_API_BASE}/projects/${projectId}/merge_requests/${mrIid}/notes`;
  const payload = JSON.stringify({ body });
  const { statusCode, data } = await gitlabRequest(
    "POST",
    path,
    token,
    payload
  );

  if (statusCode !== 201) {
    throw new Error(
      `GitLab API error posting MR comment: ${statusCode} ${data}`
    );
  }
}

/** Truncate patches and convert to FileDiffs for the reviewer. */
function toFileDiffs(files: MRFile[]): FileDiff[] {
  return files.map((file) => ({
    filename: file.filename,
    status: file.status,
    patch:
      file.patch.length > MAX_PATCH_LENGTH
        ? file.patch.slice(0, MAX_PATCH_LENGTH) + "\n... [truncated]"
        : file.patch,
  }));
}

/** Orchestrate the full MR review: fetch files, run AI review, post comment. */
export async function handleMRReview(
  event: MREvent,
  gitlabConfig: GitLabConfig
): Promise<void> {
  try {
    console.log(
      `[gitlab] Starting review for MR !${event.iid} in ${event.projectPath}`
    );

    const files = await getMRFiles(
      event.projectId,
      event.iid,
      gitlabConfig.accessToken
    );

    if (files.length === 0) {
      console.log(
        `[gitlab] MR !${event.iid}: no reviewable files, skipping`
      );
      return;
    }

    console.log(
      `[gitlab] MR !${event.iid}: reviewing ${files.length} file(s)`
    );

    const fileDiffs = toFileDiffs(files);
    const prContext: PRContext = {
      title: event.title,
      author: event.author,
      baseBranch: event.targetBranch,
      headBranch: event.sourceBranch,
      pullNumber: event.iid,
    };
    const review = await reviewCode(prContext, fileDiffs);

    await postMRComment(
      event.projectId,
      event.iid,
      review,
      gitlabConfig.accessToken
    );

    console.log(`[gitlab] MR !${event.iid}: review posted successfully`);
  } catch (err) {
    console.error(`[gitlab] MR !${event.iid}: review failed`, err);
  }
}
