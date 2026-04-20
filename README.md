# pr-reviewer

AI-powered PR/MR reviewer using Claude. Runs as a **GitHub composite action** and a **GitLab CI job** — no persistent server required.

When a PR or MR is opened or updated, the CI pipeline fetches the diff, sends it to Claude with your project-specific system prompt, and posts the review as a comment.

---

## How it works

1. A PR/MR is opened or updated in a target repo.
2. The CI pipeline triggers the reviewer job.
3. Changed files are fetched via the respective API (generated/binary files are filtered out).
4. The diffs are sent to Claude along with your project's system prompt.
5. Claude's review is posted back as a PR review comment (GitHub) or MR note (GitLab).

---

## GitHub Setup

### 1. Add the workflow file

Copy [`docs/examples/github-workflow.yml`](docs/examples/github-workflow.yml) to `.github/workflows/pr-review.yml` in your target repo.

### 2. Add the system prompt

Create `.github/pr-reviewer-prompt.md` in your target repo with instructions tailored to your stack. Example:

```markdown
You are a senior React/TypeScript developer reviewing a pull request.
Focus on: hook usage, component re-render performance, type safety...
```

### 3. Add the secret

In the target repo go to **Settings → Secrets and variables → Actions** and add:

| Secret | Value |
|--------|-------|
| `ANTHROPIC_API_KEY` | Your Anthropic API key |

The `GITHUB_TOKEN` is provided automatically by GitHub Actions — no configuration needed.

---

## GitLab Setup

### 1. Add the CI job

Copy the job from [`docs/examples/gitlab-ci-snippet.yml`](docs/examples/gitlab-ci-snippet.yml) into your project's `.gitlab-ci.yml`.

> **Merging into an existing `.gitlab-ci.yml`** — The `ai-pr-review` job uses `stage: .pre`, a GitLab built-in stage that runs before all user-defined stages. You do not need to add anything to your `stages:` list. Simply paste the job block anywhere in your existing `.gitlab-ci.yml`.

### 2. Add the system prompt

Create `.gitlab/pr-reviewer-prompt.md` in your target repo with instructions tailored to your stack.

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
    ├── run-gitlab.ts               GitLab CI entry point
    ├── github.ts                   GitHub API integration
    ├── gitlab.ts                   GitLab API integration
    ├── reviewer.ts                 Claude AI review logic
    ├── config.ts                   Config loading
    └── filter.ts                   File filtering
```
