import { describe, expect, it, vi } from "vitest";
import { createFakePluginHost, makeQueueEntry, makeThreadResponse } from "@get-bb/plugin-sdk/testing";
import plugin, { type Todo, type TodoView } from "./server";

type BotsList = {
  bots: { id: string; name: string; role: string; avatar: { color: string }; mainThreadId: string | null }[];
  threadBindings: { threadId: string; botId: string }[];
  projectOwners?: { projectId: string; botId: string }[];
};

type Thread = ReturnType<typeof makeThreadResponse>;

async function setup(threads: Record<string, Thread>, options: { bots?: BotsList; settings?: Record<string, boolean> } = {}) {
  const { bb, harness } = createFakePluginHost({
    pluginId: "human-tasks",
    ...(options.settings ? { settings: options.settings } : {}),
    sdk: {
      threads: {
        get: async ({ threadId }: { threadId: string }) => {
          const thread = threads[threadId];
          if (!thread) throw new Error("not found");
          return thread;
        },
        send: async () => ({ ok: true, delivery: "sent" }),
        spawn: async () => ({ id: "thr_planner" }),
      },
      projects: {
        list: async () => [
          { id: "proj_1", name: "Acme Web", kind: "standard" },
          { id: "proj_personal", name: "Personal", kind: "personal" },
        ],
      },
      plugins: {
        callRpc: async () => {
          if (!options.bots) throw new Error("plugin bots-sidebar is not installed");
          return options.bots;
        },
      },
    },
  });
  await plugin(bb);
  const create = (threadId: string, params: Record<string, unknown> = {}) =>
    harness.behavior.callAgentTool(
      "human_task_create",
      { title: "Create an API key", instructions: "Go to the console.", agent_needs: "An API token", ...params },
      { threadId, projectId: "proj_1" },
    );
  const list = async () => ((await harness.behavior.callRpc("todos_list", null)) as { todos: TodoView[] }).todos;
  const setStatus = (id: string, status: string, note?: string) =>
    harness.behavior.callRpc("todos_set_status", { id, status, ...(note ? { note } : {}) }) as Promise<Todo>;
  const sends = () =>
    harness.inspection.sdk.callsTo("threads.send").map((call) => call[0] as { threadId: string; mode: string; input: { text: string }[] });
  const waitForInteraction = async () => {
    for (let i = 0; i < 50 && harness.inspection.pendingInteractions.length === 0; i += 1) await new Promise((r) => setTimeout(r, 5));
    const interaction = harness.inspection.pendingInteractions[0];
    if (!interaction) throw new Error("no pending interaction");
    return interaction;
  };
  return { harness, create, list, setStatus, sends, waitForInteraction };
}

const live = (id: string, extra: Partial<Thread> = {}) => makeThreadResponse({ id, projectId: "proj_1", ...extra });

