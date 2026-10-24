// Shared frontend helpers for Human tasks: kind metadata, time formatting,
// and the secret detector that keeps credentials out of notes.
import type { HandoffMethod, TaskKind, TodoStatus } from "../server";

export const KIND_META: Record<TaskKind, { label: string; icon: string; description: string }> = {
  access: { label: "Access", icon: "human-tasks/key", description: "Credentials, permissions, invites" },
  setup: { label: "Setup", icon: "human-tasks/globe", description: "Dashboards, DNS, consoles, store listings" },
  payment: { label: "Payment", icon: "human-tasks/card", description: "Purchases, renewals, signing terms" },
  review: { label: "Review", icon: "human-tasks/eye", description: "Test on a real device, a taste or design call" },
  communicate: { label: "Send as you", icon: "human-tasks/send", description: "Email, posts, calls in your name" },
  physical: { label: "Physical", icon: "human-tasks/box", description: "Anything in the physical world" },
  other: { label: "Other", icon: "human-tasks/hand", description: "Anything else only you can do" },
};

export const STATUS_LABEL: Record<TodoStatus, string> = {
  open: "To do",
  in_progress: "In progress",
  done: "Done",
  dismissed: "Dismissed",
};

export function isFinished(task: { status: TodoStatus }): boolean {
  return task.status === "done" || task.status === "dismissed";
}

export function timeAgo(ms: number): string {
  const seconds = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(ms).toLocaleDateString();
}

const SECRET_PATTERNS: [RegExp, string][] = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, "a private key"],
  [/\b(sk|rk|pk)_(live|test)_[A-Za-z0-9]{10,}/, "a Stripe key"],
  [/\bgh[pousr]_[A-Za-z0-9]{20,}|\bgithub_pat_[A-Za-z0-9_]{20,}/, "a GitHub token"],
  [/\bAKIA[0-9A-Z]{16}\b/, "an AWS access key"],
  [/\bxox[abprs]-[A-Za-z0-9-]{10,}/, "a Slack token"],
  [/\bAIza[0-9A-Za-z_-]{30,}/, "a Google API key"],
  [/\bsk-(proj-|ant-)?[A-Za-z0-9_-]{20,}/, "an API key"],
  [/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/, "a token"],
  [/\b(password|passwd|secret|api[_ -]?key|token)\s*[:=]\s*\S{6,}/i, "a password or key"],
];

/**
 * Names what looks like a credential in `text`, or null. Long random strings
 * with mixed case and digits count too; plain hex (commit hashes) does not.
 */
export function detectSecret(text: string): string | null {
  for (const [pattern, label] of SECRET_PATTERNS) if (pattern.test(text)) return label;
  for (const word of text.split(/\s+/)) {
    if (word.length >= 32 && /[a-z]/.test(word) && /[A-Z]/.test(word) && /\d/.test(word) && !/^https?:/.test(word)) {
      return "a long random string";
    }
  }
  return null;
}

export const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

/** Short labels for how an agent got access when it did a task itself. */
export const HANDOFF_METHOD_LABEL: Record<HandoffMethod, string> = {
  mcp: "MCP server",
  api_access: "API access",
  cli_login: "CLI login",
  browser: "your browser",
  new_tool: "a new tool",
  skill: "a skill",
  schedule: "a schedule",
  other: "other access",
};

export function isSnoozed(task: { snoozedUntil: number | null }): boolean {
  return task.snoozedUntil !== null && task.snoozedUntil > Date.now();
}

/** The first web link in a task's instructions, for its "open" button. */
export function firstLink(markdown: string): { url: string; host: string } | null {
  const match = markdown.match(/\]\((https?:\/\/[^)\s]+)\)/) ?? markdown.match(/\bhttps?:\/\/[^\s)>\]`"']+/);
  const url = match ? (match[1] ?? match[0]) : null;
  if (!url) return null;
  try {
    return { url, host: new URL(url).hostname.replace(/^www\./, "") };
  } catch {
    return null;
  }
}

const DAY_MS = 24 * 60 * 60 * 1000;

export function dueInfo(dueAt: number): { label: string; urgent: boolean } {
  const days = Math.ceil((dueAt - Date.now()) / DAY_MS);
  if (days < 0) return { label: "Overdue", urgent: true };
  if (days === 0) return { label: "Due today", urgent: true };
  if (days === 1) return { label: "Due tomorrow", urgent: true };
  if (days <= 30) return { label: `Due in ${days}d`, urgent: days <= 3 };
  return { label: `Due ${new Date(dueAt).toLocaleDateString()}`, urgent: false };
}

function atNine(date: Date): number {
  date.setHours(9, 0, 0, 0);
  return date.getTime();
}

export function snoozePresets(now = new Date()): { label: string; until: number }[] {
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  const monday = new Date(now);
  monday.setDate(now.getDate() + (((8 - now.getDay()) % 7) || 7));
  const inAWeek = new Date(now);
  inAWeek.setDate(now.getDate() + 7);
  return [
    { label: "For an hour", until: now.getTime() + 60 * 60 * 1000 },
    { label: "Until tomorrow, 9:00", until: atNine(tomorrow) },
    { label: "Until Monday, 9:00", until: atNine(monday) },
    { label: "For a week", until: atNine(inAWeek) },
  ];
}

export function formatWhen(ms: number): string {
  const date = new Date(ms);
  const sameDay = date.toDateString() === new Date().toDateString();
  const time = date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return sameDay ? time : `${date.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })}, ${time}`;
}
