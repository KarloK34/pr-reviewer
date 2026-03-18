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
| `GITLAB_ACCESS_TOKEN`   | Personal or project access token with `api` scope            |
| `GITLAB_WEBHOOK_SECRET` | Secret token configured in the GitLab webhook settings       |
| `GITLAB_REPOS`          | Comma-separated list of repos in `namespace/repo` format     |

GitLab support is **disabled by default**. Set all three `GITLAB_*` variables to enable it. If only some are set, the server will throw an error on startup.

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

Other useful PM2 commands:

```bash
pm2 status        # check status
pm2 logs pr-reviewer  # view logs
pm2 restart pr-reviewer
pm2 stop pr-reviewer
```

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

| Endpoint            | Source | Verified by                    |
| ------------------- | ------ | ------------------------------ |
| `POST /webhook`     | GitHub | `X-Hub-Signature-256` (HMAC)   |
| `POST /webhook/gitlab` | GitLab | `X-Gitlab-Token` (shared secret) |

## How it works

1. GitHub/GitLab sends a webhook when a PR/MR is opened or updated on any configured repo.
2. The server verifies the webhook signature/token and checks the repo against the allowed list.
3. Changed files are fetched via the respective API (generated/binary files are filtered out).
4. The diffs are sent to Claude for review.
5. Claude's review is posted back as a PR review comment (GitHub) or MR note (GitLab).
