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

async function renderPage(todos: TodoView[]) {
  const app = await loadPluginApp(() => import("../app"));
  const panel = app.navPanels.find((entry) => entry.path === "tasks")!;
  const setStatusCalls: { id: string; status: TodoStatus; note?: string }[] = [];
  // The page only lists and sets status here; any other call fails the test.
  const rpc: Pick<PluginRpcTestHandlers<typeof rpcContract>, "todos_list" | "todos_set_status"> = {
    todos_list: () => ({
      todos,
      stats: { open: todos.filter((t) => t.status === "open" || t.status === "in_progress").length, blocking: 0, done: 0, doneByAgents: 0 },
      bots: [],
    }),
    todos_set_status: (input) => {
      setStatusCalls.push(input);
      const found = todos.find((t) => t.id === input.id)!;
      return { ...found, status: input.status } as Todo;
    },
  };
  const view = renderSlot<{ subPath: string }, typeof rpcContract>(panel, { subPath: "" }, { rpc: rpc as PluginRpcTestHandlers<typeof rpcContract> });
  await screen.findByText(todos[0]!.title);
  return { view, setStatusCalls };
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

async function openBoard(todos: TodoView[]) {
  window.localStorage.setItem("bb-plugin-human-tasks:view", "board");
  return renderPage(todos);
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
  it("dragging to Done calls the same server action as checking it off in the List", async () => {
    const todos = [task({ title: "Check one", blocking: true, waitingInThread: true })];
    const list = await renderPage(todos);
    fireEvent.click(screen.getByRole("checkbox", { name: 'Mark "Check one" done' }));
    await waitFor(() => expect(list.setStatusCalls).toEqual([{ id: todos[0]!.id, status: "done" }]));
    cleanup();

    const board = await openBoard(todos);
    drag("Check one", "Done");
    await waitFor(() => expect(board.setStatusCalls).toEqual(list.setStatusCalls));
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

  it("keep snooze, dismiss and hand back in the overflow menu", async () => {
    narrow = true;
    await renderPage([blocker()]);
    fireEvent.click(screen.getByRole("button", { name: "More actions" }));
    const menu = await screen.findByRole("dialog");
    expect(await within(menu).findByRole("menuitem", { name: "Snooze until tomorrow, 9:00" })).toBeTruthy();
    expect(within(menu).getByRole("menuitem", { name: /Dismiss/ })).toBeTruthy();
    expect(within(menu).getByRole("menuitem", { name: "Let the agent do it" })).toBeTruthy();
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
