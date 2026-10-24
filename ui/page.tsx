// The Human tasks page: what is waiting on you, grouped by urgency, with
// filters by project, bot, and kind. `/tasks/example` renders made-up tasks.
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
import { PreviewContext, previewData } from "./preview";
import { TaskCard } from "./task-card";
import { useTasks } from "./use-tasks";

const ALL = "__all__";
const NONE = "__none__";
export const EXAMPLE_PATH = "example";

type Tab = "todo" | "finished";

function FilterSelect({
  label,
  allLabel,
  value,
  onChange,
  items,
  noneLabel,
}: {
  label: string;
  allLabel: string;
  value: string;
  onChange: (value: string) => void;
  items: { id: string; name: string; count: number }[];
  noneLabel?: string;
}) {
  return (
    <select
      aria-label={label}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className={cn(
        "h-8 max-w-[11rem] cursor-pointer rounded-md border bg-transparent px-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
        value === ALL ? "border-border text-muted-foreground" : "border-foreground/30 text-foreground",
      )}
    >
      <option value={ALL}>{allLabel}</option>
      {items.map((item) => (
        <option key={item.id} value={item.id}>
          {item.name}
          {item.count > 0 ? ` (${item.count})` : ""}
        </option>
      ))}
      {noneLabel ? <option value={NONE}>{noneLabel}</option> : null}
    </select>
  );
}

function Stat({ value, label, tone, icon }: { value: number; label: string; tone?: "danger" | "accent"; icon: string }) {
  return (
    <div className="flex min-w-0 items-center gap-2.5 rounded-xl border border-border bg-card px-3 py-2.5">
      <span
        className={cn(
          "hidden size-8 shrink-0 items-center justify-center rounded-lg sm:flex",
          tone === "danger" && value > 0 ? "bg-destructive/10 text-destructive" : tone === "accent" ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground",
        )}
      >
        <Icon name={icon} className="size-4" />
      </span>
      <span className="min-w-0">
        <span className="block text-lg font-semibold leading-5 tabular-nums">{value}</span>
        <span className="block text-xs leading-4 text-muted-foreground sm:truncate">{label}</span>
      </span>
    </div>
  );
}

function Group({
  title,
  hint,
  tasks,
  focusId,
  collapsible,
}: {
  title: string;
  hint?: string;
  tasks: TodoView[];
  focusId: string | null;
  collapsible?: boolean;
}) {
  const [open, setOpen] = useState(!collapsible || tasks.some((task) => task.id === focusId));
  if (tasks.length === 0) return null;
  return (
    <section className="space-y-2">
      <h2 className="flex items-baseline gap-2 px-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {collapsible ? (
          <button type="button" className="flex items-center gap-1 uppercase hover:text-foreground" onClick={() => setOpen((value) => !value)} aria-expanded={open}>
            <Icon name="ChevronRight" className={cn("size-3 transition-transform", open && "rotate-90")} />
            {title}
          </button>
        ) : (
          title
        )}
        <span className="tabular-nums">{tasks.length}</span>
        {hint ? <span className="hidden font-normal normal-case tracking-normal sm:inline">· {hint}</span> : null}
      </h2>
      {open ? (
        <ul className="space-y-2">
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
    body = <div className="h-40 animate-pulse rounded-xl bg-muted/40" aria-label="Loading" />;
  } else if (all.length === 0) {
    body = <Onboarding />;
  } else if (effectiveTab === "todo") {
    body =
      open.length === 0 ? (
        <EmptyState icon="Check" title={filtersActive ? "Nothing matches these filters" : "All caught up"}>
          {filtersActive ? "Clear a filter to see more." : "New tasks from agents will show up here."}
        </EmptyState>
      ) : (
        <div className="space-y-6">
          <Group title="Blocking an agent" hint="its work is stopped until you do these" tasks={active.filter((task) => task.blocking && !task.handedBack)} focusId={focusId} />
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
        <div className="mx-auto box-border w-full max-w-3xl space-y-5 p-4 md:p-6">
          {preview ? (
            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-dashed border-border px-3 py-2 text-xs text-muted-foreground">
              <Icon name="human-tasks/eye" className="size-3.5" />
              <span className="flex-1">This is an example with made-up tasks. Nothing here is saved.</span>
              <button type="button" className="font-medium text-foreground underline underline-offset-2" onClick={() => navigate.toPluginPanel("tasks")}>
                Back to your tasks
              </button>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              Steps only you can do, handed over by your agents. Check one off and the agent that asked picks up where it stopped.
            </p>
          )}

          {stats && all.length > 0 ? (
            <div className="grid grid-cols-3 gap-2">
              <Stat value={stats.open} label="Waiting on you" icon="human-tasks/hand" />
              <Stat value={stats.blocking} label="Blocking an agent" tone="danger" icon="human-tasks/alert" />
              <Stat value={stats.doneByAgents} label="Done by agents" tone="accent" icon="human-tasks/bot" />
            </div>
          ) : null}

          {all.length > 0 ? (
            <div className="flex flex-wrap items-center gap-2">
              <div role="tablist" className="inline-flex rounded-lg bg-muted p-0.5">
                {(
                  [
                    ["todo", "To do", stats?.open ?? 0],
                    ["finished", "Finished", null],
                  ] as const
                ).map(([value, label, total]) => (
                  <button
                    key={value}
                    type="button"
                    role="tab"
                    aria-selected={effectiveTab === value}
                    onClick={() => {
                      setTab(value);
                      if (focusId && !preview) navigate.toPluginPanel("tasks", { replace: true });
                    }}
                    className={cn(
                      "rounded-md px-3 py-1 text-sm transition-colors",
                      effectiveTab === value ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {label}
                    {total ? <span className="ml-1.5 tabular-nums text-muted-foreground">{total}</span> : null}
                  </button>
                ))}
              </div>
              <span className="flex-1" />
              <FilterSelect label="Filter by project" allLabel="All projects" value={project} onChange={setProject} items={projectItems} />
              {botItems.length > 0 ? (
                <FilterSelect label="Filter by bot" allLabel="All bots" value={bot} onChange={setBot} items={botItems} noneLabel="No bot" />
              ) : null}
              <FilterSelect label="Filter by kind" allLabel="All kinds" value={kind} onChange={setKind} items={kindItems} />
            </div>
          ) : null}

          {error === null ? null : (
            <p role="alert" className="text-sm text-destructive">
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
