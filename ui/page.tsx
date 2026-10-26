// The Human tasks page: what is waiting on you, as a List grouped by urgency or
// a Board by status, with filters by project, bot, and kind. `/tasks/example`
// renders made-up tasks.
import { useState } from "react";
import type { ReactNode } from "react";
import { useBbNavigate } from "@get-bb/plugin-sdk/app";
import type { TaskKind, TodoView } from "../server";
import { KINDS } from "@/lib/model";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { KIND_META, isFinished, isSnoozed } from "@/lib/tasks";
import { cn } from "@/lib/utils";
import { EmptyState } from "./bits";
import { Board } from "./board";
import { ActiveFilters, FilterMenu } from "./filter-sheet";
import type { FilterGroup } from "./filter-sheet";
import { PreviewContext, previewData } from "./preview";
import { TaskCard } from "./task-card";
import { useTasks } from "./use-tasks";
import { Segmented } from "./segmented";
import { useViewMode } from "./view-mode";

const ALL = "__all__";
const NONE = "__none__";
export const EXAMPLE_PATH = "example";

type Tab = "todo" | "finished";

function Group({
  title,
  hint,
  tasks,
  focusId,
  collapsible,
  danger,
}: {
  title: string;
  hint?: string;
  tasks: TodoView[];
  focusId: string | null;
  collapsible?: boolean;
  /** Marks the heading of work that is stopping an agent. */
  danger?: boolean;
}) {
  const [open, setOpen] = useState(!collapsible || tasks.some((task) => task.id === focusId));
  if (tasks.length === 0) return null;
  return (
    <section className="space-y-2">
      <h2 className="flex min-w-0 items-center gap-2 px-1 text-sm font-medium text-foreground">
        {danger ? <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-destructive" /> : null}
        {collapsible ? (
          <button type="button" className="-ml-1 flex items-center gap-1 rounded-md px-1 hover:bg-state-hover max-md:min-h-11" onClick={() => setOpen((value) => !value)} aria-expanded={open}>
            <Icon name="ChevronRight" className={cn("size-3.5 text-subtle-foreground transition-transform", open && "rotate-90")} />
            {title}
          </button>
        ) : (
          title
        )}
        <span className="font-normal tabular-nums text-subtle-foreground">{tasks.length}</span>
        {hint ? <span className="hidden truncate text-xs font-normal text-subtle-foreground sm:inline">{hint}</span> : null}
      </h2>
      {open ? (
        <ul className="divide-y divide-border-hairline rounded-lg border border-border bg-card">
          {tasks.map((task) => (
            <TaskCard key={task.id} task={task} focused={task.id === focusId} />
          ))}
        </ul>
      ) : null}
    </section>
  );
}

function Onboarding() {
  const navigate = useBbNavigate();
  const examples: { kind: TaskKind; text: string }[] = [
    { kind: "access", text: "Create an API key or invite the bot to a repo" },
    { kind: "setup", text: "Add a DNS record or verify a domain" },
    { kind: "review", text: "Test a build on your phone and report back" },
    { kind: "payment", text: "Renew a domain or approve a purchase" },
  ];
  return (
    <EmptyState icon="human-tasks/hand" title="Nothing is waiting on you">
      <p>When an agent needs something only you can do, it lands here with steps. Check it off and the agent picks up where it stopped.</p>
      <ul className="mt-4 grid gap-2 text-left sm:grid-cols-2">
        {examples.map((example) => (
          <li key={example.kind} className="flex items-center gap-2 rounded-lg bg-muted/50 px-2.5 py-2 text-xs">
            <Icon name={KIND_META[example.kind].icon} className="size-3.5 shrink-0" />
            {example.text}
          </li>
        ))}
      </ul>
      <Button size="sm" variant="outline" className="mt-4" onClick={() => navigate.toPluginPanel("tasks", { subPath: EXAMPLE_PATH })}>
        See an example
      </Button>
    </EmptyState>
  );
}

function TasksView({
  tasks,
  stats,
  bots,
  error,
  focusId,
  preview,
}: ReturnType<typeof useTasks> & { focusId: string | null; preview: boolean }) {
  const navigate = useBbNavigate();
  const [tab, setTab] = useState<Tab>("todo");
  const [view, setView] = useViewMode();
  const [project, setProject] = useState(ALL);
  const [bot, setBot] = useState(ALL);
  const [kind, setKind] = useState(ALL);

  const all = tasks ?? [];
  const count = (match: (task: TodoView) => boolean) => all.filter((task) => !isFinished(task) && match(task)).length;
  const projectItems = [...new Map(all.flatMap((task) => (task.project ? [[task.project.id, task.project.name] as const] : []))).entries()]
    .map(([id, name]) => ({ id, name, count: count((task) => task.project?.id === id) }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const botItems = bots.map((entry) => ({ id: entry.id, name: entry.name, count: count((task) => task.bot?.id === entry.id) })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  const kindItems = KINDS.map((id) => ({ id, name: KIND_META[id].label, count: count((task) => task.kind === id) }));
  const filterGroups: FilterGroup[] = [
    { label: "Project", value: project, all: ALL, onChange: setProject, items: projectItems },
    ...(botItems.length > 0
      ? [{ label: "Bot", value: bot, all: ALL, onChange: setBot, items: [...botItems, { id: NONE, name: "No bot", count: count((task) => task.bot === null) }] }]
      : []),
    { label: "Kind", value: kind, all: ALL, onChange: setKind, items: kindItems },
  ];

  const filtered = all.filter(
    (task) =>
      (project === ALL || (task.project?.id ?? NONE) === project) &&
      (bot === ALL || (task.bot?.id ?? NONE) === bot) &&
      (kind === ALL || task.kind === kind),
  );
  const open = filtered.filter((task) => !isFinished(task));
  const active = open.filter((task) => !isSnoozed(task));
  const finished = filtered.filter(isFinished);
  const filtersActive = project !== ALL || bot !== ALL || kind !== ALL;

  // A deep link to a finished task opens the Finished tab.
  const focusTask = focusId ? all.find((task) => task.id === focusId) : undefined;
  const effectiveTab: Tab = focusTask && isFinished(focusTask) && tab === "todo" ? "finished" : tab;

  let body: ReactNode;
  if (tasks === null) {
    body = <div className="h-40 animate-pulse rounded-lg bg-muted/40" aria-label="Loading" />;
  } else if (all.length === 0) {
    body = <Onboarding />;
  } else if (view === "board") {
    body = <Board tasks={filtered} focusId={focusId} />;
  } else if (effectiveTab === "todo") {
    body =
      open.length === 0 ? (
        <EmptyState icon="Check" title={filtersActive ? "Nothing matches these filters" : "All caught up"}>
          {filtersActive ? "Clear a filter to see more." : "New tasks from agents will show up here."}
        </EmptyState>
      ) : (
        <div className="space-y-6">
          <Group title="Blocking an agent" hint="its work is stopped until you do these" tasks={active.filter((task) => task.blocking && !task.handedBack)} focusId={focusId} danger />
          <Group title="Waiting on you" tasks={active.filter((task) => !task.blocking && !task.handedBack)} focusId={focusId} />
          <Group title="The agent is on it" hint="you let the agent do these" tasks={active.filter((task) => task.handedBack)} focusId={focusId} />
          <Group title="Snoozed" hint="they come back with a reminder" tasks={open.filter(isSnoozed)} focusId={focusId} collapsible />
        </div>
      );
  } else {
    body = finished.length === 0 ? <EmptyState icon="human-tasks/inbox" title="Nothing finished yet" /> : <Group title="Finished" tasks={finished} focusId={focusId} />;
  }

  return (
    <PreviewContext.Provider value={preview}>
      <div className="h-full min-h-0 flex-1 overflow-y-auto">
        <div className={cn("mx-auto box-border w-full max-w-4xl space-y-4 p-4 md:px-6 md:py-5", view === "board" && "md:max-w-6xl")}>
          {preview ? (
            <div className="flex items-center gap-2 rounded-md bg-surface-recessed px-3 py-1.5 text-xs text-muted-foreground max-md:py-0">
              <Icon name="human-tasks/eye" className="size-3.5 shrink-0" />
              <span className="min-w-0 flex-1">This is an example with made-up tasks. Nothing here is saved.</span>
              <button type="button" className="shrink-0 font-medium text-foreground underline-offset-2 hover:underline max-md:min-h-11" onClick={() => navigate.toPluginPanel("tasks")}>
                Back to your tasks
              </button>
            </div>
          ) : null}

          {all.length > 0 ? (
            <div className="flex items-center gap-2">
              {view === "list" ? (
                <Segmented
                  label="Show"
                  value={effectiveTab}
                  onChange={(value) => {
                    setTab(value);
                    if (focusId && !preview) navigate.toPluginPanel("tasks", { replace: true });
                  }}
                  options={[
                    { value: "todo", label: "To do", count: stats?.open ? stats.open : undefined },
                    { value: "finished", label: "Finished" },
                  ]}
                />
              ) : null}
              <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden">
                <ActiveFilters groups={filterGroups} />
              </div>
              <FilterMenu
                groups={filterGroups}
                onClear={() => {
                  setProject(ALL);
                  setBot(ALL);
                  setKind(ALL);
                }}
              />
              <Segmented
                look="toggle"
                label="View"
                value={view}
                onChange={setView}
                options={[
                  { value: "list", label: "List", icon: "human-tasks/list" },
                  { value: "board", label: "Board", icon: "human-tasks/board" },
                ]}
              />
            </div>
          ) : null}

          {error === null ? null : (
            <p role="alert" className="text-sm text-destructive-text">
              {error}
            </p>
          )}

          {body}
        </div>
      </div>
    </PreviewContext.Provider>
  );
}

export function TasksPage({ subPath }: { subPath: string }) {
  const live = useTasks();
  const segment = subPath.split("/")[0] || null;
  if (segment === EXAMPLE_PATH) {
    const example = previewData();
    return <TasksView tasks={example.todos} stats={example.stats} bots={example.bots} error={null} focusId={null} preview />;
  }
  return <TasksView {...live} focusId={segment} preview={false} />;
}
