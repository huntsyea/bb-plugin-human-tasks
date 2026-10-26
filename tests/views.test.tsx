// @vitest-environment jsdom
// The Human tasks page's List and Board views, tested through the registered
// nav panel with the SDK's test runtime: rpc is a handler map, so every status
// change is visible as the server action it calls.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import type { PluginRpcTestHandlers } from "@get-bb/plugin-sdk/testing/app";
import type { rpcContract, Todo, TodoStatus, TodoView } from "../server";

const NARROW = "(max-width: 767px)";
let narrow = false;

// Node's own experimental localStorage global hides jsdom's, so give each test a fresh one.
function memoryStorage(): Storage {
  const items = new Map<string, string>();
  return {
    get length() {
      return items.size;
    },
    clear: () => items.clear(),
    getItem: (key) => items.get(key) ?? null,
    key: (index) => [...items.keys()][index] ?? null,
    removeItem: (key) => void items.delete(key),
    setItem: (key, value) => void items.set(key, String(value)),
  };
}

beforeEach(() => {
  narrow = false;
  Object.defineProperty(window, "localStorage", { value: memoryStorage(), configurable: true });
  window.matchMedia = ((query: string) => ({
    matches: query === NARROW ? narrow : false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;
});
afterEach(cleanup);

let seq = 0;
function task(fields: Partial<TodoView> & Pick<TodoView, "title">): TodoView {
  seq += 1;
  const now = Date.now();
  return {
    id: `t${seq}`,
    instructions: `Steps for ${fields.title}.`,
    agentNeeds: null,
    kind: "setup",
    blocking: false,
    replyPrompt: null,
    secrets: [],
    envFile: null,
    status: "open",
    sourceThreadId: "thr_asker",
    sourceProjectId: "proj_1",
    sourceThreadTitle: "Asker",
    sourceBotId: null,
    watcherThreadIds: [],
    handoffMethod: null,
    handoffSummary: null,
    handedBack: false,
    doneByAgent: false,
    handbackNote: null,
    agentNote: null,
    question: null,
    questionAt: null,
    dueAt: null,
    snoozedUntil: null,
    createdAt: now - 60_000,
    updatedAt: now,
    completedAt: fields.status === "done" || fields.status === "dismissed" ? now : null,
    completionNote: null,
    notifyResult: null,
    notifyDetail: null,
    resumedAt: null,
    recurrence: { count: 0, agentDidSimilar: null },
    waitingInThread: false,
    thread: { id: "thr_asker", title: "Asker", state: "live" },
    project: { id: "proj_1", name: "Acme Web" },
    bot: null,
    ...fields,
  };
}

async function renderPage(todos: TodoView[], options: { holdStatusCalls?: boolean } = {}) {
  const app = await loadPluginApp(() => import("../app"));
  const panel = app.navPanels.find((entry) => entry.path === "tasks")!;
  const setStatusCalls: { id: string; status: TodoStatus; note?: string }[] = [];
  const otherCalls: { method: string; input: unknown }[] = [];
  const held: (() => void)[] = [];
  const found = (id: string) => todos.find((t) => t.id === id)! as Todo;
  // The page lists tasks and changes them through these actions; any other call fails the test.
  const rpc: Pick<PluginRpcTestHandlers<typeof rpcContract>, "todos_list" | "todos_set_status" | "todos_snooze" | "todos_hand_back"> = {
    todos_list: () => ({
      todos,
      stats: { open: todos.filter((t) => t.status === "open" || t.status === "in_progress").length, blocking: 0, done: 0, doneByAgents: 0 },
      bots: [],
    }),
    todos_set_status: (input) => {
      setStatusCalls.push(input);
      const result = { ...found(input.id), status: input.status };
      // Held calls stay in flight until `release`, as a slow server would.
      return options.holdStatusCalls ? new Promise<Todo>((resolve) => held.push(() => resolve(result))) : result;
    },
    todos_snooze: (input) => {
      otherCalls.push({ method: "todos_snooze", input });
      return found(input.id);
    },
    todos_hand_back: (input) => {
      otherCalls.push({ method: "todos_hand_back", input });
      return found(input.id);
    },
  };
  const view = renderSlot<{ subPath: string }, typeof rpcContract>(panel, { subPath: "" }, { rpc: rpc as PluginRpcTestHandlers<typeof rpcContract> });
  await screen.findByText(todos[0]!.title);
  const release = async () => {
    await act(async () => {
      for (const resolve of held.splice(0)) resolve();
    });
  };
  return { view, setStatusCalls, otherCalls, release };
}

describe("the List | Board toggle", () => {
  it("starts on List and remembers Board on this device", async () => {
    const todos = [task({ title: "Add a DNS record" })];
    await renderPage(todos);
    expect(screen.getByRole("radio", { name: "List" }).getAttribute("aria-checked")).toBe("true");

    fireEvent.click(screen.getByRole("radio", { name: "Board" }));
    expect(screen.getByRole("region", { name: "To do" })).toBeTruthy();

    cleanup();
    await renderPage(todos);
    expect(screen.getByRole("radio", { name: "Board" }).getAttribute("aria-checked")).toBe("true");
    expect(screen.getByRole("region", { name: "To do" })).toBeTruthy();
  });
});

async function openBoard(todos: TodoView[], options: { holdStatusCalls?: boolean } = {}) {
  window.localStorage.setItem("bb-plugin-human-tasks:view", "board");
  return renderPage(todos, options);
}

const column = (name: string) => screen.getByRole("region", { name });
/** Titles of the cards in a column, top to bottom. Test titles all end in " one". */
const titlesIn = (name: string) =>
  within(column(name))
    .queryAllByText(/ one$/)
    .map((node) => node.textContent);

describe("the Board's columns", () => {
  it("sorts tasks by status, hides dismissed until asked, and keeps snoozed folded", async () => {
    const todos = [
      task({ title: "Open one" }),
      task({ title: "Started one", status: "in_progress" }),
      task({ title: "Agent's one", status: "in_progress", handedBack: true }),
      task({ title: "Finished one", status: "done" }),
      task({ title: "Dismissed one", status: "dismissed" }),
      task({ title: "Snoozed one", snoozedUntil: Date.now() + 3_600_000 }),
    ];
    await openBoard(todos);

    expect(titlesIn("To do")).toEqual(["Open one"]);
    expect(titlesIn("In progress")).toEqual(["Started one", "Agent's one"]);
    expect(titlesIn("Done")).toEqual(["Finished one"]);

    fireEvent.click(within(column("To do")).getByRole("button", { name: /Snoozed/ }));
    expect(titlesIn("To do")).toEqual(["Open one", "Snoozed one"]);

    fireEvent.click(within(column("Done")).getByRole("switch", { name: "Show dismissed" }));
    expect(titlesIn("Done")).toEqual(["Finished one", "Dismissed one"]);
  });
});

/** A stand-in for the browser's DataTransfer, which jsdom lacks. */
function dataTransfer() {
  const data = new Map<string, string>();
  return {
    dropEffect: "none",
    effectAllowed: "all",
    types: [] as string[],
    setData: (type: string, value: string) => void data.set(type, value),
    getData: (type: string) => data.get(type) ?? "",
  };
}

function drag(title: string, to: string) {
  const card = screen.getByText(title).closest("li")!;
  const transfer = dataTransfer();
  fireEvent.dragStart(card, { dataTransfer: transfer });
  fireEvent.dragOver(column(to), { dataTransfer: transfer });
  fireEvent.drop(column(to), { dataTransfer: transfer });
  fireEvent.dragEnd(card, { dataTransfer: transfer });
}

describe("moving a card on a desktop Board", () => {
  // The server is a mock here: this proves the drop sends the checkbox's exact call. What that call
  // does (closing the in-thread form, resuming the agent, the secret follow-up) is server.test.ts's job.
  it("dragging to Done sends the same call as checking it off in the List", async () => {
    const todos = [task({ title: "Check one" })];
    const list = await renderPage(todos);
    fireEvent.click(screen.getByRole("checkbox", { name: 'Mark "Check one" done' }));
    await waitFor(() => expect(list.setStatusCalls).toEqual([{ id: todos[0]!.id, status: "done" }]));
    cleanup();

    const board = await openBoard(todos);
    drag("Check one", "Done");
    await waitFor(() => expect(board.setStatusCalls).toEqual(list.setStatusCalls));
  });

  it("reopens a finished card only to To do, as the List's Reopen does", async () => {
    const todos = [
      task({ title: "Agent finished one", status: "done", handedBack: true, doneByAgent: true }),
      task({ title: "Mine finished one", status: "done" }),
    ];
    const { setStatusCalls } = await openBoard(todos);
    drag("Agent finished one", "In progress");
    drag("Mine finished one", "In progress");
    await act(async () => {});
    expect(setStatusCalls).toEqual([]);

    drag("Agent finished one", "To do");
    await waitFor(() => expect(setStatusCalls).toEqual([{ id: todos[0]!.id, status: "open" }]));
  });

  it("lets a card the agent is doing go only to Done", async () => {
    const todos = [task({ title: "Agent's one", status: "in_progress", handedBack: true })];
    const { setStatusCalls } = await openBoard(todos);
    drag("Agent's one", "To do");
    await act(async () => {});
    expect(setStatusCalls).toEqual([]);
    drag("Agent's one", "Done");
    await waitFor(() => expect(setStatusCalls).toEqual([{ id: todos[0]!.id, status: "done" }]));
  });

  it("ignores a drop while the card's last change is still on its way", async () => {
    const todos = [task({ title: "Slow one" })];
    const { setStatusCalls, release } = await openBoard(todos, { holdStatusCalls: true });
    drag("Slow one", "In progress");
    await waitFor(() => expect(setStatusCalls).toHaveLength(1));
    drag("Slow one", "Done");
    await act(async () => {});
    expect(setStatusCalls).toEqual([{ id: todos[0]!.id, status: "in_progress" }]);
    await release();
  });

  it("dragging between To do and In progress sets that status", async () => {
    const todos = [task({ title: "Start one" }), task({ title: "Pause one", status: "in_progress" })];
    const { setStatusCalls } = await openBoard(todos);
    drag("Start one", "In progress");
    drag("Pause one", "To do");
    await waitFor(() =>
      expect(setStatusCalls).toEqual([
        { id: todos[0]!.id, status: "in_progress" },
        { id: todos[1]!.id, status: "open" },
      ]),
    );
  });
});

// Trips the plugin's credential check. Built at runtime so no key-shaped literal sits in the source.
const KEY_SHAPED_NOTE = ["sk", "live", "abcdefghijklmnopqrstuvwx"].join("_");

describe("a card that needs input before it can be done", () => {
  it("opens its reply box when dragged to Done, and completes only once answered", async () => {
    const todos = [task({ title: "Reply one", replyPrompt: "Which region did you pick?" })];
    const { setStatusCalls } = await openBoard(todos);

    drag("Reply one", "Done");
    const answer = await screen.findByRole("textbox", { name: "Which region did you pick?" });
    await waitFor(() => expect(document.activeElement).toBe(answer));
    expect(setStatusCalls).toEqual([]);

    fireEvent.change(answer, { target: { value: "eu-west-1" } });
    fireEvent.click(screen.getByRole("button", { name: "Mark done" }));
    await waitFor(() => expect(setStatusCalls).toEqual([{ id: todos[0]!.id, status: "done", note: "eu-west-1" }]));
  });

  it("holds back a note that looks like a credential, as the checkbox does", async () => {
    const todos = [task({ title: "Key one" })];
    const { setStatusCalls } = await openBoard(todos);
    fireEvent.click(screen.getByRole("button", { name: /Key one/ }));
    fireEvent.change(screen.getByRole("textbox", { name: "Note for the agent" }), { target: { value: KEY_SHAPED_NOTE } });
    fireEvent.click(screen.getByRole("button", { name: "Collapse" }));

    drag("Key one", "Done");
    await act(async () => {});
    expect(setStatusCalls).toEqual([]);
    expect(screen.getByRole("textbox", { name: "Note for the agent" })).toBeTruthy();
  });
});

describe("the Board on a phone", () => {
  it("shows one column at a time, with counts on the switcher", async () => {
    narrow = true;
    await openBoard([task({ title: "Open one" }), task({ title: "Other one" }), task({ title: "Started one", status: "in_progress" })]);

    expect(screen.getByRole("radio", { name: "To do 2" }).getAttribute("aria-checked")).toBe("true");
    expect(screen.getByRole("radio", { name: "In progress 1" })).toBeTruthy();
    expect(screen.getByRole("radio", { name: "Done 0" })).toBeTruthy();
    expect(screen.getAllByRole("region").map((region) => region.getAttribute("aria-label"))).toEqual(["To do"]);

    fireEvent.click(screen.getByRole("radio", { name: "In progress 1" }));
    expect(screen.getAllByRole("region").map((region) => region.getAttribute("aria-label"))).toEqual(["In progress"]);
    expect(titlesIn("In progress")).toEqual(["Started one"]);
  });

  it("moves a card with its status buttons, through the same check-off", async () => {
    narrow = true;
    const todos = [task({ title: "Open one" }), task({ title: "Reply one", replyPrompt: "What's the code?" })];
    const { setStatusCalls } = await openBoard(todos);
    const card = (title: string) => within(screen.getByText(title).closest("li")!);

    expect(card("Open one").getByRole("button", { name: "Move to In progress" })).toBeTruthy();
    expect(screen.getByText("Open one").closest("li")!.getAttribute("draggable")).toBeNull();

    fireEvent.click(card("Reply one").getByRole("button", { name: "Done" }));
    expect(await screen.findByRole("textbox", { name: "What's the code?" })).toBeTruthy();

    fireEvent.click(card("Open one").getByRole("button", { name: "Done" }));
    await waitFor(() => expect(setStatusCalls).toEqual([{ id: todos[0]!.id, status: "done" }]));
  });

  it("offers each card only the moves the List allows", async () => {
    narrow = true;
    const todos = [
      task({ title: "Open one" }),
      task({ title: "Agent's one", status: "in_progress", handedBack: true }),
      task({ title: "Agent finished one", status: "done", handedBack: true, doneByAgent: true }),
    ];
    const { setStatusCalls } = await openBoard(todos);
    const moves = (title: string) =>
      within(screen.getByText(title).closest("li")!)
        .queryAllByRole("button", { name: /^(Done|Move to|Reopen)/ })
        .map((button) => button.textContent);

    expect(moves("Open one")).toEqual(["Move to In progress", "Done"]);
    fireEvent.click(screen.getByRole("radio", { name: /^In progress/ }));
    expect(moves("Agent's one")).toEqual(["Done"]);
    fireEvent.click(screen.getByRole("radio", { name: /^Done/ }));
    expect(moves("Agent finished one")).toEqual(["Reopen"]);

    fireEvent.click(within(screen.getByText("Agent finished one").closest("li")!).getByRole("button", { name: "Reopen" }));
    await waitFor(() => expect(setStatusCalls).toEqual([{ id: todos[2]!.id, status: "open" }]));
  });

  it("sends one call for a double tap, and holds other moves until it lands", async () => {
    narrow = true;
    const todos = [task({ title: "Tap one" })];
    const { setStatusCalls, release } = await openBoard(todos, { holdStatusCalls: true });
    const card = within(screen.getByText("Tap one").closest("li")!);
    fireEvent.click(card.getByRole("button", { name: "Done" }));
    fireEvent.click(card.getByRole("button", { name: "Done" }));
    fireEvent.click(card.getByRole("button", { name: "Move to In progress" }));
    await act(async () => {});
    expect(setStatusCalls).toEqual([{ id: todos[0]!.id, status: "done" }]);
    expect(card.getByRole("button", { name: "Move to In progress" })).toHaveProperty("disabled", true);
    await release();
    expect(card.getByRole("button", { name: "Move to In progress" })).toHaveProperty("disabled", false);
  });
});

describe("cards on a phone", () => {
  const blocker = () =>
    task({
      title: "Blocker one",
      blocking: true,
      dueAt: Date.now() + 2 * 86_400_000,
      instructions: "Open the console and add the record.",
      agentNeeds: "A DNS API token",
      project: { id: "proj_1", name: "Acme Web" },
    });

  it("fold to the title and one key chip, and unfold to the steps, the why and the hand-off", async () => {
    narrow = true;
    await renderPage([blocker(), task({ title: "Due one", dueAt: Date.now() - 2 * 86_400_000 })]);
    const card = (title: string) => within(screen.getByText(title).closest("li")!);

    expect(card("Blocker one").getByText("Blocking")).toBeTruthy();
    expect(card("Blocker one").queryByText(/^Due/)).toBeNull();
    expect(card("Blocker one").queryByText("Acme Web")).toBeNull();
    expect(card("Blocker one").queryByText("Open the console and add the record.")).toBeNull();
    expect(card("Blocker one").queryByRole("button", { name: "Let the agent do it" })).toBeNull();
    expect(card("Due one").getByText("Overdue")).toBeTruthy();

    fireEvent.click(card("Blocker one").getByRole("button", { name: /Blocker one/ }));
    expect(card("Blocker one").getByText("Open the console and add the record.")).toBeTruthy();
    expect(card("Blocker one").getByText("A DNS API token")).toBeTruthy();
    expect(card("Blocker one").getByText("Acme Web")).toBeTruthy();
    expect(card("Blocker one").getByText("Due in 2d")).toBeTruthy();
    expect(card("Blocker one").getByRole("button", { name: "Let the agent do it" })).toBeTruthy();
  });

  it("keep the agent's chip on a card it is doing", async () => {
    narrow = true;
    await renderPage([task({ title: "Agent's one", status: "in_progress", handedBack: true, blocking: true })]);
    const card = within(screen.getByText("Agent's one").closest("li")!);
    expect(card.getByText("Agent is on it")).toBeTruthy();
    expect(card.queryByText("Blocking")).toBeNull();
  });

  it("snooze, dismiss and hand back from the overflow menu", async () => {
    narrow = true;
    const todos = [blocker()];
    const { setStatusCalls, otherCalls } = await renderPage(todos);
    const pick = async (item: string | RegExp) => {
      fireEvent.click(screen.getByRole("button", { name: "More actions" }));
      fireEvent.click(await within(await screen.findByRole("dialog")).findByRole("menuitem", { name: item }));
      await act(async () => {});
    };

    await pick("Snooze until tomorrow, 9:00");
    const tomorrowAtNine = new Date();
    tomorrowAtNine.setDate(tomorrowAtNine.getDate() + 1);
    tomorrowAtNine.setHours(9, 0, 0, 0);
    await pick("Let the agent do it");
    await pick(/^Dismiss/);

    await waitFor(() =>
      expect(otherCalls).toEqual([
        { method: "todos_snooze", input: { id: todos[0]!.id, until: tomorrowAtNine.getTime() } },
        { method: "todos_hand_back", input: { id: todos[0]!.id } },
      ]),
    );
    await waitFor(() => expect(setStatusCalls).toEqual([{ id: todos[0]!.id, status: "dismissed" }]));
  });

  it("stay folded and grouped when snoozed", async () => {
    narrow = true;
    await renderPage([task({ title: "Awake one" }), task({ title: "Snoozed one", snoozedUntil: Date.now() + 3_600_000 })]);
    expect(screen.queryByText("Snoozed one")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Snoozed/ }));
    expect(screen.getByText("Snoozed one")).toBeTruthy();
    expect(screen.queryByText("Steps for Snoozed one.")).toBeNull();
  });
});

describe("filters", () => {
  const todos = () => [
    task({ title: "Web one", project: { id: "proj_web", name: "Web" } }),
    task({ title: "Ops one", project: { id: "proj_ops", name: "Ops" } }),
  ];

  it("sit inline on a desktop", async () => {
    await renderPage(todos());
    expect(screen.getByRole("combobox", { name: "Filter by project" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^Filter/ })).toBeNull();
  });

  it("sit behind one Filter button on a phone, in a sheet", async () => {
    narrow = true;
    await renderPage(todos());
    expect(screen.queryByRole("combobox", { name: "Filter by project" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Filter" }));
    const sheet = await screen.findByRole("dialog", { name: "Filters" });
    fireEvent.change(await within(sheet).findByRole("combobox", { name: "Filter by project" }), { target: { value: "proj_ops" } });
    expect(screen.queryByText("Web one")).toBeNull();
    expect(screen.getByText("Ops one")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Filter, 1 on" })).toBeTruthy();

    fireEvent.click(within(sheet).getByRole("button", { name: "Clear filters" }));
    expect(screen.getByText("Web one")).toBeTruthy();
  });
});
