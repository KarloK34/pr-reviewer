# pr-reviewer

AI-powered PR/MR reviewer using Claude. Runs as a **GitHub composite action** and a **GitLab CI job** — no persistent server required.

When a PR or MR is opened or updated, the CI pipeline invokes the `claude` CLI with your project-specific system prompt. Claude fetches the diff, reads relevant codebase files for context, optionally fetches a linked Jira ticket, and posts the review as a comment.

---

## How it works

1. A PR/MR is opened or updated in a target repo.
2. The CI pipeline triggers the reviewer job and invokes the `claude` CLI.
3. Claude fetches the PR/MR diff via the respective API.
4. Claude reads relevant codebase files for additional context.
5. If a Jira ticket ID is found in the PR title or branch name and a Jira token is configured, Claude fetches the ticket.
6. Claude posts the review as a PR review comment (GitHub) or MR note (GitLab).

---

## GitHub Setup

### 1. Add the workflow file

Copy [`docs/examples/github-workflow.yml`](docs/examples/github-workflow.yml) to `.github/workflows/pr-review.yml` in your target repo.

The workflow runs on `self-hosted` runners by default. Self-hosted runners must have Node.js installed (the action installs the `claude` CLI via npm if it isn't already present). For GitHub-hosted runners, remove the `runs-on: self-hosted` line to use the default `ubuntu-latest`.

### 2. Add the system prompt

Create `.github/pr-reviewer-prompt.md` in your target repo with instructions tailored to your stack. The prompt must tell Claude how to fetch the diff and post the review — Claude has `Read` (filesystem) and `Bash` (curl) available. Example:

```markdown
You are a senior engineer reviewing a GitHub pull request.

Fetch the PR diff:
  curl --silent --header "Authorization: Bearer $GITHUB_TOKEN" \
    "https://api.github.com/repos/${GITHUB_REPOSITORY}/pulls/${PR_NUMBER}/files"

Use the Read tool to open any files that give useful context for the changed code
(imports, interfaces, related modules). Do not read every file — only what is needed.

If JIRA_TOKEN and JIRA_BASE_URL are non-empty, fetch each Jira ticket ID you find
in the PR title or branch name (pattern [A-Z]+-[0-9]+):
  curl --silent --header "Authorization: Bearer $JIRA_TOKEN" \
    "${JIRA_BASE_URL}/rest/api/3/issue/PROJ-123"

Focus your review on: correctness, edge cases, security issues, and readability.

Post the review as a PR review comment:
  curl --silent --request POST \
    --header "Authorization: Bearer $GITHUB_TOKEN" \
    --header "Content-Type: application/json" \
    --data "{\"body\": \"<your review>\", \"event\": \"COMMENT\"}" \
    "https://api.github.com/repos/${GITHUB_REPOSITORY}/pulls/${PR_NUMBER}/reviews"
```

### 3. Add secrets

In the target repo go to **Settings → Secrets and variables → Actions** and add:

| Secret | Required | Notes |
|--------|----------|-------|
| `ANTHROPIC_API_KEY` | Yes | Your Anthropic API key |
| `JIRA_TOKEN` | No | Jira API token; skip to disable Jira integration |
| `JIRA_BASE_URL` | No | Jira base URL, e.g. `https://mycompany.atlassian.net`; required if `JIRA_TOKEN` is set |

The `GITHUB_TOKEN` is provided automatically by GitHub Actions — no configuration needed.

---

## GitLab Setup

### 1. Add the CI job

Copy the job from [`docs/examples/gitlab-ci-snippet.yml`](docs/examples/gitlab-ci-snippet.yml) into your project's `.gitlab-ci.yml`.

> **Merging into an existing `.gitlab-ci.yml`** — The `ai-pr-review` job uses `stage: .pre`, a GitLab built-in stage that runs before all user-defined stages. You do not need to add anything to your `stages:` list. Simply paste the job block anywhere in your existing `.gitlab-ci.yml`.

The job runs `claude` directly. If the `claude` CLI is not already on the runner, the `before_script` installs it via `npm install -g @anthropic-ai/claude-code`. For GitLab shared runners, add `image: node:24-alpine` to the job.

### 2. Add the system prompt

Create `.gitlab/pr-reviewer-prompt.md` in your target repo with instructions tailored to your stack. Example:

```markdown
You are a senior engineer reviewing a GitLab MR.

Use Bash to fetch the diff:
  curl --silent --header "PRIVATE-TOKEN: $GITLAB_ACCESS_TOKEN" \
    "${CI_SERVER_URL}/api/v4/projects/${CI_PROJECT_ID}/merge_requests/${CI_MERGE_REQUEST_IID}/diffs"

Focus on: correctness, edge cases, security issues, and readability.

When done, post your review as an MR note:
  curl --silent --request POST \
    --header "PRIVATE-TOKEN: $GITLAB_ACCESS_TOKEN" \
    --header "Content-Type: application/json" \
    --data "{\"body\": \"<your review>\"}" \
    "${CI_SERVER_URL}/api/v4/projects/${CI_PROJECT_ID}/merge_requests/${CI_MERGE_REQUEST_IID}/notes"
```

### 3. Add CI/CD variables

In the target repo go to **Settings → CI/CD → Variables** and add:

| Variable | Type | Masked | Protected | Notes |
|----------|------|--------|-----------|-------|
| `ANTHROPIC_API_KEY` | Variable | Yes | No | Your Anthropic API key |
| `GITLAB_ACCESS_TOKEN` | Variable | Yes | **No** | Project access token with `api` scope. Must be **non-protected** so it is available on feature branch MR pipelines, which are not protected branches. |

---

## File filtering

The following files are automatically excluded from review regardless of what the system prompt says:

- Generated Dart files: `.g.dart`, `.freezed.dart`, `.mocks.dart`
- Images: `.png`, `.jpg`, `.jpeg`, `.gif`, `.bmp`, `.ico`, `.svg`, `.webp`
- Lock files: `pubspec.lock`
- Asset directories: `assets/`

File patches are truncated to 3000 characters to stay within token limits.

---

## Repository structure

```
pr-reviewer/
├── action.yml                      GitHub composite action definition
├── .gitlab-ci-template.yml         GitLab CI template (reference copy)
├── docs/
│   └── examples/
│       ├── github-workflow.yml     Copy into target GitHub repos
│       └── gitlab-ci-snippet.yml  Merge into target GitLab repos
└── src/
    ├── run-github.ts               GitHub Actions entry point
    ├── github.ts                   GitHub API integration
    ├── gitlab.ts                   GitLab API integration
    ├── reviewer.ts                 Claude AI review logic
    ├── config.ts                   Config loading
    └── filter.ts                   File filtering
```