describe("creating and completing", () => {
  it("links a task to its thread and tells a live thread on completion", async () => {
    const { create, list, setStatus, sends } = await setup({ thr_live: live("thr_live", { title: "Set up billing" }) });
    await create("thr_live", { kind: "access" });
    const [task] = await list();
    expect(task).toMatchObject({ status: "open", kind: "access", sourceThreadId: "thr_live", sourceThreadTitle: "Set up billing" });

    const done = await setStatus(task!.id, "done", "Key is in 1Password");
    expect(done.notifyResult).toBe("notified");
    expect(sends()).toHaveLength(1);
    expect(sends()[0]).toMatchObject({ threadId: "thr_live", mode: "queue-if-active" });
    expect(sends()[0]!.input[0]!.text).toContain("Key is in 1Password");
  });

  it("does not message archived or missing threads", async () => {
    const { create, list, setStatus, sends } = await setup({ thr_archived: live("thr_archived", { archivedAt: Date.now() }) });
    await create("thr_archived");
    await create("thr_gone", { title: "Second" });
    for (const task of await list()) expect((await setStatus(task.id, "done")).notifyResult).toBe("skipped");
    expect(sends()).toHaveLength(0);
  });

  it("reports archived and deleted source threads on the list", async () => {
    const { create, list } = await setup({ thr_archived: live("thr_archived", { archivedAt: Date.now() }) });
    await create("thr_archived");
    await create("thr_missing", { title: "Other" });
    const states = Object.fromEntries((await list()).map((t) => [t.sourceThreadId, t.thread?.state]));
    expect(states).toEqual({ thr_archived: "archived", thr_missing: "deleted" });
  });

  it("only messages on the transition to done", async () => {
    const { create, list, setStatus, sends } = await setup({ thr_live: live("thr_live") });
    await create("thr_live");
    const [task] = await list();
    await setStatus(task!.id, "in_progress");
    await setStatus(task!.id, "done");
    await setStatus(task!.id, "done");
    expect(sends()).toHaveLength(1);
  });

  it("dismissing is silent unless the task was blocking", async () => {
    const { create, list, setStatus, sends } = await setup(
      { thr_a: live("thr_a"), thr_b: live("thr_b") },
      { settings: { askInThreadForBlocking: false } },
    );
    await create("thr_a", { title: "Quiet one" });
    await create("thr_b", { title: "Blocking one", blocking: true });
    for (const task of await list()) await setStatus(task.id, "dismissed");
    expect(sends().map((send) => send.threadId)).toEqual(["thr_b"]);
    expect(sends()[0]!.input[0]!.text).toContain("dismissed");
  });

  it("CLI add links the calling thread and accepts kind and secrets", async () => {
    const { harness, list } = await setup({ thr_cli: live("thr_cli") });
    const result = await harness.behavior.runCli(
      ["add", "--title", "Approve invoice", "--instructions", "Open the portal", "--kind", "payment", "--secret", "PORTAL_KEY:Portal key", "--env-file", ".env"],
      { threadId: "thr_cli" },
    );
    expect(result.exitCode).toBe(0);
    expect((await list())[0]).toMatchObject({
      sourceThreadId: "thr_cli",
      kind: "payment",
      secrets: [{ name: "PORTAL_KEY", description: "Portal key" }],
      envFile: ".env",
    });
    const missingEnv = await harness.behavior.runCli(["add", "--title", "X y", "--instructions", "z", "--secret", "A_KEY"], { threadId: "thr_cli" });
    expect(missingEnv.exitCode).not.toBe(0);
  });
});

describe("duplicates", () => {
  it("returns the existing task to the same thread instead of adding another", async () => {
    const { create, list } = await setup({ thr_a: live("thr_a") });
    await create("thr_a");
    const second = await create("thr_a", { title: "create an  API key!" });
    expect(JSON.stringify(second)).toContain("already exists");
    expect(await list()).toHaveLength(1);
  });

  it("lets another thread join a task and tells both when it is done", async () => {
    const { create, list, setStatus, sends } = await setup({ thr_a: live("thr_a"), thr_b: live("thr_b") });
    await create("thr_a");
    const joined = await create("thr_b");
    expect(JSON.stringify(joined)).toContain("requested by another thread");
    const [task] = await list();
    expect(task!.watcherThreadIds).toEqual(["thr_b"]);
    const done = await setStatus(task!.id, "done");
    expect(sends().map((send) => send.threadId)).toEqual(["thr_a", "thr_b"]);
    expect(sends()[1]!.input[0]!.text).toContain("You asked for this too");
    expect(done.notifyDetail).toContain("1 more thread");
  });
});

describe("credentials", () => {
  it("tells the agent to collect secrets with bb secret request, never in chat", async () => {
    const { create, list, setStatus, sends } = await setup({ thr_a: live("thr_a") });
    const missing = await create("thr_a", { secrets: [{ name: "STRIPE_KEY", description: "Stripe key" }] });
    expect(JSON.stringify(missing)).toContain("env_file");
    await create("thr_a", { secrets: [{ name: "STRIPE_KEY", description: 'Stripe "restricted" key' }], env_file: ".env.local" });
    const [task] = await list();
    await setStatus(task!.id, "done");
    const text = sends()[0]!.input[0]!.text;
    expect(text).toContain('bb secret request STRIPE_KEY --purpose "Create an API key" --describe STRIPE_KEY "Stripe restricted key" --write-env ".env.local"');
    expect(text).toContain("Never ask for them in chat");
  });
});

