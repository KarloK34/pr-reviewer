// tunnel-manager.ts — Cloudflare tunnel management
// Spawns cloudflared, detects the tunnel URL, and auto-updates
// webhook URLs on GitHub and GitLab.

import { spawn, ChildProcess } from "child_process";
import jwt from "jsonwebtoken";
import http from "http";
import https from "https";
import { loadConfig, Config, GitLabConfig } from "./config";

const RESTART_DELAY_MS = 5000;
const TUNNEL_URL_REGEX = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/;

let cloudflaredProcess: ChildProcess | null = null;
let shuttingDown = false;

// ── GitHub App JWT ──────────────────────────────────────────────────

function createAppJWT(config: Config): string {
  const now = Math.floor(Date.now() / 1000);
  return jwt.sign(
    {
      iat: now - 60,
      exp: now + 10 * 60,
      iss: config.githubAppId,
    },
    config.githubPrivateKey,
    { algorithm: "RS256" }
  );
}

// ── GitHub webhook update ───────────────────────────────────────────

async function updateGitHubWebhook(
  tunnelUrl: string,
  config: Config
): Promise<void> {
  const appJwt = createAppJWT(config);
  const webhookUrl = `${tunnelUrl}/webhook`;
  const body = JSON.stringify({ url: webhookUrl, content_type: "json" });

  const { statusCode, data } = await new Promise<{
    statusCode: number;
    data: string;
  }>((resolve, reject) => {
    const req = https.request(
      "https://api.github.com/app/hook/config",
      {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${appJwt}`,
          Accept: "application/vnd.github.v3+json",
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
          "User-Agent": "pr-reviewer-tunnel",
        },
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => resolve({ statusCode: res.statusCode ?? 0, data }));
      }
    );
    req.on("error", reject);
    req.write(body);
    req.end();
  });

  if (statusCode !== 200) {
    throw new Error(
      `GitHub API returned ${statusCode}: ${data}`
    );
  }

  console.log(`[tunnel] GitHub App webhook updated → ${webhookUrl}`);
}

// ── GitLab webhook update ───────────────────────────────────────────

function gitlabApiRequest(
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

async function updateGitLabWebhooks(
  tunnelUrl: string,
  gitlabConfig: GitLabConfig
): Promise<void> {
  const webhookUrl = `${tunnelUrl}/webhook/gitlab`;

  for (const repoPath of gitlabConfig.repos) {
    try {
      const encodedPath = encodeURIComponent(repoPath);
      const baseUrl = `${gitlabConfig.url}/api/v4/projects/${encodedPath}/hooks`;

      // Fetch existing hooks
      const { statusCode, data } = await gitlabApiRequest(
        "GET",
        baseUrl,
        gitlabConfig.accessToken
      );

      if (statusCode !== 200) {
        console.error(
          `[tunnel] Failed to list GitLab hooks for ${repoPath}: ${statusCode}`
        );
        continue;
      }

      const hooks: any[] = JSON.parse(data);
      const existing = hooks.find(
        (h: any) => h.url && h.url.includes("/webhook/gitlab")
      );

      if (existing) {
        // Update existing hook
        const updateUrl = `${baseUrl}/${existing.id}`;
        const payload = JSON.stringify({
          url: webhookUrl,
          token: gitlabConfig.webhookSecret,
          merge_requests_events: existing.merge_requests_events ?? true,
          push_events: existing.push_events ?? false,
          enable_ssl_verification:
            existing.enable_ssl_verification ?? true,
        });

        const updateRes = await gitlabApiRequest(
          "PUT",
          updateUrl,
          gitlabConfig.accessToken,
          payload
        );

        if (updateRes.statusCode === 200) {
          console.log(
            `[tunnel] GitLab webhook updated for ${repoPath} → ${webhookUrl}`
          );
        } else {
          console.error(
            `[tunnel] Failed to update GitLab hook for ${repoPath}: ${updateRes.statusCode}`
          );
        }
      } else {
        // Create new hook
        const payload = JSON.stringify({
          url: webhookUrl,
          token: gitlabConfig.webhookSecret,
          merge_requests_events: true,
          push_events: false,
          enable_ssl_verification: true,
        });

        const createRes = await gitlabApiRequest(
          "POST",
          baseUrl,
          gitlabConfig.accessToken,
          payload
        );

        if (createRes.statusCode === 201) {
          console.log(
            `[tunnel] GitLab webhook created for ${repoPath} → ${webhookUrl}`
          );
        } else {
          console.error(
            `[tunnel] Failed to create GitLab hook for ${repoPath}: ${createRes.statusCode}`
          );
        }
      }
    } catch (err: any) {
      console.error(
        `[tunnel] Error updating GitLab hook for ${repoPath}: ${err.message ?? err}`
      );
    }
  }
}

// ── Webhook URL update orchestrator ─────────────────────────────────

const DNS_DELAY_MS = 30_000;
const RETRY_DELAY_MS = 10_000;
const MAX_RETRIES = 3;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withRetry(
  label: string,
  fn: () => Promise<void>
): Promise<void> {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      await fn();
      return;
    } catch (err: any) {
      if (attempt < MAX_RETRIES) {
        console.error(
          `[tunnel] ${label} failed (attempt ${attempt}/${MAX_RETRIES}): ${err.message ?? err}. Retrying in ${RETRY_DELAY_MS / 1000}s...`
        );
        await sleep(RETRY_DELAY_MS);
      } else {
        console.error(
          `[tunnel] ${label} failed after ${MAX_RETRIES} attempts: ${err.message ?? err}`
        );
      }
    }
  }
}

async function onTunnelUrlDetected(
  tunnelUrl: string,
  config: Config
): Promise<void> {
  console.log(
    `[tunnel] Tunnel URL detected: ${tunnelUrl}. Waiting ${DNS_DELAY_MS / 1000} seconds for DNS propagation...`
  );
  await sleep(DNS_DELAY_MS);

  await withRetry("GitHub webhook update", () =>
    updateGitHubWebhook(tunnelUrl, config)
  );

  if (config.gitlab) {
    await withRetry("GitLab webhook update", () =>
      updateGitLabWebhooks(tunnelUrl, config.gitlab!)
    );
  }
}

// ── Cloudflared process management ──────────────────────────────────

function startCloudflared(config: Config): void {
  const port = config.port;

  console.log(
    `[tunnel] Starting cloudflared tunnel → http://localhost:${port}`
  );

  const proc = spawn("cloudflared", ["tunnel", "--url", `http://localhost:${port}`], {
    stdio: ["ignore", "pipe", "pipe"],
  });

  cloudflaredProcess = proc;

  let urlDetected = false;

  const handleOutput = (chunk: Buffer) => {
    const text = chunk.toString();
    // cloudflared logs to stderr
    process.stderr.write(text);

    if (!urlDetected) {
      const match = text.match(TUNNEL_URL_REGEX);
      if (match) {
        urlDetected = true;
        onTunnelUrlDetected(match[0], config).catch((err) => {
          console.error("[tunnel] Error updating webhooks:", err);
        });
      }
    }
  };

  proc.stdout?.on("data", handleOutput);
  proc.stderr?.on("data", handleOutput);

  proc.on("close", (code) => {
    cloudflaredProcess = null;

    if (shuttingDown) {
      console.log("[tunnel] cloudflared stopped");
      return;
    }

    console.error(
      `[tunnel] cloudflared exited with code ${code}, restarting in ${RESTART_DELAY_MS / 1000}s...`
    );

    setTimeout(() => {
      if (!shuttingDown) {
        startCloudflared(config);
      }
    }, RESTART_DELAY_MS);
  });

  proc.on("error", (err) => {
    console.error(`[tunnel] Failed to start cloudflared: ${err.message}`);
    console.error(
      "[tunnel] Make sure cloudflared is installed: brew install cloudflare/cloudflare/cloudflared"
    );
    process.exit(1);
  });
}

// ── Graceful shutdown ───────────────────────────────────────────────

function shutdown(): void {
  if (shuttingDown) return;
  shuttingDown = true;

  console.log("\n[tunnel] Shutting down...");

  if (cloudflaredProcess) {
    cloudflaredProcess.kill("SIGTERM");
  }

  // Give cloudflared a moment to exit, then force
  setTimeout(() => {
    process.exit(0);
  }, 3000);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

// ── Main ────────────────────────────────────────────────────────────

function main(): void {
  const config = loadConfig();
  console.log("[tunnel] Tunnel manager starting...");
  startCloudflared(config);
}

main();
