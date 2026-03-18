// tunnel-manager.ts — Cloudflare tunnel management
// Spawns cloudflared, detects the tunnel URL, and auto-updates
// webhook URLs on GitHub and GitLab.

import { spawn, ChildProcess } from "child_process";
import jwt from "jsonwebtoken";
import { Octokit } from "@octokit/rest";
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
  try {
    const appJwt = createAppJWT(config);
    const octokit = new Octokit({ auth: appJwt });

    const webhookUrl = `${tunnelUrl}/webhook`;

    await octokit.request("PATCH /app/hook/config", {
      url: webhookUrl,
      content_type: "json",
    });

    console.log(`[tunnel] GitHub App webhook updated → ${webhookUrl}`);
  } catch (err: any) {
    console.error(
      `[tunnel] Failed to update GitHub webhook: ${err.message ?? err}`
    );
  }
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

async function onTunnelUrlDetected(
  tunnelUrl: string,
  config: Config
): Promise<void> {
  console.log(`[tunnel] Detected tunnel URL: ${tunnelUrl}`);

  await updateGitHubWebhook(tunnelUrl, config);

  if (config.gitlab) {
    await updateGitLabWebhooks(tunnelUrl, config.gitlab);
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
