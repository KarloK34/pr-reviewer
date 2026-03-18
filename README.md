# pr-reviewer

Automated GitHub PR reviewer powered by Claude AI. Runs as a GitHub App that listens for pull request webhooks, analyzes diffs using Claude, and posts code review comments — focused on Flutter/Dart best practices.

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

| Variable                  | Description                                             |
| ------------------------- | ------------------------------------------------------- |
| `PORT`                    | Server port (default: 3000)                             |
| `ANTHROPIC_API_KEY`       | Your Anthropic API key                                  |
| `GITHUB_APP_ID`           | Your GitHub App's ID                                    |
| `GITHUB_WEBHOOK_SECRET`   | The webhook secret you set when creating the GitHub App |
| `GITHUB_PRIVATE_KEY_PATH` | Path to the `.pem` private key file                     |
| `GITHUB_REPO`             | Target repository in `owner/repo` format                |

### 3. GitHub App private key

1. In your GitHub App settings, generate a private key — this downloads a `.pem` file.
2. Place it somewhere safe (e.g., the project root, or `~/.ssh/`).
3. Set `GITHUB_PRIVATE_KEY_PATH` in `.env` to the absolute or relative path:

```
GITHUB_PRIVATE_KEY_PATH=./your-app-name.2024-01-01.private-key.pem
```

> The `.gitignore` already excludes `*.pem` files.

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

# In another terminal, send a test webhook for PR #42
npm run simulate -- 42
```

This reads `GITHUB_WEBHOOK_SECRET` from your `.env` to sign the payload correctly. The server must be running for the request to succeed.

## How it works

1. GitHub sends a `pull_request` webhook when a PR is opened or updated.
2. The server verifies the webhook signature and extracts PR metadata.
3. Changed files are fetched via the GitHub API (generated/binary files are filtered out).
4. The diffs are sent to Claude for review.
5. Claude's review is posted back as a PR comment.