describe("blocking tasks in the thread", () => {
  it("opens a form and answers the waiting tool call when submitted there", async () => {
    const { harness, list, sends, waitForInteraction } = await setup({ thr_a: live("thr_a") });
    const call = harness.behavior.callAgentTool(
      "human_task_create",
      { title: "Approve the DNS change", instructions: "Click approve.", blocking: true, agent_needs: "Nothing, it needs a person", reply_prompt: "Which record?" },
      { threadId: "thr_a", projectId: "proj_1" },
    );
    const interaction = await waitForInteraction();
    expect(interaction).toMatchObject({ threadId: "thr_a", rendererId: "task", title: "Approve the DNS change" });
    expect((await list())[0]!.waitingInThread).toBe(true);

    harness.behavior.submitInteraction(interaction.id, { action: "done", note: "The TXT one" });
    const result = JSON.stringify(await call);
    expect(result).toContain("The user finished");
    expect(result).toContain("The TXT one");
    // The tool result carried the answer, so no extra message was sent.
    expect(sends()).toHaveLength(0);
    const [task] = await list();
    expect(task).toMatchObject({ status: "done", notifyResult: "notified", waitingInThread: false });
  });

  it("closes the form and answers the tool call when completed on the page", async () => {
    const { harness, list, setStatus, sends, waitForInteraction } = await setup({ thr_a: live("thr_a") });
    const call = harness.behavior.callAgentTool(
      "human_task_create",
      { title: "Sign the contract", instructions: "Sign it.", blocking: true, agent_needs: "Nothing, it needs a person" },
      { threadId: "thr_a", projectId: "proj_1" },
    );
    await waitForInteraction();
    const [task] = await list();
    await setStatus(task!.id, "done", "Signed");
    expect(JSON.stringify(await call)).toContain("Signed");
    expect(sends()).toHaveLength(0);
  });

  it("keeps the task open when the user picks Later", async () => {
    const { harness, list, setStatus, sends, waitForInteraction } = await setup({ thr_a: live("thr_a") });
    const call = harness.behavior.callAgentTool(
      "human_task_create",
      { title: "Plug in the device", instructions: "USB-C.", blocking: true, agent_needs: "Nothing, it needs a person" },
      { threadId: "thr_a", projectId: "proj_1" },
    );
    harness.behavior.cancelInteraction((await waitForInteraction()).id);
    // An error reaches only an agent that is still active, so an idle one is not woken.
    await expect(call).rejects.toThrow("still open");
    expect((await list())[0]).toMatchObject({ status: "open", waitingInThread: false });
    // Finishing it later falls back to an ordinary thread message.
    await setStatus((await list())[0]!.id, "done");
    expect(sends().map((send) => send.threadId)).toEqual(["thr_a"]);
  });
});

describe("agent tools", () => {
  it("only lets the requesting thread update a task", async () => {
    const { harness, create, list } = await setup({ thr_a: live("thr_a"), thr_b: live("thr_b") });
    await create("thr_a");
    const [task] = await list();
    const denied = await harness.behavior.callAgentTool("human_task_update", { id: task!.id, title: "Hijack" }, { threadId: "thr_b" });
    expect(JSON.stringify(denied)).toContain("another thread");
    await harness.behavior.callAgentTool("human_task_update", { id: task!.id, instructions: "New steps", blocking: true }, { threadId: "thr_a" });
    await harness.behavior.callAgentTool("human_task_update", { id: task!.id, action: "dismiss" }, { threadId: "thr_a" });
    expect((await list())[0]!.status).toBe("dismissed");

  });

  it("spots recurring chores and tells the next agent one was done by an agent", async () => {
    const { harness, create, list } = await setup({ thr_a: live("thr_a") });
    await create("thr_a", { title: "Rotate the staging database password" });
    const [first] = await list();
    await harness.behavior.callRpc("todos_hand_back", { id: first!.id });
    await harness.behavior.callAgentTool(
      "human_task_update",
      { id: first!.id, action: "complete", summary: "Rotated with gcloud", method: "cli_login" },
      { threadId: "thr_a" },
    );
    const created = await create("thr_a", { title: "Rotate staging database password again" });
    expect(JSON.stringify(created)).toContain("a CLI login");
    await create("thr_a", { title: "Buy a domain" });
    const byTitle = Object.fromEntries((await list()).map((t) => [t.title, t.recurrence]));
    expect(byTitle["Rotate staging database password again"]).toEqual({ count: 1, agentDidSimilar: { taskId: first!.id, method: "cli_login" } });
    expect(byTitle["Buy a domain"]).toEqual({ count: 0, agentDidSimilar: null });
    expect(((await harness.behavior.callRpc("todos_list", null)) as { stats: { doneByAgents: number } }).stats.doneByAgents).toBe(1);
  });
});

