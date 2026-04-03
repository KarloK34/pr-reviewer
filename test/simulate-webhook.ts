// simulate-webhook.ts — Send a fake webhook to the local server
// Usage:
//   GitHub: npx ts-node test/simulate-webhook.ts <pr-number> [owner/repo]
//   GitLab: npx ts-node test/simulate-webhook.ts --gitlab <mr-iid> [namespace/repo]

import crypto from "crypto";
import http from "http";
import dotenv from "dotenv";

dotenv.config();

const args = process.argv.slice(2);
const isGitLab = args[0] === "--gitlab";
if (isGitLab) args.shift();

// Extract --project-id <id> from args
let projectId = 12345;
const pidIdx = args.indexOf("--project-id");
if (pidIdx !== -1) {
  projectId = parseInt(args[pidIdx + 1], 10);
  args.splice(pidIdx, 2);
}

const mrNumber = parseInt(args[0], 10);
if (!mrNumber || isNaN(mrNumber)) {
  console.error(
    "Usage:\n" +
      "  GitHub: ts-node test/simulate-webhook.ts <pr-number> [owner/repo]\n" +
      "  GitLab: ts-node test/simulate-webhook.ts --gitlab <mr-iid> [--project-id <id>] [namespace/repo]"
  );
  process.exit(1);
}

const port = process.env.PORT || "3000";

function sendRequest(
  path: string,
  payload: string,
  headers: Record<string, string>
): void {
  const options: http.RequestOptions = {
    hostname: "localhost",
    port: parseInt(port, 10),
    path,
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(payload).toString(),
      ...headers,
    },
  };

  const req = http.request(options, (res) => {
    let body = "";
    res.on("data", (chunk) => (body += chunk));
    res.on("end", () => {
      console.log(`Response: ${res.statusCode}`);
      try {
        console.log(JSON.stringify(JSON.parse(body), null, 2));
      } catch {
        console.log(body);
      }
    });
  });

  req.on("error", (err) => {
    console.error(`Request failed: ${err.message}`);
    console.error("Is the server running? Start it with: npm run dev");
    process.exit(1);
  });

  req.write(payload);
  req.end();
}

if (isGitLab) {
  // --- GitLab simulation ---
  const secret = process.env.GITLAB_WEBHOOK_SECRET;
  if (!secret) {
    console.error("GITLAB_WEBHOOK_SECRET is not set in .env");
    process.exit(1);
  }

  let repoPath = args[1];
  if (!repoPath) {
    const reposRaw = process.env.GITLAB_REPOS || "";
    const firstRepo = reposRaw.split(",")[0]?.trim();
    if (!firstRepo) {
      console.error(
        "No repo specified and GITLAB_REPOS is not set in .env"
      );
      process.exit(1);
    }
    repoPath = firstRepo;
  }

  const payload = JSON.stringify({
    object_kind: "merge_request",
    event_type: "merge_request",
    user: { username: "test-author" },
    project: {
      id: projectId,
      path_with_namespace: repoPath,
    },
    object_attributes: {
      iid: mrNumber,
      title: `Test MR !${mrNumber}`,
      action: "open",
      source_branch: `feature/test-branch-${mrNumber}`,
      target_branch: "main",
      author_id: 1,
    },
  });

  console.log(
    `Sending Merge Request Hook (open) webhook for MR !${mrNumber}...`
  );
  console.log(`  Target: http://localhost:${port}/webhook/gitlab`);
  console.log(`  Repo:   ${repoPath}`);
  console.log(`  Project ID: ${projectId}`);
  console.log();

  sendRequest("/webhook/gitlab", payload, {
    "X-Gitlab-Event": "Merge Request Hook",
    "X-Gitlab-Token": secret,
  });
} else {
  // --- GitHub simulation ---
  const secret = process.env.GITHUB_WEBHOOK_SECRET;
  if (!secret) {
    console.error("GITHUB_WEBHOOK_SECRET is not set in .env");
    process.exit(1);
  }

  let repoFullName = args[1];
  if (!repoFullName) {
    const reposRaw = process.env.GITHUB_REPOS || "";
    const firstRepo = reposRaw.split(",")[0]?.trim();
    if (!firstRepo) {
      console.error(
        "No repo specified and GITHUB_REPOS is not set in .env"
      );
      process.exit(1);
    }
    repoFullName = firstRepo;
  }

  const [owner, repoName] = repoFullName.split("/");
  if (!owner || !repoName) {
    console.error(
      `Invalid repo format: "${repoFullName}" (expected owner/repo)`
    );
    process.exit(1);
  }

  const payload = JSON.stringify({
    action: "opened",
    number: mrNumber,
    pull_request: {
      number: mrNumber,
      title: `Test PR #${mrNumber}`,
      user: { login: "test-author" },
      base: { ref: "main" },
      head: { ref: `feature/test-branch-${mrNumber}` },
    },
    repository: {
      full_name: `${owner}/${repoName}`,
    },
  });

  const signature =
    "sha256=" +
    crypto.createHmac("sha256", secret).update(payload).digest("hex");

  console.log(
    `Sending pull_request (opened) webhook for PR #${mrNumber}...`
  );
  console.log(`  Target: http://localhost:${port}/webhook`);
  console.log(`  Repo:   ${owner}/${repoName}`);
  console.log();

  sendRequest("/webhook", payload, {
    "X-GitHub-Event": "pull_request",
    "X-Hub-Signature-256": signature,
    "X-GitHub-Delivery": crypto.randomUUID(),
  });
}
