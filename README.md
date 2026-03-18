# pr-reviewer

Automated PR/MR reviewer powered by Claude AI. Supports both **GitHub** and **GitLab**. Listens for webhooks, analyzes diffs using Claude, and posts code review comments — focused on Flutter/Dart best practices.

Supports multiple repositories from a single instance.

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment variables

```bash
cp .env.example .env
```

Fill in the values in `.env`:

#### GitHub (required)

| Variable                  | Description                                             |
| ------------------------- | ------------------------------------------------------- |
| `PORT`                    | Server port (default: 3000)                             |
| `ANTHROPIC_API_KEY`       | Your Anthropic API key                                  |
| `GITHUB_APP_ID`           | Your GitHub App's ID                                    |
| `GITHUB_WEBHOOK_SECRET`   | The webhook secret you set when creating the GitHub App |
| `GITHUB_PRIVATE_KEY_PATH` | Path to the `.pem` private key file                     |
| `GITHUB_REPOS`            | Comma-separated list of repos in `owner/repo` format    |

#### GitLab (optional)

| Variable                | Description                                                  |
| ----------------------- | ------------------------------------------------------------ |
| `GITLAB_URL`            | GitLab instance URL (default: `https://gitlab.com`)          |
| `GITLAB_ACCESS_TOKEN`   | Personal or project access token with `api` scope            |
| `GITLAB_WEBHOOK_SECRET` | Secret token configured in the GitLab webhook settings       |
| `GITLAB_REPOS`          | Comma-separated list of repos in `namespace/repo` format     |

GitLab support is **disabled by default**. Set all three `GITLAB_*` credential/repo variables to enable it. If only some are set, the server will throw an error on startup.

#### Tunnel manager (optional)

| Variable              | Description                                                      |
| --------------------- | ---------------------------------------------------------------- |
| `GITHUB_APP_HOOK_ID`  | The GitHub App webhook ID (found in App settings → Advanced)     |

Only needed if you use `npm run tunnel` to auto-update webhook URLs.

#### Multi-repo configuration

```
GITHUB_REPOS=cobeisfresh/DnevnikHr,cobeisfresh/AnotherApp
GITLAB_REPOS=cobeisfresh/mobile-app,cobeisfresh/backend-api
```

The GitHub App must be **installed on every GitHub repository** listed. The GitLab access token must have access to all listed GitLab projects.

Webhooks from repos not in these lists are ignored.

### 3. GitHub App private key

1. In your GitHub App settings, generate a private key — this downloads a `.pem` file.
2. Place it somewhere safe (e.g., the project root, or `~/.ssh/`).
3. Set `GITHUB_PRIVATE_KEY_PATH` in `.env` to the absolute or relative path:

```
GITHUB_PRIVATE_KEY_PATH=./your-app-name.2024-01-01.private-key.pem
```

> The `.gitignore` already excludes `*.pem` files.

### 4. GitLab webhook setup

1. Go to your GitLab project → Settings → Webhooks.
2. Set the URL to `https://your-server/webhook/gitlab`.
3. Set the secret token to match `GITLAB_WEBHOOK_SECRET`.
4. Check **Merge request events**.
5. Save. Repeat for each project in `GITLAB_REPOS`.

> If you use the tunnel manager (`npm run tunnel`), it will create/update GitLab webhooks automatically.

## Running

### Development (with auto-reload)

```bash
npm run dev
```

This uses `ts-node-dev` to watch for file changes and restart automatically.

### Production

```bash
npm run build
npm start
```

### With PM2

```bash
npm run build
pm2 start pm2.config.js
```

PM2 manages two processes:
- **pr-reviewer** — the Express webhook server
- **pr-reviewer-tunnel** — the Cloudflare tunnel + webhook URL updater

```bash
pm2 status              # check both processes
pm2 logs                # view all logs
pm2 logs pr-reviewer    # server logs only
pm2 logs pr-reviewer-tunnel  # tunnel logs only
pm2 restart all
pm2 stop all
```

## Tunnel manager

The tunnel manager replaces manually running `cloudflared`. It:

1. Spawns `cloudflared tunnel --url http://localhost:3000`
2. Detects the generated `*.trycloudflare.com` URL
3. Automatically updates the webhook URL on GitHub (via `PATCH /app/hook/config`) and GitLab (via project hooks API)
4. Restarts `cloudflared` automatically if it crashes

### Usage

Run it alongside the dev server in a separate terminal:

```bash
# Terminal 1 — server
npm run dev

# Terminal 2 — tunnel
npm run tunnel
```

### Prerequisites

Install cloudflared:

```bash
# macOS
brew install cloudflare/cloudflare/cloudflared

# Linux
# See https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/
```

### For Mac Mini deployment

Use PM2 to manage both processes (see "With PM2" above). PM2 will restart either process if it crashes.

## Testing locally

Use the simulate script to send a fake webhook to your running server:

```bash
# Start the server first
npm run dev

# --- GitHub ---
# Send a test webhook for PR #42 (uses first repo in GITHUB_REPOS)
npm run simulate -- 42

# Or specify a repo explicitly
npm run simulate -- 42 cobeisfresh/DnevnikHr

# --- GitLab ---
# Send a test webhook for MR !15 (uses first repo in GITLAB_REPOS)
npm run simulate -- --gitlab 15

# Or specify a repo explicitly
npm run simulate -- --gitlab 15 cobeisfresh/mobile-app
```

## Webhook endpoints

| Endpoint                | Source | Verified by                      |
| ----------------------- | ------ | -------------------------------- |
| `POST /webhook`         | GitHub | `X-Hub-Signature-256` (HMAC)     |
| `POST /webhook/gitlab`  | GitLab | `X-Gitlab-Token` (shared secret) |

## How it works

1. GitHub/GitLab sends a webhook when a PR/MR is opened or updated on any configured repo.
2. The server verifies the webhook signature/token and checks the repo against the allowed list.
3. Changed files are fetched via the respective API (generated/binary files are filtered out).
4. The diffs are sent to Claude for review.
5. Claude's review is posted back as a PR review comment (GitHub) or MR note (GitLab).
