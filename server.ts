// bb-plugin-human-tasks — the steps only the user can do, handed over by agents.
//
// Agents create tasks with the `human_task_create` tool (or the
// `bb human-tasks add` CLI). Each task remembers the thread that asked for it.
// When the user finishes it, the plugin tells that thread, but only if the
// thread still exists and is not archived. Blocking tasks also open bb's
// native input form in the thread, so it shows as waiting on the user and
// push notifications fire. The design rationale lives in .sitbeh/.
import { randomUUID } from "node:crypto";
import {
  PluginCliError,
  cliCommand,
  defineCli,
  defineRpcContract,
  type BbPluginApi,
} from "@get-bb/plugin-sdk";
import { z } from "zod";
import { HANDOFF_METHODS, KINDS } from "./lib/model";

// ---- Model -----------------------------------------------------------------

const STATUSES = ["open", "in_progress", "done", "dismissed"] as const;
const statusSchema = z.enum(STATUSES);
export type TodoStatus = z.infer<typeof statusSchema>;

const kindSchema = z.enum(KINDS);
export type TaskKind = z.infer<typeof kindSchema>;

const handoffMethodSchema = z.enum(HANDOFF_METHODS);
export type HandoffMethod = z.infer<typeof handoffMethodSchema>;

const notifySchema = z.enum(["notified", "skipped", "failed"]);

const secretSchema = z.object({ name: z.string(), description: z.string() });
export type SecretRequest = z.infer<typeof secretSchema>;

const todoSchema = z.object({
  id: z.string(),
  title: z.string(),
  instructions: z.string(),
  /** What the requesting agent would need to do this itself, this time and next. */
  agentNeeds: z.string().nullable(),
  kind: kindSchema,
  blocking: z.boolean(),
  replyPrompt: z.string().nullable(),
  secrets: z.array(secretSchema),
  envFile: z.string().nullable(),
  status: statusSchema,
  sourceThreadId: z.string().nullable(),
  sourceProjectId: z.string().nullable(),
  sourceThreadTitle: z.string().nullable(),
  sourceBotId: z.string().nullable(),
  watcherThreadIds: z.array(z.string()),
  /** How the agent got access when it did the task itself. */
  handoffMethod: handoffMethodSchema.nullable(),
  handoffSummary: z.string().nullable(),
  /** The user asked the agent to do it instead. */
  handedBack: z.boolean(),
  /** The agent did it after the user handed it back. */
  doneByAgent: z.boolean(),
  handbackNote: z.string().nullable(),
  /** The agent's latest word on the task, e.g. why it reopened it. */
  agentNote: z.string().nullable(),
  /** The user's open question to the agent, until the agent updates the task. */
  question: z.string().nullable(),
  questionAt: z.number().nullable(),
  dueAt: z.number().nullable(),
  snoozedUntil: z.number().nullable(),
  createdAt: z.number(),
  updatedAt: z.number(),
  completedAt: z.number().nullable(),
  completionNote: z.string().nullable(),
  notifyResult: notifySchema.nullable(),
  notifyDetail: z.string().nullable(),
  /** When the requesting thread got busy again after the task was done. */
  resumedAt: z.number().nullable(),
});
export type Todo = z.infer<typeof todoSchema>;

/** `unknown` for finished tasks, whose thread state isn't looked up. */
const threadStateSchema = z.enum(["live", "archived", "deleted", "unknown"]);
export type ThreadState = z.infer<typeof threadStateSchema>;

const botSchema = z.object({ id: z.string(), name: z.string(), role: z.string(), color: z.string().nullable(), mainThreadId: z.string().nullable() });
export type BotInfo = z.infer<typeof botSchema>;

/** A task plus its relations, resolved live so renames show up. */
const todoViewSchema = todoSchema.extend({
  thread: z.object({ id: z.string(), title: z.string().nullable(), state: threadStateSchema }).nullable(),
  project: z.object({ id: z.string(), name: z.string() }).nullable(),
  bot: botSchema.extend({ via: z.enum(["thread", "project"]) }).nullable(),
  /** Other tasks that look like the same chore, and one an agent already did. */
  recurrence: z.object({
    count: z.number(),
    agentDidSimilar: z.object({ taskId: z.string(), method: handoffMethodSchema.nullable() }).nullable(),
  }),
  /** True while the requesting thread shows this task's input form. */
  waitingInThread: z.boolean(),
});
export type TodoView = z.infer<typeof todoViewSchema>;

const statsSchema = z.object({ open: z.number(), blocking: z.number(), done: z.number(), doneByAgents: z.number() });
export type TaskStats = z.infer<typeof statsSchema>;

const summarySchema = z.object({ open: z.number(), blocking: z.number() });

// The slice of the bots-sidebar plugin's public `bots_list` RPC this plugin
// reads. Loose on purpose: unknown fields pass, so its releases do not break us.
const BOTS_PLUGIN_ID = "bots-sidebar";
const botsListSchema = z.object({
  bots: z.array(
    z.looseObject({
      id: z.string(),
      name: z.string(),
      role: z.string().catch(""),
      avatar: z.looseObject({ color: z.string() }).nullable().catch(null),
      mainThreadId: z.string().nullable().catch(null),
    }),
  ),
  threadBindings: z.array(z.looseObject({ threadId: z.string(), botId: z.string() })),
  projectOwners: z.array(z.looseObject({ projectId: z.string(), botId: z.string() })).optional().catch(undefined),
});
type BotsDirectory = z.infer<typeof botsListSchema>;

const TITLE_MAX = 160;
const INSTRUCTIONS_MAX = 8000;
const HINT_MAX = 3000;
const NOTE_MAX = 4000;
const REPLY_PROMPT_MAX = 300;
const SECRETS_MAX = 10;

const titleInput = z.string().trim().min(1).max(TITLE_MAX);
const instructionsInput = z.string().trim().min(1).max(INSTRUCTIONS_MAX);
const hintInput = z.string().trim().max(HINT_MAX);
const noteInput = z.string().trim().max(NOTE_MAX);
const replyPromptInput = z.string().trim().max(REPLY_PROMPT_MAX);
const secretNameInput = z.string().regex(/^[A-Z_][A-Z0-9_]{0,63}$/, "use an env var name like STRIPE_API_KEY");
const secretsInput = z.array(z.object({ name: secretNameInput, description: z.string().trim().min(1).max(200) })).max(SECRETS_MAX);
const envFileInput = z.string().trim().min(1).max(500);
/** An ISO date ("2026-11-02") or date-time, turned into epoch ms. */
const dateInput = z
  .string()
  .trim()
  .refine((value) => !Number.isNaN(Date.parse(value)), "use an ISO date like 2026-11-02 or 2026-11-02T09:00");

/** The value the in-thread form submits. */
const interactionValueSchema = z.object({
  action: z.enum(["done", "dismiss", "hand_back"]),
  note: noteInput.optional(),
});

export const rpcContract = defineRpcContract({
  todos_list: {
    /** `openOnly` skips finished tasks, for small surfaces such as the home screen. */
    input: z.object({ openOnly: z.boolean() }).nullable(),
    output: z.object({ todos: z.array(todoViewSchema), stats: statsSchema, bots: z.array(botSchema) }),
  },
  todos_summary: { input: z.null(), output: summarySchema },
  todos_for_thread: {
    input: z.object({ threadId: z.string() }),
    output: z.object({ todos: z.array(todoSchema.extend({ waitingInThread: z.boolean() })) }),
  },
  todos_get: { input: z.object({ id: z.string() }), output: todoViewSchema.nullable() },
  todos_set_status: {
    input: z.object({ id: z.string(), status: statusSchema, note: noteInput.optional() }),
    output: todoSchema,
  },
  todos_snooze: {
    input: z.object({ id: z.string(), until: z.number().nullable() }),
    output: todoSchema,
  },
  todos_ask: {
    input: z.object({ id: z.string(), question: z.string().trim().min(1).max(NOTE_MAX) }),
    output: todoSchema,
  },
  todos_hand_back: {
    input: z.object({ id: z.string(), note: noteInput.optional() }),
    output: todoSchema,
  },
  todos_remove: { input: z.object({ id: z.string() }), output: z.object({ removed: z.boolean() }) },
  todos_take_back: { input: z.object({ id: z.string() }), output: todoSchema },
});

/** Realtime channels the app listens on. */
const TODOS_CHANGED = "todos-changed";
const TASK_CREATED = "task-created";
const TASK_EVENT = "task-event";
export interface TaskCreatedSignal {
  id: string;
  title: string;
  blocking: boolean;
  kind: TaskKind;
  from: string | null;
}
/** Payload of the coalesced change signal. `threadIds` is null when any thread may be affected. */
export interface TodosChangedSignal {
  threadIds: string[] | null;
  open: number;
  blocking: number;
}
/** Things that happen to a task without the user doing them. */
export interface TaskEventSignal {
  id: string;
  title: string;
  event: "due" | "reopened" | "answered" | "completed_by_agent" | "handback_cancelled";
  detail: string | null;
}

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
/** How long after completion thread activity still counts as "resumed". */
const RESUME_WINDOW_MS = 12 * 60 * 60 * 1000;

