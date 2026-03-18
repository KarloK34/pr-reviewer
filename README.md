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

For development with a tunnel, open a second terminal:

```bash
npm run tunnel
```

### Production

```bash
npm run build
npm start
```

## Mac Mini deployment

### First-time setup

1. SSH into the Mac Mini:

```bash
ssh user@mac-mini-ip
```

2. Clone the repo and configure:

```bash
git clone <repo-url> pr-reviewer
cd pr-reviewer
cp .env.example .env
# Edit .env with your values
# Place the .pem file and set GITHUB_PRIVATE_KEY_PATH
```

3. Install prerequisites:

```bash
# Node.js (if not installed)
brew install node

# PM2
npm install -g pm2

# Cloudflare tunnel
brew install cloudflare/cloudflare/cloudflared
```

4. Deploy:

```bash
./deploy.sh
```

The deploy script will:
- Install npm dependencies
- Build the TypeScript project
- Start both PM2 processes (server + tunnel)
- Save the PM2 process list
- Print instructions for setting up auto-start on reboot

5. Set up auto-start on reboot (one-time):

```bash
pm2 startup
# Copy and run the command it outputs (requires sudo)
pm2 save
```

### Viewing logs

```bash
# All logs
pm2 logs

# Server logs only
pm2 logs pr-reviewer

# Tunnel logs only
pm2 logs pr-reviewer-tunnel

# Log files are also saved to:
#   logs/pr-reviewer-out.log
#   logs/pr-reviewer-error.log
#   logs/pr-reviewer-tunnel-out.log
#   logs/pr-reviewer-tunnel-error.log
```

### Finding the current tunnel URL

The tunnel URL changes each time cloudflared restarts. Find the current one:

```bash
pm2 logs pr-reviewer-tunnel --lines 50 | grep trycloudflare.com
```

You don't need to manually update webhooks — the tunnel manager automatically updates GitHub and GitLab webhook URLs whenever a new tunnel URL is detected.

### Managing processes

```bash
# Check status of both processes
pm2 status

# Restart the server
pm2 restart pr-reviewer

# Restart the tunnel (will get a new URL and auto-update webhooks)
pm2 restart pr-reviewer-tunnel

# Restart both
pm2 restart all

# Stop both
pm2 stop all
```

### Updating configuration

To add or remove repos from `GITHUB_REPOS` or `GITLAB_REPOS`:

1. SSH into the Mac Mini
2. Edit the `.env` file
3. Restart both processes:

```bash
pm2 restart all
```

### Redeploying after code changes

```bash
ssh user@mac-mini-ip
cd pr-reviewer
git pull
./deploy.sh
```

### Verifying the deployment

Once the tunnel is up:

```bash
# Find the tunnel URL
pm2 logs pr-reviewer-tunnel --lines 50 | grep trycloudflare.com

# Health check
curl https://<tunnel-url>/health
# Should return: {"status":"ok"}
```

## Tunnel manager

The tunnel manager replaces manually running `cloudflared`. It:

1. Spawns `cloudflared tunnel --url http://localhost:3000`
2. Detects the generated `*.trycloudflare.com` URL
3. Automatically updates the webhook URL on GitHub (via `PATCH /app/hook/config`) and GitLab (via project hooks API)
4. Restarts `cloudflared` automatically if it crashes (with a 5s delay)

PM2 also restarts the tunnel manager itself if it crashes (max 10 restarts).

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
