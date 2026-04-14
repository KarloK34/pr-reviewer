// issue-coder.ts — Autonomous GitLab issue implementation agent
// Clones the repo, runs Claude Code CLI to implement the issue,
// then pushes a branch and opens a Merge Request.
//
// Uses Claude Code's --print (headless) mode authenticated via your Claude.ai
// team subscription — no Anthropic API key consumed for the coding step.

import fs from "fs";
import path from "path";
import { exec as execCb } from "child_process";
import { spawn } from "child_process";
import { promisify } from "util";
import { Config } from "./config";
import {
  fetchIssue,
  fetchIssueNotes,
  createMergeRequest,
  IssueDetails,
} from "./gitlab-issues";

const exec = promisify(execCb);

// ─── Agent prompt ─────────────────────────────────────────────────────────────

function buildAgentPrompt(issue: IssueDetails): string {
  const lines: string[] = [
    `# Issue #${issue.iid}: ${issue.title}`,
    "",
    "## Description",
    issue.description || "(no description provided)",
  ];

  if (issue.labels.length > 0) {
    const filteredLabels = issue.labels.filter(
      (l) => !l.startsWith("target:") && l !== "claude-code"
    );
    if (filteredLabels.length > 0) {
      lines.push("", "## Labels", filteredLabels.join(", "));
    }
  }

  if (issue.notes.length > 0) {
    lines.push("", "## Discussion");
    for (const note of issue.notes) {
      lines.push("", `**${note.author}:**`, note.body);
    }
  }

  lines.push(
    "",
    "---",
    "You are working in a Flutter/Dart repository. Implement this issue by:",
    "1. Exploring the codebase to understand the existing structure and patterns",
    "2. Making the necessary changes following the existing architecture exactly",
    "3. Keeping changes minimal and focused — do NOT modify unrelated code",
    "4. Running `flutter analyze` when done to verify no errors were introduced"
  );

  return lines.join("\n");
}

// ─── Claude Code subprocess ───────────────────────────────────────────────────

async function runCodingAgent(
  repoDir: string,
  issue: IssueDetails
): Promise<void> {
  const prompt = buildAgentPrompt(issue);

  console.log(
    `[issue-coder] Starting Claude Code for issue #${issue.iid} "${issue.title}"`
  );

  return new Promise((resolve, reject) => {
    // Remove ANTHROPIC_API_KEY so Claude Code uses the team subscription
    // (not API credits) — the key is only needed by the PR reviewer
    const env = { ...process.env };
    delete env.ANTHROPIC_API_KEY;

    const proc = spawn(
      "claude",
      [
        "--print",
        "--allowedTools",
        "Edit,Read,Write,Bash,Glob,Grep",
      ],
      {
        cwd: repoDir,
        stdio: ["pipe", "pipe", "pipe"],
        env,
      }
    );

    // Feed the prompt via stdin
    proc.stdin.write(prompt);
    proc.stdin.end();

    // Stream output to our logs
    proc.stdout.on("data", (data: Buffer) => {
      const text = data.toString().trim();
      if (text) console.log(`[claude] ${text}`);
    });

    proc.stderr.on("data", (data: Buffer) => {
      const text = data.toString().trim();
      if (text) console.error(`[claude:err] ${text}`);
    });

    proc.on("error", (err) => {
      reject(
        new Error(
          `Failed to spawn 'claude': ${err.message}\n` +
            "Make sure Claude Code is installed and authenticated: https://claude.ai/download"
        )
      );
    });

    proc.on("close", (code) => {
      if (code === 0) {
        console.log(`[issue-coder] Claude Code finished for issue #${issue.iid}`);
        resolve();
      } else {
        reject(new Error(`Claude Code exited with code ${code}`));
      }
    });
  });
}

// ─── Git operations ───────────────────────────────────────────────────────────