interface TodoRow {
  id: string;
  title: string;
  instructions: string;
  automation_hint: string | null;
  kind: TaskKind;
  blocking: number;
  reply_prompt: string | null;
  secrets: string | null;
  env_file: string | null;
  status: TodoStatus;
  source_thread_id: string | null;
  source_project_id: string | null;
  source_thread_title: string | null;
  source_bot_id: string | null;
  watcher_thread_ids: string;
  automation_thread_id: string | null;
  automation_outcome: string | null;
  automation_summary: string | null;
  handoff_method: HandoffMethod | null;
  handed_back: number;
  handback_note: string | null;
  agent_note: string | null;
  question: string | null;
  question_at: number | null;
  due_at: number | null;
  snoozed_until: number | null;
  created_at: number;
  updated_at: number;
  completed_at: number | null;
  completion_note: string | null;
  notify_result: Todo["notifyResult"];
  notify_detail: string | null;
  resumed_at: number | null;
  form_state: "pending" | "shown" | "deferred" | null;
  handback_message_id: string | null;
}

function parseJsonArray<T>(text: string | null, schema: z.ZodType<T>): T[] {
  if (!text) return [];
  try {
    const parsed = z.array(schema).safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : [];
  } catch {
    return [];
  }
}

function fromRow(row: TodoRow): Todo {
  return {
    id: row.id,
    title: row.title,
    instructions: row.instructions,
    agentNeeds: row.automation_hint,
    kind: kindSchema.catch("other").parse(row.kind),
    blocking: row.blocking === 1,
    replyPrompt: row.reply_prompt,
    secrets: parseJsonArray(row.secrets, secretSchema),
    envFile: row.env_file,
    status: row.status,
    sourceThreadId: row.source_thread_id,
    sourceProjectId: row.source_project_id,
    sourceThreadTitle: row.source_thread_title,
    sourceBotId: row.source_bot_id,
    watcherThreadIds: parseJsonArray(row.watcher_thread_ids, z.string()),
    handoffMethod: handoffMethodSchema.nullable().catch(null).parse(row.handoff_method),
    handoffSummary: row.automation_summary,
    handedBack: row.handed_back === 1,
    doneByAgent: row.handed_back === 1 && row.status === "done",
    handbackNote: row.handback_note,
    agentNote: row.agent_note,
    question: row.question,
    questionAt: row.question_at,
    dueAt: row.due_at,
    snoozedUntil: row.snoozed_until,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
    completionNote: row.completion_note,
    notifyResult: row.notify_result,
    notifyDetail: row.notify_detail,
    resumedAt: row.resumed_at,
  };
}

const isFinished = (todo: Pick<Todo, "status">) => todo.status === "done" || todo.status === "dismissed";

// ---- Text helpers ------------------------------------------------------------

const STOPWORDS = new Set("a an the to for in on of and or with your my our at by from into via is be it this that as up".split(" "));