describe("the loop back to the agent", () => {
  it("hands a task back so the agent does it, then completes it", async () => {
    const { harness, create, list, sends } = await setup({ thr_a: live("thr_a"), thr_b: live("thr_b") });
    await create("thr_a");
    await create("thr_b"); // joins as a watcher
    const [task] = await list();
    await harness.behavior.callRpc("todos_hand_back", { id: task!.id, note: "Connected the Stripe MCP" });
    expect(sends()[0]!.threadId).toBe("thr_a");
    expect(sends()[0]!.input[0]!.text).toContain("Connected the Stripe MCP");
    expect(sends()[0]!.input[0]!.text).toContain("tell them exactly what you need");
    expect((await list())[0]).toMatchObject({ handedBack: true, status: "in_progress" });

    const denied = await harness.behavior.callAgentTool("human_task_update", { id: task!.id, action: "complete", summary: "x" }, { threadId: "thr_b" });
    expect(JSON.stringify(denied)).toContain("another thread");
    await harness.behavior.callAgentTool(
      "human_task_update",
      { id: task!.id, action: "complete", summary: "Created the key via MCP", method: "mcp" },
      { threadId: "thr_a" },
    );
    expect((await list())[0]).toMatchObject({ status: "done", doneByAgent: true, handoffMethod: "mcp", completionNote: "Done by the agent: Created the key via MCP" });
    expect(sends().map((send) => send.threadId)).toEqual(["thr_a", "thr_b"]);
    expect(harness.realtimeSignals.some((signal) => JSON.stringify(signal).includes("completed_by_agent"))).toBe(true);
  });

  it("lets the agent send a handed-back task back to the user", async () => {
    const { harness, create, list } = await setup({ thr_a: live("thr_a") });
    await create("thr_a");
    const [task] = await list();
    await harness.behavior.callRpc("todos_hand_back", { id: task!.id });
    await harness.behavior.callAgentTool("human_task_update", { id: task!.id, action: "send_back", reason: "The MCP has no write scope" }, { threadId: "thr_a" });
    expect((await list())[0]).toMatchObject({ status: "open", handedBack: false, agentNote: "The MCP has no write scope" });
  });

  it("lets the user take a handed-back task back and tells the agent to stop", async () => {
    const { harness, create, list, sends } = await setup({ thr_a: live("thr_a") });
    await create("thr_a");
    const [task] = await list();
    await harness.behavior.callRpc("todos_hand_back", { id: task!.id });
    await harness.behavior.callRpc("todos_take_back", { id: task!.id });
    expect((await list())[0]).toMatchObject({ status: "open", handedBack: false });
    expect(sends()[1]!.input[0]!.text).toContain("Stop working on it");
  });

  it("lets the agent reopen a done task it could not verify, and clears the note when finished again", async () => {
    const { harness, create, list, setStatus } = await setup({ thr_a: live("thr_a") });
    await create("thr_a");
    const [task] = await list();
    const early = await harness.behavior.callAgentTool("human_task_update", { id: task!.id, action: "send_back", reason: "x" }, { threadId: "thr_a" });
    expect(JSON.stringify(early)).toContain("still with the user");
    await setStatus(task!.id, "done");
    await harness.behavior.callAgentTool("human_task_update", { id: task!.id, action: "send_back", reason: "TXT record not found" }, { threadId: "thr_a" });
    expect((await list())[0]).toMatchObject({ status: "open", agentNote: "TXT record not found", completedAt: null });
    await setStatus(task!.id, "done");
    expect((await list())[0]).toMatchObject({ status: "done", agentNote: null });
  });

  it("sends the user's question to the thread and clears it when the agent updates the task", async () => {
    const { harness, create, list, sends } = await setup({ thr_a: live("thr_a"), thr_gone: live("thr_gone", { archivedAt: Date.now() }) });
    await create("thr_a");
    const [task] = await list();
    await harness.behavior.callRpc("todos_ask", { id: task!.id, question: "Which Stripe account?" });
    expect(sends()[0]!.input[0]!.text).toContain("Which Stripe account?");
    expect((await list())[0]!.question).toBe("Which Stripe account?");
    await harness.behavior.callAgentTool("human_task_update", { id: task!.id, instructions: "Use the Acme account." }, { threadId: "thr_a" });
    expect((await list())[0]).toMatchObject({ question: null, instructions: "Use the Acme account." });

    await create("thr_gone", { title: "Other" });
    const other = (await list()).find((t) => t.title === "Other")!;
    await expect(harness.behavior.callRpc("todos_ask", { id: other.id, question: "?" })).rejects.toThrow("archived");
  });

  it("marks the agent as resumed when its thread gets busy after completion", async () => {
    const { harness, create, list, setStatus } = await setup({ thr_a: live("thr_a") });
    await create("thr_a");
    const [task] = await list();
    await setStatus(task!.id, "done");
    expect((await list())[0]!.resumedAt).toBeNull();
    await harness.behavior.emitThreadEvent("thread.active", { thread: live("thr_a") });
    expect((await list())[0]!.resumedAt).toEqual(expect.any(Number));
  });
});