async function cloneRepo(
  repoPath: string,
  cloneToken: string,
  gitlabUrl: string
): Promise<string> {
  const tmpDir = `/tmp/claude-agent-${Date.now()}`;
  const host = new URL(gitlabUrl).host;
  const cloneUrl = `https://oauth2:${cloneToken}@${host}/${repoPath}.git`;

  console.log(`[issue-coder] Cloning ${repoPath}`);
  await exec(`git clone "${cloneUrl}" "${tmpDir}"`);
  await exec(`git config user.email "claude-agent@pr-reviewer.local"`, {
    cwd: tmpDir,
  });
  await exec(`git config user.name "Claude Agent"`, { cwd: tmpDir });

  return tmpDir;
}

async function commitAndPush(
  repoDir: string,
  branchName: string,
  issue: IssueDetails
): Promise<void> {
  await exec(`git checkout -b "${branchName}"`, { cwd: repoDir });
  await exec(`git add -A`, { cwd: repoDir });

  const { stdout: statusOut } = await exec(`git status --porcelain`, {
    cwd: repoDir,
  });
  if (!statusOut.trim()) {
    throw new Error("The agent made no file changes");
  }

  const msgFile = path.join(repoDir, ".git", "CLAUDE_MSG");
  fs.writeFileSync(
    msgFile,
    `feat: implement issue #${issue.iid}\n\nCloses #${issue.iid}\n\nAutomatically implemented by Claude Code.`
  );
  await exec(`git commit -F ".git/CLAUDE_MSG"`, { cwd: repoDir });
  fs.unlinkSync(msgFile);

  await exec(`git push origin "${branchName}"`, { cwd: repoDir });
  console.log(`[issue-coder] Pushed branch: ${branchName}`);
}

// ─── Main orchestrator ────────────────────────────────────────────────────────

export async function handleIssueAgent(
  payload: Record<string, any>,
  targetBranch: string,
  config: Config
): Promise<void> {
  const gitlabConfig = config.gitlab!;
  const coderConfig = config.gitlabCoder!;

  const issueAttrs = payload.object_attributes;
  const projectId: number = payload.project.id;
  const projectPath: string = payload.project.path_with_namespace;
  const issueIid: number = issueAttrs.iid;

  console.log(
    `[issue-coder] Issue #${issueIid} in ${projectPath} → branch target: ${targetBranch}`
  );

  let tmpDir: string | null = null;

  try {
    // 1. Fetch issue + discussion
    const [summary, notes] = await Promise.all([
      fetchIssue(projectId, issueIid, gitlabConfig),
      fetchIssueNotes(projectId, issueIid, gitlabConfig),
    ]);
    const issue: IssueDetails = {
      ...summary,
      notes,
      projectId,
      projectPath,
    };

    // 2. Clone repo
    tmpDir = await cloneRepo(
      projectPath,
      coderConfig.cloneToken,
      gitlabConfig.url
    );

    // 3. Run Claude Code (uses team subscription, not API key)
    await runCodingAgent(tmpDir, issue);

    // 4. Commit + push branch
    const branchName = `claude-code/issue-${issueIid}`;
    await commitAndPush(tmpDir, branchName, issue);

    // 5. Create MR (auto-links to issue via "Closes #iid" in description)
    const mrIid = await createMergeRequest(
      projectId,
      {
        sourceBranch: branchName,
        targetBranch,
        title: `[Claude] ${issue.title}`,
        description: [
          `Closes #${issueIid}`,
          "",
          `Automatically implemented by Claude Code for issue #${issueIid}.`,
          "",
          `> This MR will be reviewed by the automated PR reviewer bot.`,
        ].join("\n"),
        labels: ["claude-generated"],
        removeSourceBranch: true,
        reviewerIds: coderConfig.reviewerIds,
      },
      gitlabConfig
    );

    console.log(
      `[issue-coder] Created MR !${mrIid} for issue #${issueIid} → ${targetBranch}`
    );
  } catch (err) {
    console.error(
      `[issue-coder] Failed to process issue #${issueIid}:`,
      err
    );
  } finally {
    if (tmpDir) {
      await fs.promises
        .rm(tmpDir, { recursive: true, force: true })
        .catch(() => {});
      console.log(`[issue-coder] Cleaned up ${tmpDir}`);
    }
  }
}
