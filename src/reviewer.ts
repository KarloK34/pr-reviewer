import Anthropic from "@anthropic-ai/sdk";
import { loadConfig } from "./config";

export interface PRContext {
  title: string;
  author: string;
  baseBranch: string;
  headBranch: string;
  pullNumber: number;
}

export interface FileDiff {
  filename: string;
  status: string;
  patch: string;
}

let client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!client) {
    const config = loadConfig();
    client = new Anthropic({ apiKey: config.anthropicApiKey });
  }
  return client;
}

function buildUserMessage(prContext: PRContext, fileDiffs: FileDiff[]): string {
  const header = [
    `**PR #${prContext.pullNumber}:** ${prContext.title}`,
    `**Author:** ${prContext.author}`,
    `**Branch:** ${prContext.headBranch} → ${prContext.baseBranch}`,
    `**Files changed:** ${fileDiffs.length}`,
  ].join("\n");

  const diffs = fileDiffs
    .map((file) => `### ${file.filename} (${file.status})\n\`\`\`diff\n${file.patch}\n\`\`\``)
    .join("\n\n");

  return `${header}\n\n---\n\n${diffs}`;
}

/** Send PR diffs to Claude and get a code review back as markdown. */
export async function reviewCode(
  prContext: PRContext,
  fileDiffs: FileDiff[],
  systemPrompt: string
): Promise<string> {
  const anthropic = getClient();

  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 1500,
    system: systemPrompt,
    messages: [
      {
        role: "user",
        content: buildUserMessage(prContext, fileDiffs),
      },
    ],
  });

  const text = response.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n");

  return text;
}