describe("timing", () => {
  it("snoozes a task and brings it back with a reminder", async () => {
    const { harness, create, list } = await setup({ thr_a: live("thr_a") });
    await create("thr_a");
    const [task] = await list();
    await harness.behavior.callRpc("todos_snooze", { id: task!.id, until: Date.now() + 60_000 });
    await harness.behavior.runSchedule("resurface");
    expect((await list())[0]!.snoozedUntil).toEqual(expect.any(Number));
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(Date.now() + 120_000);
      await harness.behavior.runSchedule("resurface");
      expect((await list())[0]!.snoozedUntil).toBeNull();
      expect(harness.realtimeSignals.some((signal) => JSON.stringify(signal).includes('"due"'))).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("accepts due and not-before dates from agents", async () => {
    const { create, list } = await setup({ thr_a: live("thr_a") });
    const later = new Date(Date.now() + 2 * 86_400_000).toISOString();
    await create("thr_a", { due: "2030-01-15", not_before: later });
    const [task] = await list();
    expect(task!.dueAt).toBe(Date.parse("2030-01-15"));
    expect(task!.snoozedUntil).toBe(Date.parse(later));
    const bad = await create("thr_a", { title: "Bad date", due: "next tuesday" }).catch((error: unknown) => String(error));
    expect(String(JSON.stringify(bad))).toContain("ISO date");
  });
});

describe("blocking tasks handed back from the form", () => {
  it("answers the waiting tool call with the hand-back", async () => {
    const { harness, list, sends, waitForInteraction } = await setup({ thr_a: live("thr_a") });
    const call = harness.behavior.callAgentTool(
      "human_task_create",
      { title: "Add the DNS record", instructions: "In Cloudflare.", blocking: true, agent_needs: "Nothing, it needs a person" },
      { threadId: "thr_a", projectId: "proj_1" },
    );
    harness.behavior.submitInteraction((await waitForInteraction()).id, { action: "hand_back", note: "CF token is in .env" });
    const result = JSON.stringify(await call);
    expect(result).toContain("wants you to do");
    expect(result).toContain("CF token is in .env");
    expect(sends()).toHaveLength(0);
    expect((await list())[0]).toMatchObject({ handedBack: true, status: "in_progress" });
  });
});

describe("relations", () => {
  it("relates a task to its project and to the bot that owns the thread's parent", async () => {
    const { create, list } = await setup(
      { thr_child: live("thr_child", { parentThreadId: "thr_bot_main" }), thr_bot_main: live("thr_bot_main") },
      {
        bots: {
          bots: [{ id: "bot_1", name: "RevOps Manager", role: "Analyst", avatar: { color: "#e152b0" }, mainThreadId: "thr_bot_main" }],
          threadBindings: [{ threadId: "thr_bot_main", botId: "bot_1" }],
        },
      },
    );
    await create("thr_child");
    const [task] = await list();
    expect(task!.sourceBotId).toBe("bot_1");
    expect(task!.project).toEqual({ id: "proj_1", name: "Acme Web" });
    expect(task!.bot).toMatchObject({ id: "bot_1", name: "RevOps Manager", color: "#e152b0" });
  });

  it("falls back to the bot that owns the task's project", async () => {
    const { create, list } = await setup(
      { thr_plain: live("thr_plain") },
      {
        bots: {
          bots: [{ id: "bot_2", name: "SEO Lead", role: "Marketing", avatar: { color: "#f5a524" }, mainThreadId: null }],
          threadBindings: [],
          projectOwners: [{ projectId: "proj_1", botId: "bot_2" }],
        },
      },
    );
    await create("thr_plain");
    expect((await list())[0]!.bot).toMatchObject({ id: "bot_2", via: "project" });
  });

  it("works without the bots plugin", async () => {
    const { create, list } = await setup({ thr_live: live("thr_live") });
    await create("thr_live");
    const [task] = await list();
    expect(task!.bot).toBeNull();
    expect(task!.project?.name).toBe("Acme Web");
  });
});

describe("boundaries between threads and projects", () => {
  it("only merges duplicates within the same project", async () => {
    const { harness, list } = await setup({ thr_a: live("thr_a"), thr_b: live("thr_b", { projectId: "proj_2" }) });
    const make = (threadId: string, projectId: string) =>
      harness.behavior.callAgentTool(
        "human_task_create",
        { title: "Create a restricted Stripe key", instructions: "x", agent_needs: "y" },
        { threadId, projectId },
      );
    await make("thr_a", "proj_1");
    await make("thr_b", "proj_2");
    const tasks = await list();
    expect(tasks).toHaveLength(2);
    expect(tasks.every((task) => task.watcherThreadIds.length === 0)).toBe(true);
  });

  it("never gives a joining thread the requester's credential command", async () => {
    const { create, list, setStatus, sends } = await setup({ thr_a: live("thr_a"), thr_b: live("thr_b") });
    await create("thr_a", { secrets: [{ name: "STRIPE_KEY", description: "Stripe key" }], env_file: ".env.local" });
    await create("thr_b");
    await setStatus((await list())[0]!.id, "done");
    const [toRequester, toWatcher] = sends().map((send) => send.input[0]!.text);
    expect(toRequester).toContain("bb secret request");
    expect(toWatcher).not.toContain("bb secret request");
    expect(toWatcher).toContain("create your own task");
  });

  it("sends the user's reply only to the thread that asked, not to threads that joined", async () => {
    const { harness, create, list, setStatus, sends } = await setup({ thr_a: live("thr_a"), thr_b: live("thr_b") });
    await create("thr_a");
    await create("thr_b");
    await setStatus((await list())[0]!.id, "done", "the code is 4242");
    const [toRequester, toWatcher] = sends().map((send) => send.input[0]!.text);
    expect(toRequester).toContain("the code is 4242");
    expect(toWatcher).not.toContain("4242");
    const fromWatcher = JSON.stringify(
      await harness.behavior.callAgentTool("human_task_list", { include_finished: true }, { threadId: "thr_b", projectId: "proj_1" }),
    );
    expect(fromWatcher).not.toContain("4242");
  });

  it("has no shell commands that speak for the user", async () => {
    const { harness, create, list } = await setup({ thr_a: live("thr_a") });
    await create("thr_a");
    const [task] = await list();
    for (const command of ["done", "reopen", "dismiss", "remove"]) {
      expect((await harness.behavior.runCli([command, task!.id], { threadId: "thr_other" })).exitCode).not.toBe(0);
      expect((await harness.behavior.runCli([command, task!.id])).exitCode).not.toBe(0);
    }
    expect((await list())[0]!.status).toBe("open");
  });

  it("keeps other threads' notes private and lists 'all' within the project only", async () => {
    const { harness, create, list, setStatus } = await setup({
      thr_a: live("thr_a"),
      thr_b: live("thr_b"),
      thr_c: live("thr_c", { projectId: "proj_2" }),
    });
    await create("thr_a", { title: "Private one" });
    const [task] = await list();
    await harness.behavior.callRpc("todos_ask", { id: task!.id, question: "Secret plan?" });
    const fromB = JSON.stringify(await harness.behavior.callAgentTool("human_task_list", { scope: "all" }, { threadId: "thr_b", projectId: "proj_1" }));
    expect(fromB).toContain("Private one");
    expect(fromB).not.toContain("Secret plan?");
    const fromC = JSON.stringify(await harness.behavior.callAgentTool("human_task_list", { scope: "all" }, { threadId: "thr_c", projectId: "proj_2" }));
    expect(fromC).toContain("No matching");
    await setStatus(task!.id, "done", "my private note");
    const shown = await harness.behavior.runCli(["show", task!.id, "--json"], { threadId: "thr_b", projectId: "proj_1" });
    expect(shown.stdout).not.toContain("my private note");
  });
});

describe("forms the plugin closes itself", () => {
  it("answers neutrally when the agent withdraws its own blocking task", async () => {
    const { harness, list, waitForInteraction } = await setup({ thr_a: live("thr_a") });
    const call = harness.behavior.callAgentTool(
      "human_task_create",
      { title: "Sign the contract", instructions: "Sign it.", agent_needs: "A person", blocking: true },
      { threadId: "thr_a", projectId: "proj_1" },
    );
    await waitForInteraction();
    const [task] = await list();
    await harness.behavior.callAgentTool("human_task_update", { id: task!.id, action: "dismiss" }, { threadId: "thr_a" });
    await expect(call).rejects.toThrow("You dismissed");
  });

  it("closes the form when the thread is archived and records nothing as delivered", async () => {
    const { harness, list, waitForInteraction } = await setup({ thr_a: live("thr_a") });
    const call = harness.behavior.callAgentTool(
      "human_task_create",
      { title: "Plug in the device", instructions: "USB-C.", agent_needs: "A person", blocking: true },
      { threadId: "thr_a", projectId: "proj_1" },
    );
    await waitForInteraction();
    await harness.behavior.emitThreadEvent("thread.archived", { thread: live("thr_a", { archivedAt: Date.now() }) });
    await expect(call).rejects.toThrow("archived");
    expect((await list())[0]).toMatchObject({ status: "open", waitingInThread: false });
  });

  it("remembers 'Later' so a reload doesn't show the form again, but re-opens interrupted forms", async () => {
    const { harness, waitForInteraction } = await setup({ thr_a: live("thr_a", { status: "idle" }), thr_b: live("thr_b", { status: "idle" }) });
    const later = harness.behavior.callAgentTool(
      "human_task_create",
      { title: "Approve the charge", instructions: "Approve.", agent_needs: "A person", blocking: true },
      { threadId: "thr_a", projectId: "proj_1" },
    );
    harness.behavior.cancelInteraction((await waitForInteraction()).id);
    await expect(later).rejects.toThrow("still open");
    void harness.behavior.callAgentTool(
      "human_task_create",
      { title: "Sign the lease", instructions: "Sign.", agent_needs: "A person", blocking: true },
      { threadId: "thr_b", projectId: "proj_1" },
    ).catch(() => undefined);
    for (let i = 0; i < 50 && harness.inspection.pendingInteractions.length === 0; i += 1) await new Promise((r) => setTimeout(r, 5));
    // reload() hands back the reloaded instance's harness.
    const reloaded = await harness.lifecycle.reload(plugin);
    await new Promise((r) => setTimeout(r, 3300));
    const reopened = reloaded.harness.inspection.pendingInteractions.map((interaction) => interaction.threadId);
    expect(reopened).toEqual(["thr_b"]);
  }, 10_000);
});

describe("change signals", () => {
  it("coalesces a burst into one signal naming the threads and carrying counts", async () => {
    const { harness, create } = await setup({ thr_a: live("thr_a"), thr_b: live("thr_b") });
    await create("thr_a", { title: "One" });
    await create("thr_b", { title: "Two" });
    await new Promise((r) => setTimeout(r, 80));
    const signals = harness.realtimeSignals.filter((signal) => JSON.stringify(signal).includes("todos-changed"));
    expect(signals.length).toBeLessThanOrEqual(2);
    const last = JSON.stringify(signals.at(-1));
    expect(last).toContain('"open":2');
    expect(last).toContain("thr_a");
    expect(last).toContain("thr_b");
  });
});

describe("deleting a queued hand-back", () => {
  it("takes the task back when the queued message is deleted, and not when it dispatches", async () => {
    const { harness, create, list } = await setup({ thr_a: live("thr_a") });
    harness.sdk.stub("threads.send", async () => ({
      ok: true,
      delivery: "queued",
      queuedMessage: makeQueueEntry({ id: "qm_1", threadId: "thr_a" }),
    }));
    await create("thr_a");
    const [task] = await list();
    await harness.behavior.callRpc("todos_hand_back", { id: task!.id, note: "Use my browser" });
    expect((await list())[0]).toMatchObject({ handedBack: true, status: "in_progress" });

    await harness.behavior.emitThreadEvent("message.cancelled", { entry: makeQueueEntry({ id: "qm_other", threadId: "thr_a" }) });
    expect((await list())[0]!.handedBack).toBe(true);

    await harness.behavior.emitThreadEvent("message.cancelled", { entry: makeQueueEntry({ id: "qm_1", threadId: "thr_a" }) });
    expect((await list())[0]).toMatchObject({ handedBack: false, status: "open", handbackNote: null });
    expect(harness.realtimeSignals.some((signal) => JSON.stringify(signal).includes("handback_cancelled"))).toBe(true);
  });

  it("forgets the message once it dispatches", async () => {
    const { harness, create, list } = await setup({ thr_a: live("thr_a") });
    harness.sdk.stub("threads.send", async () => ({ ok: true, delivery: "queued", queuedMessage: makeQueueEntry({ id: "qm_2", threadId: "thr_a" }) }));
    await create("thr_a");
    const [task] = await list();
    await harness.behavior.callRpc("todos_hand_back", { id: task!.id });
    await harness.behavior.emitThreadEvent("message.dispatched", { entry: makeQueueEntry({ id: "qm_2", threadId: "thr_a" }) });
    await harness.behavior.emitThreadEvent("message.cancelled", { entry: makeQueueEntry({ id: "qm_2", threadId: "thr_a" }) });
    expect((await list())[0]).toMatchObject({ handedBack: true, status: "in_progress" });
  });
});

describe("re-review fixes", () => {
  it("returns a handed-back task to the user when its thread is archived", async () => {
    const { harness, create, list } = await setup({ thr_a: live("thr_a") });
    await create("thr_a");
    const [task] = await list();
    await harness.behavior.callRpc("todos_hand_back", { id: task!.id });
    await harness.behavior.emitThreadEvent("thread.archived", { thread: live("thr_a", { archivedAt: Date.now() }) });
    expect((await list())[0]).toMatchObject({ handedBack: false, status: "open" });
  });

  it("opens a pending blocking form when its thread becomes idle", async () => {
    const thread = live("thr_a", { status: "active" });
    const { harness, list } = await setup({ thr_a: thread });
    const later = new Date(Date.now() + 3_600_000).toISOString();
    await harness.behavior.callAgentTool(
      "human_task_create",
      { title: "Click verify", instructions: "After DNS propagates.", agent_needs: "A person", blocking: true, not_before: later },
      { threadId: "thr_a", projectId: "proj_1" },
    );
    const [task] = await list();
    await harness.behavior.callRpc("todos_snooze", { id: task!.id, until: null });
    expect(harness.inspection.pendingInteractions).toHaveLength(0); // thread busy
    Object.assign(thread, { status: "idle" });
    await harness.behavior.emitThreadEvent("thread.idle", { thread, lastAssistantText: null });
    for (let i = 0; i < 50 && harness.inspection.pendingInteractions.length === 0; i += 1) await new Promise((r) => setTimeout(r, 5));
    expect(harness.inspection.pendingInteractions.map((interaction) => interaction.threadId)).toEqual(["thr_a"]);
  });

  it("reports finished tasks' thread state as unknown instead of live", async () => {
    const { create, list, setStatus } = await setup({ thr_a: live("thr_a") });
    await create("thr_a");
    await setStatus((await list())[0]!.id, "done");
    expect((await list())[0]!.thread?.state).toBe("unknown");
  });
});
