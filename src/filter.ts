// filter.ts — Shared file filtering logic for GitHub and GitLab

export const MAX_TOTAL_DIFF_LENGTH = 100_000;

const IGNORED_EXTENSIONS = [
  ".g.dart",
  ".freezed.dart",
  ".mocks.dart",
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".bmp",
  ".ico",
  ".svg",
  ".webp",
];

const IGNORED_FILENAMES = ["pubspec.lock"];

export function isIgnoredFile(filename: string): boolean {
  if (IGNORED_FILENAMES.includes(filename.split("/").pop() || "")) return true;
  if (filename.startsWith("assets/")) return true;
  const lower = filename.toLowerCase();
  return IGNORED_EXTENSIONS.some((ext) => lower.endsWith(ext));
}