function normalizeTitle(title: string): string {
  return title.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

function titleTokens(title: string): Set<string> {
  return new Set(normalizeTitle(title).split(" ").filter((word) => word.length > 1 && !STOPWORDS.has(word)));
}

/** Strip characters that would break out of a double-quoted shell argument. */
function shellSafe(text: string): string {
  return text.replace(/["`$\\]/g, "").replace(/\s+/g, " ").trim();
}

const STATUS_LABEL: Record<TodoStatus, string> = { open: "open", in_progress: "in progress", done: "done", dismissed: "dismissed" };

export const HANDOFF_METHOD_LABEL: Record<HandoffMethod, string> = {
  mcp: "an MCP server",
  api_access: "API access",
  cli_login: "a CLI login",
  browser: "your browser session",
  new_tool: "a new tool or API",
  skill: "a skill",
  schedule: "a scheduled automation",
  other: "another way",
};

function formatTodoLine(todo: Todo): string {
  const box = todo.status === "done" ? "[x]" : "[ ]";
  const flags = [
    STATUS_LABEL[todo.status],
    todo.kind,
    ...(todo.blocking ? ["blocking"] : []),
    ...(todo.handedBack && !isFinished(todo) ? ["handed back to agent"] : []),
    ...(todo.dueAt ? [`due ${new Date(todo.dueAt).toISOString().slice(0, 10)}`] : []),
  ].join(", ");
  return `${box} ${todo.id}  ${todo.title}  (${flags})`;
}

/** What another thread may see of a task it neither created nor joined: no user notes or answers. */
function redacted<T extends Todo>(todo: T): T {
  return { ...todo, completionNote: null, question: null, handbackNote: null, agentNote: null };
}

function formatTodoDetail(todo: Todo | TodoView): string {
  const lines = [formatTodoLine(todo)];
  if ("project" in todo && todo.project) lines.push(`Project: ${todo.project.name} (${todo.project.id})`);
  if ("bot" in todo && todo.bot) lines.push(`Bot: ${todo.bot.name} (${todo.bot.id})`);
  lines.push("", todo.instructions);
  if (todo.replyPrompt) lines.push("", `Asked to send back: ${todo.replyPrompt}`);
  if (todo.secrets.length > 0) lines.push("", `Credentials to hand back: ${todo.secrets.map((s) => s.name).join(", ")}`);
  if (todo.question) lines.push("", `The user asked: ${todo.question}`);
  if (todo.handedBack) lines.push("", `Handed back to the agent${todo.handbackNote ? `: ${todo.handbackNote}` : ""}`);
  if (todo.agentNeeds) lines.push("", `What an agent would need to do it: ${todo.agentNeeds}`);
  if (todo.doneByAgent) {
    lines.push("", `Done by an agent${todo.handoffMethod ? ` via ${HANDOFF_METHOD_LABEL[todo.handoffMethod]}` : ""}${todo.handoffSummary ? `: ${todo.handoffSummary}` : ""}`);
  }
  if (todo.sourceThreadId) lines.push("", `Requested by thread: ${todo.sourceThreadId}`);
  if (todo.completionNote) lines.push("", `User note: ${todo.completionNote}`);
  return lines.join("\n");
}

/** The secure follow-up an agent runs to receive credentials after a task. */
function secretCommand(todo: Todo): string | null {
  if (todo.secrets.length === 0) return null;
  const names = todo.secrets.map((secret) => secret.name).join(" ");
  const describe = todo.secrets.map((secret) => `--describe ${secret.name} "${shellSafe(secret.description)}"`).join(" ");
  const envFile = todo.envFile ? ` --write-env "${shellSafe(todo.envFile)}"` : "";
  return `bb secret request ${names} --purpose "${shellSafe(todo.title)}" ${describe}${envFile}`;
}

function completionMessage(todo: Todo, role: "requester" | "watcher"): string {
  const lines = [
    `[Human tasks] The user finished "${todo.title}" (task ${todo.id}).${role === "watcher" ? " You asked for this too." : ""}`,
    todo.completionNote ? `Their reply: ${todo.completionNote}` : "They left no note.",
  ];
  const command = role === "requester" ? secretCommand(todo) : null;
  if (command) lines.push(`Next, collect the credentials securely with: ${command}`, "Never ask for them in chat, and never print the env file.");
  if (role === "watcher" && todo.secrets.length > 0) lines.push("If you need these credentials too, create your own task for them.");
  lines.push(
    'Check that it worked if you can (for example, query the record or call the API). If it did not, call `human_task_update` with action "send_back" and what is missing.',
    "Continue the work that was waiting on it. If nothing was waiting, acknowledge briefly and stop.",
  );
  return lines.join("\n");
}

function dismissMessage(todo: Todo): string {
  return [
    `[Human tasks] The user dismissed "${todo.title}" (task ${todo.id}). They will not do it.`,
    todo.completionNote ? `Their note: ${todo.completionNote}` : "",
    "Do not wait for it. Find another way, or ask the user how they want to proceed.",
  ]
    .filter(Boolean)
    .join("\n");
}

function handBackMessage(todo: Todo): string {
  return [
    `[Human tasks] The user wants you to do "${todo.title}" (task ${todo.id}) yourself instead.`,
    todo.handbackNote ? `They said: ${todo.handbackNote}` : "",
    "In this thread, tell them exactly what you need and how to give it to you: an MCP server to connect, a scoped API key (collect it with `bb secret request`, never in chat), a CLI login, or permission to use their signed-in bb browser. Wait for it, then do the task. Ask before anything irreversible: payments, deletions, sending messages.",
    'When it\'s done, call `human_task_update` with action "complete", a one-line summary, and `method` (how you got access), so similar tasks come to you next time. If you can\'t do it, use action "send_back" with the reason.',
  ]
    .filter(Boolean)
    .join("\n");
}

function takeBackMessage(todo: Todo): string {
  return `[Human tasks] The user took "${todo.title}" (task ${todo.id}) back and will do it themselves. Stop working on it; you'll get a message when it's done.`;
}

function questionMessage(todo: Todo, question: string): string {
  return [
    `[Human tasks] The user has a question about "${todo.title}" (task ${todo.id}):`,
    question,
    "Answer in this thread. If the instructions were unclear, fix them with `human_task_update` so the task reads right.",
  ].join("\n");
}

// ---- Plugin ------------------------------------------------------------------

export default async function plugin(bb: BbPluginApi) {
  const settings = bb.settings.define({
    notifyOnComplete: {
      type: "boolean",
      label: "Tell the requesting thread when a task is done",
      description: "Sends a short message to the agent thread that created the task, if that thread still exists and is not archived.",
      default: true,
    },
    askInThreadForBlocking: {
      type: "boolean",
      label: "Show blocking tasks as a form in the thread",
      description: "A blocking task also opens bb's input form in the requesting thread. The thread then shows as waiting on you, and push notifications fire.",
      default: true,
    },
    keepFinishedDays: {
      type: "number",
      label: "Delete finished tasks after (days)",
      description: "Done and dismissed tasks older than this are deleted once a day. 0 keeps them forever.",
      default: 365,
    },
    systemNotifications: {
      type: "boolean",
      label: "System notification for new tasks",
      description: "When bb is in the background, show a system notification as a new task arrives. Uses the browser's notification permission.",
      default: true,
    },
  });

  const db = bb.storage.database();
  // Append-only: never edit or reorder shipped statements.
  bb.storage.migrate(db, [
    `CREATE TABLE IF NOT EXISTS todos (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      instructions TEXT NOT NULL,
      automation_hint TEXT,
      status TEXT NOT NULL,
      source_thread_id TEXT,
      source_project_id TEXT,
      source_thread_title TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      completed_at INTEGER,
      completion_note TEXT,
      notify_result TEXT,
      notify_detail TEXT
    )`,
    `CREATE INDEX IF NOT EXISTS todos_source_thread ON todos (source_thread_id)`,
    `ALTER TABLE todos ADD COLUMN source_bot_id TEXT`,
    `ALTER TABLE todos ADD COLUMN kind TEXT NOT NULL DEFAULT 'other'`,
    `ALTER TABLE todos ADD COLUMN blocking INTEGER NOT NULL DEFAULT 0`,
    `ALTER TABLE todos ADD COLUMN reply_prompt TEXT`,
    `ALTER TABLE todos ADD COLUMN secrets TEXT`,
    `ALTER TABLE todos ADD COLUMN env_file TEXT`,
    `ALTER TABLE todos ADD COLUMN watcher_thread_ids TEXT NOT NULL DEFAULT '[]'`,
    `ALTER TABLE todos ADD COLUMN automation_thread_id TEXT`,
    `ALTER TABLE todos ADD COLUMN automation_outcome TEXT`,
    `ALTER TABLE todos ADD COLUMN automation_summary TEXT`,
    `ALTER TABLE todos ADD COLUMN demo_relations TEXT`,
    // v0.1.0: "automation" became "hand-off"; demo rows moved to a client-side preview.
    `UPDATE todos SET automation_outcome = CASE automation_outcome WHEN 'automated' THEN 'delegated' WHEN 'exploring' THEN 'planning' ELSE automation_outcome END`,
    `DELETE FROM todos WHERE id LIKE 'demo-%'`,
    `ALTER TABLE todos ADD COLUMN handoff_method TEXT`,
    `ALTER TABLE todos ADD COLUMN handed_back INTEGER NOT NULL DEFAULT 0`,
    `ALTER TABLE todos ADD COLUMN handback_note TEXT`,
    `ALTER TABLE todos ADD COLUMN agent_note TEXT`,
    `ALTER TABLE todos ADD COLUMN question TEXT`,
    `ALTER TABLE todos ADD COLUMN question_at INTEGER`,
    `ALTER TABLE todos ADD COLUMN due_at INTEGER`,
    `ALTER TABLE todos ADD COLUMN snoozed_until INTEGER`,
    `ALTER TABLE todos ADD COLUMN resumed_at INTEGER`,
    // Whether a blocking task's in-thread form is pending (not shown yet), shown, or deferred by the user.
    `ALTER TABLE todos ADD COLUMN form_state TEXT`,
    `CREATE INDEX IF NOT EXISTS todos_status ON todos (status)`,
    `CREATE INDEX IF NOT EXISTS todos_snoozed ON todos (snoozed_until) WHERE snoozed_until IS NOT NULL`,
    // The queued "do it yourself" message, while it waits behind a busy agent.
    `ALTER TABLE todos ADD COLUMN handback_message_id TEXT`,
    `CREATE INDEX IF NOT EXISTS todos_handback_message ON todos (handback_message_id) WHERE handback_message_id IS NOT NULL`,
  ]);

  /** Unfinished first: blocking, then by due date, then newest. Finished: newest first. */
  const ORDER_BY = `ORDER BY
       CASE WHEN status IN ('done', 'dismissed') THEN 1 ELSE 0 END,
       CASE WHEN status IN ('done', 'dismissed') THEN 0 ELSE -blocking END,
       CASE WHEN status IN ('done', 'dismissed') OR due_at IS NULL THEN 1 ELSE 0 END,
       due_at,
       CASE status WHEN 'in_progress' THEN 0 ELSE 1 END,
       CASE WHEN status IN ('done', 'dismissed') THEN -COALESCE(completed_at, updated_at) ELSE -created_at END`;
  const selectOne = db.prepare<[string], TodoRow>(`SELECT * FROM todos WHERE id = ?`);
  const insert = db.prepare(
    `INSERT INTO todos (id, title, instructions, automation_hint, kind, blocking, reply_prompt, secrets, env_file,
       status, source_thread_id, source_project_id, source_thread_title, source_bot_id, due_at, snoozed_until,
       created_at, updated_at)
     VALUES (@id, @title, @instructions, @agent_needs, @kind, @blocking, @reply_prompt, @secrets, @env_file,
       'open', @source_thread_id, @source_project_id, @source_thread_title, @source_bot_id, @due_at, @snoozed_until,
       @now, @now)`,
  );
  const updateStatus = db.prepare(
    `UPDATE todos SET status = @status, updated_at = @now, completed_at = @completed_at,
       completion_note = @completion_note, notify_result = NULL, notify_detail = NULL, resumed_at = NULL,
       handed_back = CASE WHEN @status = 'open' THEN 0 ELSE handed_back END
     WHERE id = @id`,
  );
  const updateNotify = db.prepare(`UPDATE todos SET notify_result = @result, notify_detail = @detail WHERE id = @id`);
  const updateWatchers = db.prepare(`UPDATE todos SET watcher_thread_ids = @watchers, updated_at = @now WHERE id = @id`);
  /** Column names come only from this file, never from input; statements are cached per column set. */
  const updateStatements = new Map<string, ReturnType<typeof db.prepare>>();
  const updateColumns = (id: string, values: Record<string, unknown>) => {
    const keys = Object.keys(values).sort();
    if (keys.length === 0) return;
    const signature = keys.join(",");
    let statement = updateStatements.get(signature);
    if (!statement) {
      statement = db.prepare(`UPDATE todos SET ${keys.map((key) => `${key} = @${key}`).join(", ")}, updated_at = @now WHERE id = @id`);
      updateStatements.set(signature, statement);
    }
    statement.run({ ...values, id, now: Date.now() });
  };
  const deleteOne = db.prepare(`DELETE FROM todos WHERE id = ?`);
  const OPEN = `status IN ('open', 'in_progress')`;
  /** Finished tasks from the last 60 days, newest first (at most 100). */
  const selectRecentFinished = db.prepare<[number], TodoRow>(
    `SELECT * FROM todos WHERE NOT ${OPEN} AND COALESCE(completed_at, updated_at) >= ?
     ORDER BY COALESCE(completed_at, updated_at) DESC LIMIT 100`,
  );
  const selectOpen = db.prepare<[], TodoRow>(`SELECT * FROM todos WHERE ${OPEN} ${ORDER_BY}`);
  const selectForThread = db.prepare<{ thread: string; needle: string }, TodoRow>(
    `SELECT * FROM todos WHERE ${OPEN} AND (source_thread_id = @thread OR instr(watcher_thread_ids, @needle) > 0) ${ORDER_BY}`,
  );
  const selectDueSnoozes = db.prepare<[number], TodoRow>(`SELECT * FROM todos WHERE ${OPEN} AND snoozed_until IS NOT NULL AND snoozed_until <= ?`);
  const selectOpenTitles = db.prepare<[], { id: string; title: string; source_project_id: string | null }>(
    `SELECT id, title, source_project_id FROM todos WHERE ${OPEN}`,
  );
  const selectPendingForms = db.prepare<[string], TodoRow>(`SELECT * FROM todos WHERE ${OPEN} AND source_thread_id = ? AND form_state = 'shown'`);
  /** Blocking tasks whose form waits for their snooze to end and their thread to be free. */
  const selectAwaitingForm = db.prepare<{ thread: string; now: number }, TodoRow>(
    `SELECT * FROM todos WHERE ${OPEN} AND source_thread_id = @thread AND form_state = 'pending' AND handed_back = 0
       AND (snoozed_until IS NULL OR snoozed_until <= @now)`,
  );
  const selectHandedBackForThread = db.prepare<[string], TodoRow>(`SELECT * FROM todos WHERE ${OPEN} AND handed_back = 1 AND source_thread_id = ?`);
  const selectByHandbackMessage = db.prepare<[string], TodoRow>(`SELECT * FROM todos WHERE handback_message_id = ?`);
  const pruneFinished = db.prepare(`DELETE FROM todos WHERE NOT ${OPEN} AND COALESCE(completed_at, updated_at) < ?`);
  /** Titles for spotting recurring chores; bounded so it stays cheap. */
  const selectCorpus = db.prepare<[], { id: string; title: string; done_by_agent: number; handoff_method: HandoffMethod | null }>(
    `SELECT id, title, (handed_back = 1 AND status = 'done') AS done_by_agent, handoff_method FROM todos ORDER BY created_at DESC LIMIT 2000`,
  );
  const selectStats = db.prepare<{ now: number }, { open: number; blocking: number; done: number; done_by_agents: number }>(
    `SELECT
       COALESCE(SUM(CASE WHEN ${OPEN} AND handed_back = 0 AND (snoozed_until IS NULL OR snoozed_until <= @now) THEN 1 ELSE 0 END), 0) AS open,
       COALESCE(SUM(CASE WHEN ${OPEN} AND handed_back = 0 AND blocking = 1 AND (snoozed_until IS NULL OR snoozed_until <= @now) THEN 1 ELSE 0 END), 0) AS blocking,
       COALESCE(SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END), 0) AS done,
       COALESCE(SUM(CASE WHEN status = 'done' AND handed_back = 1 THEN 1 ELSE 0 END), 0) AS done_by_agents
     FROM todos`,
  );
  const markResumedStatement = db.prepare(
    `UPDATE todos SET resumed_at = @now WHERE source_thread_id = @thread AND status = 'done'
       AND notify_result = 'notified' AND resumed_at IS NULL AND completed_at >= @since`,
  );

  /** Why the plugin itself closed a form, so the waiting tool call can answer accurately. */
  type CloseReason = "withdrawn" | "removed" | "archived";
  /** Tasks whose in-thread form is open, and whether it answers a tool call. */
  const waiting = new Map<string, { controller: AbortController; inTool: boolean; closeReason?: CloseReason }>();
  function closeForm(id: string, reason?: CloseReason): void {
    const pending = waiting.get(id);
    if (!pending) return;
    if (reason) pending.closeReason = reason;
    pending.controller.abort();
  }

  /**
   * Bumped on every write, so derived data (the recurrence index) knows when
   * to rebuild. Change signals are coalesced: one publish per burst, naming
   * the threads involved so thread banners can skip unrelated changes, and
   * carrying the counts so the badge needs no extra call.
   */
  let version = 0;
  let pendingThreads: Set<string> | null = new Set();
  let publishTimer: ReturnType<typeof setTimeout> | null = null;
  function changed(todo?: Pick<Todo, "sourceThreadId" | "watcherThreadIds"> | null): void {
    version += 1;
    if (todo === undefined || todo === null) pendingThreads = null;
    else if (pendingThreads !== null) {
      if (todo.sourceThreadId) pendingThreads.add(todo.sourceThreadId);
      for (const watcher of todo.watcherThreadIds) pendingThreads.add(watcher);
    }
    if (publishTimer !== null) return;
    publishTimer = setTimeout(() => {
      publishTimer = null;
      const { open, blocking } = stats();
      const signal: TodosChangedSignal = { threadIds: pendingThreads === null ? null : [...pendingThreads], open, blocking };
      pendingThreads = new Set();
      bb.realtime.publish(TODOS_CHANGED, signal);
    }, 40);
  }
  bb.onDispose(() => {
    if (publishTimer !== null) clearTimeout(publishTimer);
  });
  function announce(todo: Todo, event: TaskEventSignal["event"], detail: string | null): void {
    const signal: TaskEventSignal = { id: todo.id, title: todo.title, event, detail };
    bb.realtime.publish(TASK_EVENT, signal);
  }

  /** What the page and agents see: open tasks and recently finished ones. */
  function listTodos(options: { openOnly?: boolean } = {}): Todo[] {
    const open = selectOpen.all().map(fromRow);
    if (options.openOnly) return open;
    return [...open, ...selectRecentFinished.all(Date.now() - 60 * 24 * 60 * 60 * 1000).map(fromRow)];
  }

  function getTodo(id: string): Todo | null {
    const row = selectOne.get(id);
    return row === undefined ? null : fromRow(row);
  }

  function requireTodo(id: string): Todo {
    const todo = getTodo(id);
    if (todo === null) throw new Error(`No task with id ${id}`);
    return todo;
  }

  // ---- Relations -------------------------------------------------------------

  /** Cache a slow lookup for a short time; failures resolve to null. */
  function cached<T>(ttlMs: number, load: () => Promise<T>): () => Promise<T | null> {
    let entry: { at: number; value: Promise<T | null> } | null = null;
    return () => {
      if (entry === null || Date.now() - entry.at > ttlMs) entry = { at: Date.now(), value: load().catch(() => null) };
      return entry.value;
    };
  }

  const projectsCache = cached(30_000, async () => {
    const projects = await bb.sdk.projects.list({ includePersonal: true });
    return {
      names: new Map(projects.map((project) => [project.id, project.name])),
      personalId: projects.find((project) => project.kind === "personal")?.id ?? null,
    };
  });

  /** Null when the bots plugin is not installed, disabled, or failing. */
  const botsDirectory = cached(30_000, async (): Promise<BotsDirectory> =>
    bb.sdk.plugins.callRpc({ pluginId: BOTS_PLUGIN_ID, method: "bots_list", input: null, outputSchema: botsListSchema }),
  );

  function toBotInfo(bot: BotsDirectory["bots"][number]): BotInfo {
    return { id: bot.id, name: bot.name, role: bot.role, color: bot.avatar?.color ?? null, mainThreadId: bot.mainThreadId };
  }

  /**
   * The bot that owns a thread, following parent and fork links the way the
   * bots plugin does, so a sub-agent thread of a bot still counts as the bot.
   */
  async function resolveBotId(threadId: string, directory: BotsDirectory): Promise<string | null> {
    const owners = new Map(directory.threadBindings.map((binding) => [binding.threadId, binding.botId]));
    const seen = new Set<string>();
    let current: string | null = threadId;
    while (current !== null && !seen.has(current) && seen.size < 20) {
      const owner = owners.get(current);
      if (owner !== undefined) return owner;
      seen.add(current);
      const thread = await bb.sdk.threads.get({ threadId: current });
      current = thread.parentThreadId ?? thread.sourceThreadId;
    }
    return null;
  }

  /** Live title and state of a thread, cached briefly per thread. */
  const threadCache = new Map<string, { at: number; value: Promise<{ title: string | null; state: ThreadState }> }>();
  function threadInfo(threadId: string): Promise<{ title: string | null; state: ThreadState }> {
    const hit = threadCache.get(threadId);
    if (hit && Date.now() - hit.at < 15_000) return hit.value;
    const value = bb.sdk.threads.get({ threadId }).then(
      (thread) => ({
        title: thread.title ?? thread.titleFallback ?? null,
        state: (thread.deletedAt !== null ? "deleted" : thread.archivedAt !== null ? "archived" : "live") as ThreadState,
      }),
      // A thread the server no longer returns is gone for our purposes.
      () => ({ title: null, state: "deleted" as const }),
    );
    if (threadCache.size > 500) {
      for (const [key, entry] of threadCache) if (Date.now() - entry.at >= 15_000) threadCache.delete(key);
    }
    threadCache.set(threadId, { at: Date.now(), value });
    return value;
  }

  /**
   * The recurrence index: every task's title tokens plus a word → tasks map,
   * rebuilt only after a write. Matching then compares a task only with tasks
   * that share a word, instead of with every task.
   */
  type CorpusEntry = { id: string; tokens: Set<string>; doneByAgent: boolean; method: HandoffMethod | null };
  let corpusCache: { version: number; byWord: Map<string, CorpusEntry[]> } | null = null;
  function corpusIndex(): Map<string, CorpusEntry[]> {
    if (corpusCache?.version === version) return corpusCache.byWord;
    const byWord = new Map<string, CorpusEntry[]>();
    for (const row of selectCorpus.all()) {
      const entry: CorpusEntry = { id: row.id, tokens: titleTokens(row.title), doneByAgent: row.done_by_agent === 1, method: row.handoff_method };
      for (const word of entry.tokens) {
        const list = byWord.get(word);
        if (list) list.push(entry);
        else byWord.set(word, [entry]);
      }
    }
    corpusCache = { version, byWord };
    return byWord;
  }

  /** Per-task recurrence, valid until the next write; the screens refreshing after one change share it. */
  let recurrenceCache: { version: number; byId: Map<string, TodoView["recurrence"]> } = { version: -1, byId: new Map() };

  /** For each target, how many other tasks look like the same chore, and whether an agent did one. */
  function recurrenceFor(targets: Todo[]): Map<string, TodoView["recurrence"]> {
    if (recurrenceCache.version !== version) recurrenceCache = { version, byId: new Map() };
    const byWord = corpusIndex();
    const result = new Map<string, TodoView["recurrence"]>();
    for (const todo of targets) {
      const cachedValue = recurrenceCache.byId.get(todo.id);
      if (cachedValue) {
        result.set(todo.id, cachedValue);
        continue;
      }
      // Count shared words straight from the index; "same chore" needs at least two.
      const tokens = titleTokens(todo.title);
      const shared = new Map<CorpusEntry, number>();
      for (const word of tokens) for (const entry of byWord.get(word) ?? []) if (entry.id !== todo.id) shared.set(entry, (shared.get(entry) ?? 0) + 1);
      let count = 0;
      let agentDidSimilar: TodoView["recurrence"]["agentDidSimilar"] = null;
      for (const [other, overlap] of shared) {
        if (overlap < 2 || overlap / (tokens.size + other.tokens.size - overlap) < 0.5) continue;
        count += 1;
        if (agentDidSimilar === null && other.doneByAgent) agentDidSimilar = { taskId: other.id, method: other.method };
      }
      const value = { count, agentDidSimilar };
      recurrenceCache.byId.set(todo.id, value);
      result.set(todo.id, value);
    }
    return result;
  }

  async function withRelations(todos: Todo[]): Promise<TodoView[]> {
    // Live thread state matters for unfinished tasks; finished ones use the stored title.
    const threadIds = [...new Set(todos.flatMap((todo) => (todo.sourceThreadId && !isFinished(todo) ? [todo.sourceThreadId] : [])))];
    const [projects, directory, threadInfos] = await Promise.all([
      projectsCache(),
      botsDirectory(),
      Promise.all(threadIds.map(async (id) => [id, await threadInfo(id)] as const)).then((pairs) => new Map(pairs)),
    ]);
    const bots = new Map((directory?.bots ?? []).map((bot) => [bot.id, bot]));
    const threadOwners = new Map((directory?.threadBindings ?? []).map((binding) => [binding.threadId, binding.botId]));
    const projectOwners = new Map((directory?.projectOwners ?? []).map((owner) => [owner.projectId, owner.botId]));
    // Recurrence matters while a task is open; finished ones skip the work.
    const recurrence = recurrenceFor(todos.filter((todo) => !isFinished(todo)));
    return todos.map((todo) => {
      // A bot owns the thread (directly or through a parent), else the project.
      const threadBotId = todo.sourceBotId ?? (todo.sourceThreadId ? threadOwners.get(todo.sourceThreadId) : undefined);
      const projectBotId = todo.sourceProjectId ? projectOwners.get(todo.sourceProjectId) : undefined;
      const botId = threadBotId ?? projectBotId;
      const bot = botId === undefined ? undefined : bots.get(botId);
      const info = todo.sourceThreadId ? threadInfos.get(todo.sourceThreadId) : undefined;
      return {
        ...todo,
        recurrence: recurrence.get(todo.id) ?? { count: 0, agentDidSimilar: null },
        waitingInThread: waiting.has(todo.id),
        thread:
          todo.sourceThreadId === null
            ? null
            : { id: todo.sourceThreadId, title: info?.title ?? todo.sourceThreadTitle, state: info?.state ?? "unknown" },
        project: todo.sourceProjectId === null ? null : { id: todo.sourceProjectId, name: projects?.names.get(todo.sourceProjectId) ?? "Unknown project" },
        bot: bot === undefined ? null : { ...toBotInfo(bot), via: threadBotId !== undefined ? ("thread" as const) : ("project" as const) },
      };
    });
  }

  function stats(): TaskStats {
    const row = selectStats.get({ now: Date.now() })!;
    return { open: row.open, blocking: row.blocking, done: row.done, doneByAgents: row.done_by_agents };
  }

  // ---- Notifying threads -----------------------------------------------------

  /** Send to a thread if it still exists and is not archived. */
  async function sendIfLive(threadId: string, text: string): Promise<{ sent: boolean; reason: string; queuedId?: string }> {
    let thread;
    try {
      thread = await bb.sdk.threads.get({ threadId });
    } catch {
      return { sent: false, reason: "no longer exists" };
    }
    if (thread.deletedAt !== null) return { sent: false, reason: "was deleted" };
    if (thread.archivedAt !== null) return { sent: false, reason: "is archived" };
    const result = await bb.sdk.threads.send({ threadId, mode: "queue-if-active", input: [{ type: "text", text, mentions: [] }] });
    return result.delivery === "queued" ? { sent: true, reason: "", queuedId: result.queuedMessage.id } : { sent: true, reason: "" };
  }

  /** Send to the requesting thread or fail with a message the UI can show. Returns the queued message id, if queued. */
  async function sendToRequester(todo: Todo, text: string): Promise<string | null> {
    if (todo.sourceThreadId === null) throw new Error("No agent thread is linked to this task.");
    const result = await sendIfLive(todo.sourceThreadId, text);
    if (!result.sent) throw new Error(`The thread that asked ${result.reason}.`);
    return result.queuedId ?? null;
  }

  /**
   * Tell the requesting thread and any watchers. `requesterDelivered` means
   * the requester already got the result through its waiting tool call.
   */
  async function notifyThreads(todo: Todo, event: "done" | "dismissed", requesterDelivered: boolean): Promise<void> {
    const record = (result: Todo["notifyResult"], detail: string) => {
      updateNotify.run({ id: todo.id, result, detail });
      changed(todo);
    };
    if (!(await settings.get()).notifyOnComplete) return record("skipped", "Notifications are off in settings");

    let requester: Todo["notifyResult"] = null;
    let detail = "";
    if (requesterDelivered) {
      requester = "notified";
      detail = "The waiting agent got your answer";
      if (todo.sourceThreadId) recentlyNotified.set(todo.sourceThreadId, Date.now());
    } else if (todo.sourceThreadId === null) {
      requester = "skipped";
      detail = "No requesting thread";
    } else if (event === "dismissed" && !todo.blocking) {
      requester = null; // Dismissing a non-blocking task is silent.
    } else {
      try {
        const result = await sendIfLive(todo.sourceThreadId, event === "done" ? completionMessage(todo, "requester") : dismissMessage(todo));
        requester = result.sent ? "notified" : "skipped";
        if (result.sent) recentlyNotified.set(todo.sourceThreadId, Date.now());
        detail = result.sent ? "The requesting thread was told" : `The requesting thread ${result.reason}`;
      } catch (error) {
        bb.log.warn(`notify failed for task ${todo.id}: ${String(error)}`);
        requester = "failed";
        detail = `Could not tell the thread: ${String(error)}`.slice(0, 300);
      }
    }

    let watchersTold = 0;
    if (event === "done") {
      for (const watcher of todo.watcherThreadIds) {
        try {
          if ((await sendIfLive(watcher, completionMessage(todo, "watcher"))).sent) watchersTold += 1;
        } catch (error) {
          bb.log.warn(`notify watcher ${watcher} failed for task ${todo.id}: ${String(error)}`);
        }
      }
    }
    if (requester === null) return;
    const watcherText = watchersTold > 0 ? ` (and ${watchersTold} more ${watchersTold === 1 ? "thread" : "threads"})` : "";
    record(requester, `${detail}${watcherText}`);
  }

  async function setStatus(id: string, status: TodoStatus, note?: string, options: { fromToolForm?: boolean } = {}): Promise<Todo | null> {
    const before = getTodo(id);
    if (before === null) return null;
    const finished = status === "done" || status === "dismissed";
    updateStatus.run({ id, status, now: Date.now(), completed_at: finished ? Date.now() : null, completion_note: finished && note ? note : null });
    if (finished) updateColumns(id, { snoozed_until: null, agent_note: null, question: null, question_at: null });
    const after = getTodo(id)!;
    changed(after);
    const event = status === "done" && before.status !== "done" ? "done" : status === "dismissed" && before.status !== "dismissed" ? "dismissed" : null;
    if (event === null) return after;

    const pending = waiting.get(id);
    // A form that answers a tool call carries the result to the agent itself.
    const requesterDelivered = options.fromToolForm === true || (pending?.inTool ?? false);
    if (pending && !options.fromToolForm) closeForm(id);
    await notifyThreads(after, event, requesterDelivered);
    return getTodo(id);
  }

  /** The user asks the agent to do it this time, with whatever access they set up. */
  async function handBack(id: string, note: string | undefined, options: { fromToolForm?: boolean } = {}): Promise<Todo> {
    const todo = requireTodo(id);
    if (isFinished(todo)) throw new Error(`Task ${id} is already ${todo.status}.`);
    const pending = waiting.get(id);
    const delivered = options.fromToolForm === true || (pending?.inTool ?? false);
    let queuedId: string | null = null;
    if (!delivered) {
      queuedId = await sendToRequester({ ...todo, handbackNote: note ?? null }, handBackMessage({ ...todo, handbackNote: note ?? null }));
    }
    updateColumns(id, {
      handed_back: 1,
      handback_note: note ?? null,
      handback_message_id: queuedId,
      status: "in_progress",
      agent_note: null,
      snoozed_until: null,
    });
    if (pending && !options.fromToolForm) closeForm(id);
    const updated = requireTodo(id);
    changed(updated);
    return updated;
  }

  /** The user changes their mind and does a handed-back task themselves. */
  async function takeBack(id: string): Promise<Todo> {
    const todo = requireTodo(id);
    if (!todo.handedBack || isFinished(todo)) throw new Error(`Task ${id} isn't with the agent.`);
    updateColumns(id, { handed_back: 0, handback_note: null, handback_message_id: null, status: "open" });
    changed(todo);
    if (todo.sourceThreadId) await sendIfLive(todo.sourceThreadId, takeBackMessage(todo)).catch(() => undefined);
    return requireTodo(id);
  }

  // ---- In-thread form for blocking tasks ---------------------------------------

  /**
   * Show the task as bb's native input form in its thread. Inside a tool call
   * the eventual return value reaches the agent; outside one, completion goes
   * through the normal thread message. Resolves with the final task state.
   */
  async function askInThread(todo: Todo, inTool: boolean, signal?: AbortSignal): Promise<{ todo: Todo; closeReason?: CloseReason }> {
    if (todo.sourceThreadId === null) return { todo };
    const controller = new AbortController();
    const forward = () => controller.abort();
    signal?.addEventListener("abort", forward, { once: true });
    let closeReason: CloseReason | undefined;
    waiting.set(todo.id, { controller, inTool });
    updateColumns(todo.id, { form_state: "shown" });
    changed(todo);
    try {
      const result = await bb.ui.requestInput(
        {
          threadId: todo.sourceThreadId,
          rendererId: "task",
          title: todo.title,
          payload: { taskId: todo.id },
          timeoutMs: WEEK_MS,
          presentation: { label: { pending: "Waiting on you: human task", completed: "Human task" } },
          describeSubmission: (value) => {
            const parsed = interactionValueSchema.safeParse(value);
            const action = parsed.success ? parsed.data.action : "done";
            const verb = action === "done" ? "Done" : action === "dismiss" ? "Dismissed" : "Handed back";
            return { title: `${verb}: ${todo.title}` };
          },
        },
        { signal: controller.signal },
      );
      // The user closing it ("Later") or bb dropping it for good means: don't show it again.
      if (result.outcome === "cancelled" && ["user", "timeout", "thread-stopped", "thread-deleted"].includes(result.reason)) {
        updateColumns(todo.id, { form_state: "deferred" });
      }
      if (result.outcome === "submitted") {
        const parsed = interactionValueSchema.safeParse(result.value);
        if (parsed.success) {
          if (parsed.data.action === "hand_back") await handBack(todo.id, parsed.data.note, { fromToolForm: inTool });
          else await setStatus(todo.id, parsed.data.action === "done" ? "done" : "dismissed", parsed.data.note, { fromToolForm: inTool });
        }
      }
    } catch (error) {
      // Aborts end up here on some hosts; the task state below decides.
      if (!controller.signal.aborted) bb.log.warn(`in-thread form failed for task ${todo.id}: ${String(error)}`);
    } finally {
      signal?.removeEventListener("abort", forward);
      const entry = waiting.get(todo.id);
      if (entry?.controller === controller) {
        closeReason = entry.closeReason;
        waiting.delete(todo.id);
      }
      changed(todo);
    }
    return { todo: getTodo(todo.id) ?? todo, ...(closeReason ? { closeReason } : {}) };
  }

  /** The waiting tool call's answer when the plugin itself closed the form. */
  function closedFormError(reason: CloseReason, title: string): Error {
    const text = {
      withdrawn: `You dismissed "${title}"; it no longer waits on the user.`,
      removed: `The user deleted "${title}".`,
      archived: `This thread was archived, so "${title}" no longer waits here.`,
    }[reason];
    // An error reaches only an agent that is still active, so idle agents aren't woken for this.
    return new Error(text);
  }

  /** Open the forms of blocking tasks that came back from a snooze, once their thread is idle. */
  async function openPendingForms(threadId: string | null): Promise<void> {
    if (threadId === null || !(await settings.get()).askInThreadForBlocking) return;
    const rows = selectAwaitingForm.all({ thread: threadId, now: Date.now() });
    if (rows.length === 0) return;
    const thread = await bb.sdk.threads.get({ threadId }).catch(() => null);
    if (!thread || thread.archivedAt !== null || thread.deletedAt !== null || thread.status !== "idle") return;
    if ("hasPendingInteraction" in thread && thread.hasPendingInteraction) return;
    const first = rows.map(fromRow).find((todo) => !waiting.has(todo.id));
    // One form at a time: it replaces the composer; the next opens when this thread is idle again.
    if (first) void askInThread(first, false);
  }

  /** After a reload, put open blocking tasks back in front of their idle threads. */
  async function rearmBlockingForms(): Promise<void> {
    if (!(await settings.get()).askInThreadForBlocking) return;
    const pendingThreads = new Set<string>();
    for (const row of selectOpen.all()) {
      if (row.form_state === "pending" && row.source_thread_id) pendingThreads.add(row.source_thread_id);
      // Only forms a reload interrupted come back; "Later" and CLI-created tasks don't pop up.
      if (row.form_state !== "shown") continue;
      const todo = fromRow(row);
      if (!todo.blocking || todo.handedBack || todo.sourceThreadId === null || waiting.has(todo.id)) continue;
      if (todo.snoozedUntil !== null && todo.snoozedUntil > Date.now()) continue;
      try {
        const thread = await bb.sdk.threads.get({ threadId: todo.sourceThreadId });
        if (thread.archivedAt !== null || thread.deletedAt !== null) continue;
        if (thread.status !== "idle" || ("hasPendingInteraction" in thread && thread.hasPendingInteraction)) continue;
        void askInThread(todo, false);
      } catch {
        // Thread gone: nothing to re-arm.
      }
    }
    for (const threadId of pendingThreads) await openPendingForms(threadId);
  }
  const rearmTimer = setTimeout(() => void rearmBlockingForms(), 3000);
  bb.onDispose(() => clearTimeout(rearmTimer));

  // ---- Snoozes come back; resumed agents are noted ------------------------------

  bb.background.schedule("resurface", "* * * * *", async () => {
    const due = selectDueSnoozes.all(Date.now());
    for (const row of due) {
      updateColumns(row.id, { snoozed_until: null });
      const todo = fromRow({ ...row, snoozed_until: null });
      announce(todo, "due", null);
      // A blocking task the agent hid until now gets its form when its thread is free (now, or on its next idle).
      if (row.form_state === "pending") await openPendingForms(todo.sourceThreadId);
    }
    if (due.length > 0) changed();
  });

  bb.background.schedule("prune", "17 3 * * *", async () => {
    const days = Number((await settings.get()).keepFinishedDays);
    if (!Number.isFinite(days) || days <= 0) return;
    const removed = pruneFinished.run(Date.now() - days * 24 * 60 * 60 * 1000).changes;
    if (removed > 0) {
      bb.log.info(`pruned ${removed} finished tasks older than ${days} days`);
      changed();
    }
  });

  /**
   * A requesting thread that gets busy after we told it its task is done has
   * picked the work back up. Thread events fire for every thread, so only
   * threads we recently notified touch the database.
   */
  const recentlyNotified = new Map<string, number>();
  const markResumed = ({ thread }: { thread: { id: string } }) => {
    const notifiedAt = recentlyNotified.get(thread.id);
    if (notifiedAt === undefined) return;
    if (Date.now() - notifiedAt > RESUME_WINDOW_MS) return void recentlyNotified.delete(thread.id);
    const result = markResumedStatement.run({ now: Date.now(), thread: thread.id, since: Date.now() - RESUME_WINDOW_MS });
    // Keep the entry until it takes effect: the "notified" row may still be on its way.
    if (result.changes > 0) {
      recentlyNotified.delete(thread.id);
      changed({ sourceThreadId: thread.id, watcherThreadIds: [] });
    }
  };
  bb.events.on("thread.active", markResumed);
  bb.events.on("thread.idle", (payload) => {
    markResumed(payload);
    void openPendingForms(payload.thread.id);
  });

  /** An archived or deleted thread stops waiting: close its forms without telling it anything. */
  const closeThreadForms = ({ thread }: { thread: { id: string } }) => {
    for (const [taskId] of waiting) {
      if (getTodo(taskId)?.sourceThreadId === thread.id) closeForm(taskId, "archived");
    }
    for (const row of selectPendingForms.all(thread.id)) updateColumns(row.id, { form_state: "deferred" });
    // A task handed back to an agent that's gone comes back to the user.
    for (const row of selectHandedBackForThread.all(thread.id)) {
      updateColumns(row.id, { handed_back: 0, handback_note: null, handback_message_id: null, status: "open" });
      const todo = fromRow(row);
      announce(todo, "handback_cancelled", "The thread you handed it to was archived");
      changed(todo);
    }
  };
  bb.events.on("thread.archived", closeThreadForms);
  bb.events.on("thread.deleted", closeThreadForms);

  /**
   * Deleting the queued "do it yourself" message before the agent saw it
   * takes the task back: it returns to the user and the agent is told nothing.
   */
  bb.events.on("message.cancelled", ({ entry }) => {
    const row = selectByHandbackMessage.get(entry.id);
    if (!row) return;
    const todo = fromRow(row);
    if (!todo.handedBack || isFinished(todo)) return void updateColumns(todo.id, { handback_message_id: null });
    updateColumns(todo.id, { handed_back: 0, handback_note: null, handback_message_id: null, status: "open" });
    announce(todo, "handback_cancelled", null);
    changed(todo);
  });
  bb.events.on("message.dispatched", ({ entry }) => {
    const row = selectByHandbackMessage.get(entry.id);
    if (row) updateColumns(row.id, { handback_message_id: null });
  });

  // ---- Creating ----------------------------------------------------------------

  interface CreateInput {
    title: string;
    instructions: string;
    agentNeeds?: string | undefined;
    kind?: TaskKind | undefined;
    blocking?: boolean | undefined;
    replyPrompt?: string | undefined;
    secrets?: SecretRequest[] | undefined;
    envFile?: string | undefined;
    due?: string | undefined;
    notBefore?: string | undefined;
    threadId?: string | null | undefined;
    projectId?: string | null | undefined;
  }

  type CreateResult = { outcome: "created" | "duplicate_own" | "joined"; todo: Todo };

  /**
   * An unfinished task with the same title in the same project, so retries do
   * not pile up. Other projects never match: their "same" task is a different job.
   */
  function findDuplicate(title: string, projectId: string | null): Todo | null {
    const wanted = normalizeTitle(title);
    const match = selectOpenTitles.all().find((row) => row.source_project_id === projectId && normalizeTitle(row.title) === wanted);
    return match ? getTodo(match.id) : null;
  }

  async function createTodo(input: CreateInput): Promise<CreateResult> {
    let threadTitle: string | null = null;
    let projectId = input.projectId ?? null;
    if (input.threadId) {
      try {
        const thread = await bb.sdk.threads.get({ threadId: input.threadId });
        threadTitle = thread.title ?? thread.titleFallback ?? null;
        projectId = projectId ?? thread.projectId;
      } catch (error) {
        bb.log.warn(`could not read source thread ${input.threadId}: ${String(error)}`);
      }
    }
    const duplicate = findDuplicate(input.title, projectId);
    if (duplicate) {
      const threadId = input.threadId ?? null;
      if (threadId === null || duplicate.sourceThreadId === threadId || duplicate.watcherThreadIds.includes(threadId)) {
        return { outcome: "duplicate_own", todo: duplicate };
      }
      updateWatchers.run({ id: duplicate.id, watchers: JSON.stringify([...duplicate.watcherThreadIds, threadId]), now: Date.now() });
      const joined = getTodo(duplicate.id)!;
      changed(joined);
      return { outcome: "joined", todo: joined };
    }

    let botId: string | null = null;
    if (input.threadId) {
      const directory = await botsDirectory();
      if (directory !== null) {
        botId = await resolveBotId(input.threadId, directory).catch((error: unknown) => {
          bb.log.warn(`could not resolve bot for thread ${input.threadId}: ${String(error)}`);
          return null;
        });
      }
    }
    const id = randomUUID().slice(0, 8);
    const notBefore = input.notBefore ? Date.parse(input.notBefore) : null;
    insert.run({
      id,
      title: input.title,
      instructions: input.instructions,
      agent_needs: input.agentNeeds ? input.agentNeeds : null,
      kind: input.kind ?? "other",
      blocking: input.blocking ? 1 : 0,
      reply_prompt: input.replyPrompt ? input.replyPrompt : null,
      secrets: input.secrets && input.secrets.length > 0 ? JSON.stringify(input.secrets) : null,
      env_file: input.envFile ?? null,
      source_thread_id: input.threadId ?? null,
      source_project_id: projectId,
      source_thread_title: threadTitle,
      source_bot_id: botId,
      due_at: input.due ? Date.parse(input.due) : null,
      snoozed_until: notBefore !== null && notBefore > Date.now() ? notBefore : null,
      now: Date.now(),
    });
    const todo = requireTodo(id);
    changed(todo);
    let from: string | null = threadTitle;
    if (botId) from = (await botsDirectory())?.bots.find((bot) => bot.id === botId)?.name ?? from;
    if (todo.snoozedUntil === null) {
      const signal: TaskCreatedSignal = { id, title: todo.title, blocking: todo.blocking, kind: todo.kind, from };
      bb.realtime.publish(TASK_CREATED, signal);
    }
    return { outcome: "created", todo };
  }

  function removeTodo(id: string): boolean {
    closeForm(id, "removed");
    const before = getTodo(id);
    const removed = deleteOne.run(id).changes > 0;
    if (removed) changed(before);
    return removed;
  }

  // ---- RPC ---------------------------------------------------------------------

  bb.rpc.register(rpcContract, {
    todos_list: async (input) => {
      const directory = await botsDirectory();
      return {
        todos: await withRelations(listTodos({ openOnly: input?.openOnly === true })),
        stats: stats(),
        bots: (directory?.bots ?? []).map(toBotInfo),
      };
    },
    todos_summary: async () => {
      const { open, blocking } = stats();
      return { open, blocking };
    },
    todos_for_thread: async ({ threadId }) => ({
      todos: selectForThread
        .all({ thread: threadId, needle: JSON.stringify(threadId) })
        .map(fromRow)
        .map((todo) => ({ ...todo, waitingInThread: waiting.has(todo.id) })),
    }),
    todos_get: async ({ id }) => {
      const todo = getTodo(id);
      if (todo === null) return null;
      const [view] = await withRelations([todo]);
      return view ?? null;
    },
    todos_set_status: async ({ id, status, note }) => {
      const todo = await setStatus(id, status, note);
      if (todo === null) throw new Error(`No task with id ${id}`);
      return todo;
    },
    todos_snooze: async ({ id, until }) => {
      const before = requireTodo(id);
      updateColumns(id, { snoozed_until: until !== null && until > Date.now() ? until : null });
      changed(before);
      // Unsnoozing a blocking task the agent hid until later opens its form now, if the thread is free.
      if (until === null) void openPendingForms(before.sourceThreadId);
      return requireTodo(id);
    },
    todos_ask: async ({ id, question }) => {
      const todo = requireTodo(id);
      await sendToRequester(todo, questionMessage(todo, question));
      updateColumns(id, { question, question_at: Date.now() });
      changed(todo);
      return requireTodo(id);
    },
    todos_hand_back: async ({ id, note }) => handBack(id, note),
    todos_remove: async ({ id }) => ({ removed: removeTodo(id) }),
    todos_take_back: async ({ id }) => takeBack(id),
  });

  // ---- Agent tools -------------------------------------------------------------
  // Three tools keep the per-thread cost down: every thread carries their
  // schemas. Keep descriptions short; the skill holds the long guidance.

  const errorResult = (text: string) => ({ content: [{ type: "text" as const, text }], isError: true });

  bb.agents.registerTool({
    name: "human_task_create",
    description:
      "Hand the user a step only a human can do (sign in somewhere, click through a console, create a credential, pay, " +
      "test on a real device, send something as them, act in the physical world). It shows on their Human tasks page; " +
      "this thread gets a message when they finish.",
    instructions:
      "When you need the user to do something you cannot do yourself, create a human task with `human_task_create` " +
      "instead of only asking in chat or writing a .md file. Say exactly what you would need to do it yourself in " +
      "`agent_needs`. Then tell the user in one line and continue or end the turn; do not poll.",
    presentation: { label: { pending: "Handing a task to you", completed: "Handed a task to you" } },
    parameters: z.object({
      title: titleInput.describe("Short imperative title, e.g. 'Create a restricted Stripe API key'"),
      instructions: instructionsInput.describe("Markdown steps: where (main URL first, as a link), what to do, what to send back."),
      agent_needs: z
        .string()
        .trim()
        .min(1)
        .max(HINT_MAX)
        .describe(
          "What you would need to do this yourself, this time and next: e.g. 'a Cloudflare API token with DNS edit on acme.dev', " +
            "'the Stripe MCP server', 'permission to use your signed-in browser'. If only a person can do it, say why.",
        ),
      kind: kindSchema
        .default("other")
        .describe("access | setup (consoles, DNS, listings) | payment | review (real device, taste call) | communicate (as the user) | physical | other"),
      blocking: z.boolean().default(false).describe("True when your work cannot continue until it is done. Shows a form in this thread."),
      reply_prompt: replyPromptInput.optional().describe("The information you need back, as a question."),
      secrets: secretsInput.optional().describe("Env var names you need back as credentials (never via the note). Needs env_file."),
      env_file: envFileInput.optional().describe("The .env file the credentials go to, e.g. '.env.local'."),
      due: dateInput.optional().describe("ISO date it must be done by."),
      not_before: dateInput.optional().describe("ISO date-time before which it cannot be done; hidden until then."),
    }),
    async execute(params, { threadId, projectId, signal }) {
      if (params.secrets && params.secrets.length > 0 && !params.env_file) return errorResult("Pass `env_file` together with `secrets`.");
      const result = await createTodo({
        title: params.title,
        instructions: params.instructions,
        agentNeeds: params.agent_needs,
        kind: params.kind,
        blocking: params.blocking,
        replyPrompt: params.reply_prompt,
        secrets: params.secrets,
        envFile: params.env_file,
        due: params.due,
        notBefore: params.not_before,
        threadId,
        projectId,
      });
      const { todo } = result;
      if (result.outcome === "duplicate_own") return `Task ${todo.id} ("${todo.title}") already exists for this thread. Change it with \`human_task_update\`.`;
      if (result.outcome === "joined") {
        return `The user already has this task (${todo.id}), requested by another thread. This thread will also get a message when it is done.`;
      }
      const similar = recurrenceFor([todo]).get(todo.id)?.agentDidSimilar;
      const hint = similar
        ? ` An agent did a similar task before${similar.method ? ` via ${HANDOFF_METHOD_LABEL[similar.method]}` : ""}. Try it yourself first; if you can, dismiss this task with \`human_task_update\`.`
        : "";
      const askInThreadSetting = (await settings.get()).askInThreadForBlocking;
      // A blocking task hidden until later gets its form when it comes back.
      if (todo.blocking && threadId && todo.snoozedUntil !== null && askInThreadSetting) updateColumns(todo.id, { form_state: "pending" });
      if (todo.blocking && threadId && todo.snoozedUntil === null && askInThreadSetting) {
        const { todo: final, closeReason } = await askInThread(todo, true, signal);
        if (closeReason) throw closedFormError(closeReason, todo.title);
        if (final.status === "done") return completionMessage(final, "requester");
        if (final.status === "dismissed") return dismissMessage(final);
        if (final.handedBack) return handBackMessage(final);
        throw new Error(`The form for "${todo.title}" closed, but the task is still open in Human tasks. You'll get a message when the user finishes it. No action needed.`);
      }
      return `Added human task ${todo.id}. This thread gets a message when the user finishes it.${hint}`;
    },
  });

  bb.agents.registerTool({
    name: "human_task_update",
    description:
      "Act on a human task this thread created. action: edit (default; fix any field), dismiss (no longer needed), " +
      "complete (the user handed it back and you did it: pass summary, and method = how you got access), " +
      "send_back (it isn't actually done, or you can't do a handed-back task: pass reason).",
    presentation: { label: { pending: "Updating a human task", completed: "Updated a human task" } },
    parameters: z.object({
      id: z.string().min(1),
      action: z.enum(["edit", "dismiss", "complete", "send_back"]).default("edit"),
      title: titleInput.optional(),
      instructions: instructionsInput.optional(),
      agent_needs: hintInput.optional(),
      kind: kindSchema.optional(),
      blocking: z.boolean().optional(),
      reply_prompt: replyPromptInput.optional(),
      due: dateInput.nullable().optional(),
      summary: z.string().trim().min(1).max(500).optional().describe("complete: one line on what you did."),
      method: handoffMethodSchema.optional().describe("complete: how you got access (mcp, api_access, cli_login, browser, new_tool, skill, schedule, other)."),
      reason: z.string().trim().min(1).max(1000).optional().describe("send_back: what is missing or what went wrong."),
    }),
    async execute({ id, action, summary, method, reason, ...changes }, { threadId }) {
      const todo = getTodo(id);
      if (todo === null) return errorResult(`No task with id ${id}.`);
      if (todo.sourceThreadId !== threadId) return errorResult(`Task ${id} was created by another thread.`);

      if (action === "dismiss") {
        if (isFinished(todo)) return errorResult(`Task ${id} is already ${todo.status}.`);
        // The agent withdraws its own request, so it needs no message about it.
        closeForm(id, "withdrawn");
        updateStatus.run({ id, status: "dismissed", now: Date.now(), completed_at: Date.now(), completion_note: null });
        changed(todo);
        return `Dismissed task ${id}.`;
      }

      if (action === "complete") {
        if (!todo.handedBack || isFinished(todo)) return errorResult(`Task ${id} wasn't handed back to you; the user finishes it.`);
        if (!summary) return errorResult("Pass `summary` with action complete.");
        updateStatus.run({ id, status: "done", now: Date.now(), completed_at: Date.now(), completion_note: `Done by the agent: ${summary}` });
        updateColumns(id, { handoff_method: method ?? null, automation_summary: summary });
        updateNotify.run({ id, result: "notified", detail: "Done by the agent" });
        const done = requireTodo(id);
        announce(done, "completed_by_agent", summary);
        changed(done);
        for (const watcher of done.watcherThreadIds) await sendIfLive(watcher, completionMessage(done, "watcher")).catch(() => undefined);
        return `Marked task ${id} done.`;
      }

      if (action === "send_back") {
        if (!reason) return errorResult("Pass `reason` with action send_back.");
        if (todo.status === "dismissed") return errorResult(`Task ${id} was dismissed; create a new one if you still need it.`);
        if (todo.status !== "done" && !todo.handedBack) return errorResult(`Task ${id} is still with the user.`);
        updateColumns(id, {
          status: "open",
          handed_back: 0,
          completed_at: null,
          completion_note: null,
          resumed_at: null,
          agent_note: reason,
          notify_result: null,
          notify_detail: null,
        });
        announce(requireTodo(id), "reopened", reason);
        changed(todo);
        return `Sent task ${id} back to the user with your reason. This thread gets a message when they finish it.`;
      }

      if (isFinished(todo)) return errorResult(`Task ${id} is already ${todo.status}.`);
      const values: Record<string, unknown> = { question: null, question_at: null };
      if (changes.title !== undefined) values.title = changes.title;
      if (changes.instructions !== undefined) values.instructions = changes.instructions;
      if (changes.agent_needs !== undefined) values.automation_hint = changes.agent_needs || null;
      if (changes.kind !== undefined) values.kind = changes.kind;
      if (changes.blocking !== undefined) values.blocking = changes.blocking ? 1 : 0;
      if (changes.reply_prompt !== undefined) values.reply_prompt = changes.reply_prompt || null;
      if (changes.due !== undefined) values.due_at = changes.due === null ? null : Date.parse(changes.due);
      updateColumns(id, values);
      if (todo.question) announce(todo, "answered", null);
      changed(todo);
      return `Updated task ${id}.`;
    },
  });

  bb.agents.registerTool({
    name: "human_task_list",
    description: "List human tasks: by default the unfinished ones this thread created or joined; scope all = this project.",
    presentation: { label: { pending: "Checking human tasks", completed: "Checked human tasks" }, suppress: true },
    parameters: z.object({
      scope: z.enum(["this_thread", "all"]).default("this_thread"),
      include_finished: z.boolean().default(false),
    }),
    async execute({ scope, include_finished }, { threadId, projectId }) {
      const mine = (todo: Todo) => todo.sourceThreadId === threadId || todo.watcherThreadIds.includes(threadId);
      // "all" means all in this project; other threads' notes and answers stay private.
      const todos = listTodos()
        .filter((todo) => (scope === "all" ? todo.sourceProjectId === projectId : mine(todo)))
        .filter((todo) => include_finished || !isFinished(todo))
        .slice(0, 50)
        .map((todo) => (mine(todo) ? todo : redacted(todo)));
      if (todos.length === 0) return "No matching human tasks.";
      return (await withRelations(todos)).map(formatTodoDetail).join("\n\n---\n\n");
    },
  });

  // ---- CLI -----------------------------------------------------------------------

  const notFound = (id: string) => new PluginCliError(`no task with id ${id}`, { code: "task_not_found", hint: "Run `bb human-tasks list` to see ids." });
  const reply = (json: boolean, value: unknown, text: string) => ({ exitCode: 0, stdout: json ? JSON.stringify(value) : text });
  const jsonOption = { type: "boolean", description: "Emit machine-readable JSON" } as const;
  const idPositional = [{ name: "id", description: "Task id from `bb human-tasks list`", required: true }] as const;
  /**
   * From inside a thread, the shell sees this project only, without other
   * threads' notes. Best-effort: bb tells plugins the calling thread but can't
   * stop an agent from hiding it, so this guards against mistakes, not malice.
   */
  const visibleTo = (ctx: { threadId?: string | undefined; projectId?: string | undefined }) => (todo: Todo): Todo | null => {
    if (!ctx.threadId) return todo;
    if (ctx.projectId && todo.sourceProjectId !== ctx.projectId) return null;
    const mine = todo.sourceThreadId === ctx.threadId || todo.watcherThreadIds.includes(ctx.threadId);
    return mine ? todo : redacted(todo);
  };

  bb.cli.register(
    defineCli({
      name: "human-tasks",
      summary: "Steps only you can do, handed over by agents: list, show, add",
      commands: {
        list: cliCommand({
          summary: "List human tasks (unfinished by default)",
          options: {
            all: { type: "boolean", description: "Include done and dismissed tasks" },
            mine: { type: "boolean", description: "Only tasks the calling thread created or joined" },
            json: jsonOption,
          },
          async run({ options }, ctx) {
            const threadId = ctx.threadId ?? null;
            const todos = listTodos()
              .map(visibleTo(ctx))
              .filter((todo): todo is Todo => todo !== null)
              .filter((todo) => options.all || !isFinished(todo))
              .filter((todo) => !options.mine || (threadId !== null && (todo.sourceThreadId === threadId || todo.watcherThreadIds.includes(threadId))))
              .slice(0, 200);
            return reply(options.json, todos, todos.length === 0 ? "No human tasks." : todos.map(formatTodoLine).join("\n"));
          },
        }),
        show: cliCommand({
          summary: "Show one task with its instructions",
          positionals: idPositional,
          options: { json: jsonOption },
          async run({ positionals, options }, ctx) {
            const raw = getTodo(positionals.id);
            const found = raw === null ? null : visibleTo(ctx)(raw);
            if (found === null) throw notFound(positionals.id);
            const [todo] = await withRelations([found]);
            return reply(options.json, todo, formatTodoDetail(todo!));
          },
        }),
        add: cliCommand({
          summary: "Add a task for the user; links it to the calling thread",
          options: {
            title: { type: "string", required: true, description: `Short imperative title (max ${TITLE_MAX} chars)` },
            instructions: {
              type: "string",
              required: true,
              aliases: ["description", "desc"],
              description: `Markdown: what, where, how, and what to send back (max ${INSTRUCTIONS_MAX} chars)`,
            },
            kind: { type: "enum", values: KINDS, default: "other", description: "access, setup, payment, review, communicate, physical, or other" },
            blocking: { type: "boolean", description: "Your work cannot continue until this is done" },
            "reply-prompt": { type: "string", description: `What you need back, as a question (max ${REPLY_PROMPT_MAX} chars)` },
            secret: { type: "string", repeatable: true, description: "A credential you need back, as NAME or NAME:description. Repeat for more. Needs --env-file." },
            "env-file": { type: "string", description: "The .env file `bb secret request` should write the credentials to" },
            due: { type: "string", description: "Due date, ISO format (2026-11-02)" },
            "not-before": { type: "string", description: "Hide until this ISO date-time" },
            "agent-needs": {
              type: "string",
              aliases: ["hint", "handoff-hint", "automation-hint"],
              description: `What you would need to do this yourself, this time and next (max ${HINT_MAX} chars)`,
            },
            json: jsonOption,
          },
          async run({ options }, ctx) {
            const secrets = options.secret.map((entry) => {
              const [name = "", ...rest] = entry.split(":");
              return { name: name.trim(), description: rest.join(":").trim() || name.trim() };
            });
            const parsed = z
              .object({
                title: titleInput,
                instructions: instructionsInput,
                hint: hintInput.optional(),
                replyPrompt: replyPromptInput.optional(),
                secrets: secretsInput,
                envFile: envFileInput.optional(),
                due: dateInput.optional(),
                notBefore: dateInput.optional(),
              })
              .refine((value) => value.secrets.length === 0 || value.envFile !== undefined, { message: "--secret needs --env-file", path: ["envFile"] })
              .safeParse({
                title: options.title,
                instructions: options.instructions,
                hint: options["agent-needs"],
                replyPrompt: options["reply-prompt"],
                secrets,
                envFile: options["env-file"],
                due: options.due,
                notBefore: options["not-before"],
              });
            if (!parsed.success) {
              throw new PluginCliError(parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; "), { code: "invalid_value" });
            }
            const result = await createTodo({
              title: parsed.data.title,
              instructions: parsed.data.instructions,
              agentNeeds: parsed.data.hint,
              kind: options.kind as TaskKind,
              blocking: options.blocking,
              replyPrompt: parsed.data.replyPrompt,
              secrets: parsed.data.secrets,
              envFile: parsed.data.envFile,
              due: parsed.data.due,
              notBefore: parsed.data.notBefore,
              threadId: ctx.threadId,
              projectId: ctx.projectId,
            });
            const prefix = { created: "Added", duplicate_own: "Already exists:", joined: "Joined existing task:" }[result.outcome];
            return reply(options.json, { ...result.todo, outcome: result.outcome }, `${prefix} ${formatTodoLine(result.todo)}`);
          },
        }),
      },
    }),
  );
}
