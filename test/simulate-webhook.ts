// simulate-webhook.ts — Send a fake pull_request webhook to the local server
// Usage: npx ts-node test/simulate-webhook.ts <pr-number>

import crypto from "crypto";
import http from "http";
import dotenv from "dotenv";

dotenv.config();

const prNumber = parseInt(process.argv[2], 10);
if (!prNumber || isNaN(prNumber)) {
  console.error("Usage: ts-node test/simulate-webhook.ts <pr-number>");
  process.exit(1);
}

const secret = process.env.GITHUB_WEBHOOK_SECRET;
if (!secret) {
  console.error("GITHUB_WEBHOOK_SECRET is not set in .env");
  process.exit(1);
}

const repo = process.env.GITHUB_REPO || "owner/repo-name";
const [owner, repoName] = repo.split("/");
const port = process.env.PORT || "3000";

const payload = JSON.stringify({
  action: "opened",
  number: prNumber,
  pull_request: {
    number: prNumber,
    title: `Test PR #${prNumber}`,
    user: { login: "test-author" },
    base: { ref: "main" },
    head: { ref: `feature/test-branch-${prNumber}` },
  },
  repository: {
    full_name: `${owner}/${repoName}`,
  },
});

const signature =
  "sha256=" +
  crypto.createHmac("sha256", secret).update(payload).digest("hex");

const options: http.RequestOptions = {
  hostname: "localhost",
  port: parseInt(port, 10),
  path: "/webhook",
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(payload),
    "X-GitHub-Event": "pull_request",
    "X-Hub-Signature-256": signature,
    "X-GitHub-Delivery": crypto.randomUUID(),
  },
};

console.log(`Sending pull_request (opened) webhook for PR #${prNumber}...`);
console.log(`  Target: http://localhost:${port}/webhook`);
console.log(`  Repo:   ${owner}/${repoName}`);
console.log();

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
