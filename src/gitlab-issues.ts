// gitlab-issues.ts — GitLab Issues API and Merge Request creation
// Provides functions for fetching issues and creating MRs for the issue coder.

import http from "http";
import https from "https";
import { GitLabConfig } from "./config";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface IssueNote {
  author: string;
  body: string;
  createdAt: string;
}

export interface IssueSummary {
  id: number;
  iid: number;
  title: string;
  description: string;
  labels: string[];
}

export interface IssueDetails extends IssueSummary {
  notes: IssueNote[];
  projectId: number;
  projectPath: string;
}

export interface CreateMROptions {
  sourceBranch: string;
  targetBranch: string;
  title: string;
  description: string;
  labels?: string[];
  removeSourceBranch?: boolean;
  reviewerIds?: number[];
}

// ─── HTTP client ─────────────────────────────────────────────────────────────

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

// ─── API functions ────────────────────────────────────────────────────────────

/** Fetch a single issue by project ID and issue IID. */
export async function fetchIssue(
  projectId: number,
  issueIid: number,
  gitlabConfig: GitLabConfig
): Promise<IssueSummary> {
  const url = `${gitlabConfig.url}/api/v4/projects/${projectId}/issues/${issueIid}`;
  const { statusCode, data } = await gitlabRequest(
    "GET",
    url,
    gitlabConfig.accessToken
  );

  if (statusCode !== 200) {
    throw new Error(
      `GitLab API error fetching issue #${issueIid}: ${statusCode} ${data}`
    );
  }

  const parsed = JSON.parse(data);
  return {
    id: parsed.id,
    iid: parsed.iid,
    title: parsed.title,
    description: parsed.description || "",
    labels: parsed.labels || [],
  };
}

/** Fetch all non-system notes (comments) on an issue. */
export async function fetchIssueNotes(
  projectId: number,
  issueIid: number,
  gitlabConfig: GitLabConfig
): Promise<IssueNote[]> {
  const url = `${gitlabConfig.url}/api/v4/projects/${projectId}/issues/${issueIid}/notes?per_page=100&sort=asc`;
  const { statusCode, data } = await gitlabRequest(
    "GET",
    url,
    gitlabConfig.accessToken
  );

  if (statusCode !== 200) {
    throw new Error(
      `GitLab API error fetching notes for issue #${issueIid}: ${statusCode} ${data}`
    );
  }

  const parsed: any[] = JSON.parse(data);
  return parsed
    .filter((note) => !note.system) // exclude system notes ("assigned to...", etc.)
    .map((note) => ({
      author: note.author?.username ?? "unknown",
      body: note.body,
      createdAt: note.created_at,
    }));
}

/** Create a merge request and return its IID. */
export async function createMergeRequest(
  projectId: number,
  options: CreateMROptions,
  gitlabConfig: GitLabConfig
): Promise<number> {
  const url = `${gitlabConfig.url}/api/v4/projects/${projectId}/merge_requests`;
  const body = JSON.stringify({
    source_branch: options.sourceBranch,
    target_branch: options.targetBranch,
    title: options.title,
    description: options.description,
    labels: (options.labels ?? []).join(","),
    remove_source_branch: options.removeSourceBranch ?? false,
    ...(options.reviewerIds?.length ? { reviewer_ids: options.reviewerIds } : {}),
  });

  const { statusCode, data } = await gitlabRequest(
    "POST",
    url,
    gitlabConfig.accessToken,
    body
  );

  if (statusCode !== 201) {
    throw new Error(
      `GitLab API error creating MR: ${statusCode} ${data}`
    );
  }

  return JSON.parse(data).iid;
}
