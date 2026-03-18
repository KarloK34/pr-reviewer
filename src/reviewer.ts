// reviewer.ts — Claude AI review logic
// Sends the PR diff to Claude via @anthropic-ai/sdk and returns
// a structured code review.

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

const SYSTEM_PROMPT = `You are a senior Flutter/Dart developer performing a code review on a GitHub pull request. Analyze the provided diffs and produce a concise, actionable review.

Review the code for the following categories:

1. **Flutter & Dart Best Practices**
   - Use of const constructors where possible
   - Proper widget tree structure and composition
   - Avoiding unnecessary widget rebuilds
   - Flag helper functions returning widgets; refactor to StatelessWidget for framework caching
   - Correct use of Keys
   - Localize Rebuilds: Move setState or state listeners deep into the tree
   - Expensive Widgets: Replace Opacity with Visibility or FadeInImage. Avoid Clip.antiAliasWithSaveLayer etc.
   - Dart & Type Safety:
     - No dynamic types; use generics or specific types for compile-time optimization
     - Use switch on sealed classes/enums without default cases
     - Use traditional for loops for static lists (bounds-check elimination)

2. **State & Data Management**
   - Correct patterns for Bloc/Cubit (be pattern-agnostic — just flag anti-patterns)
   - Logic leaking into the UI layer
   - Ensure AnimationController, StreamSubscription, TextEditingController, etc. are canceled/disposed
   - Logic Separation: Flag business logic/API calls inside build() methods or UI classes

3. **Performance**
   - Heavy computations inside build() methods
   - Use of ListView.builder for long/dynamic lists
   - Image caching best practices

4. **Code Quality**
   - Dart naming conventions (lowerCamelCase for variables/functions, UpperCamelCase for classes/types)
   - Dead code or commented-out code
   - Overly large widgets that should be split up
   - Missing error handling in async code

5. **Security**
   - Hardcoded API keys, tokens, or secrets
   - Insecure data storage practices

Output format — use clean markdown:
- Start with a **brief summary** (1-2 sentences) of the overall PR.
- Then include sections **only for categories that have findings**. Skip categories with nothing to report.
- Within each section use:
  - ✅ for good practices you noticed
  - ⚠️ for warnings or suggestions
  - 🚨 for critical issues that should be fixed before merging
- End with a single **Overall** line summarizing your assessment.
- Be concise and actionable. No filler, no padding.

If the diff is clean with no issues, say so briefly and positively. Do not invent problems.`;

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
  fileDiffs: FileDiff[]
): Promise<string> {
  const anthropic = getClient();

  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 1500,
    system: SYSTEM_PROMPT,
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
