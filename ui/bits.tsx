// Small presentational pieces shared by the page, the home section, and the
// in-thread form.
import type { ReactNode } from "react";
import { useBbNavigate } from "@get-bb/plugin-sdk/app";
import type { TaskKind, TodoView } from "../server";
import { Icon } from "@/components/ui/icon";
import { HANDOFF_METHOD_LABEL, HEX_COLOR, KIND_META, dueInfo, formatWhen, isFinished, isSnoozed, timeAgo } from "@/lib/tasks";
import { cn } from "@/lib/utils";
import { usePreview } from "./preview";

export function KindIcon({ kind, blocking, finished, size = "md" }: { kind: TaskKind; blocking?: boolean; finished?: boolean; size?: "sm" | "md" }) {
  return (
    <span
      title={`${KIND_META[kind].label}: ${KIND_META[kind].description}`}
      className={cn(
        "flex shrink-0 items-center justify-center rounded-lg",
        size === "md" ? "size-8" : "size-6 rounded-md",
        finished
          ? "bg-muted/60 text-muted-foreground"
          : blocking
            ? "bg-destructive/10 text-destructive"
            : "bg-muted text-foreground/80",
      )}
    >
      <Icon name={KIND_META[kind].icon} className={size === "md" ? "size-4" : "size-3.5"} />
    </span>
  );
}

type Tone = "neutral" | "danger" | "accent" | "success";

export function Badge({ tone = "neutral", icon, title, children }: { tone?: Tone; icon?: string; title?: string; children: ReactNode }) {
  return (
    <span
      title={title}
      className={cn(
        "inline-flex h-5 shrink-0 items-center gap-1 whitespace-nowrap rounded-md border px-1.5 text-[11px] font-medium leading-none",
        tone === "danger" ? "border-destructive/30 text-destructive-text" : "border-border text-muted-foreground",
      )}
    >
      {icon ? (
        <Icon name={icon} className={cn("size-3", tone === "accent" && "text-foreground", tone === "success" && "text-success")} />
      ) : tone === "danger" ? (
        <span aria-hidden="true" className="size-1.5 rounded-full bg-destructive" />
      ) : null}
      {children}
    </span>
  );
}

/** Status, urgency, and hand-off markers for a task. */
export function TaskBadges({ task }: { task: TodoView }) {
  const finished = isFinished(task);
  const due = task.dueAt !== null && !finished ? dueInfo(task.dueAt) : null;
  const method = task.handoffMethod ? HANDOFF_METHOD_LABEL[task.handoffMethod] : null;
  return (
    <>
      {task.blocking && !finished ? (
        <Badge tone="danger" title="The agent's work is stopped until you do this">
          Blocking
        </Badge>
      ) : null}
      {task.waitingInThread ? (
        <Badge title="The requesting thread shows this task as a form and waits for you">
          <span className="size-1.5 animate-pulse rounded-full bg-destructive" />
          Waiting in thread
        </Badge>
      ) : null}
      {due ? (
        <Badge tone={due.urgent ? "danger" : "neutral"} icon="human-tasks/calendar">
          {due.label}
        </Badge>
      ) : null}
      {!finished && isSnoozed(task) ? (
        <Badge icon="human-tasks/snooze" title="Hidden until then">
          {formatWhen(task.snoozedUntil!)}
        </Badge>
      ) : null}
      {task.handedBack && !finished ? (
        <Badge tone="accent" icon="human-tasks/bot" title={task.handbackNote ?? "You asked the agent to do it this time"}>
          Agent is on it
        </Badge>
      ) : task.status === "in_progress" ? (
        <Badge tone="accent">In progress</Badge>
      ) : null}
      {task.agentNote && !finished ? (
        <Badge tone="danger" icon="human-tasks/alert" title={task.agentNote}>
          Reopened by agent
        </Badge>
      ) : null}
      {task.question && !finished ? (
        <Badge icon="human-tasks/question" title={task.question}>
          Asked the agent
        </Badge>
      ) : null}
      {task.status === "dismissed" ? <Badge>Dismissed</Badge> : null}
      {task.doneByAgent ? (
        <Badge tone="success" icon="human-tasks/bot" title={task.handoffSummary ?? "The agent did this one"}>
          {method ? `Done by agent · ${method}` : "Done by agent"}
        </Badge>
      ) : null}
      {task.recurrence.count > 0 && !finished ? (
        <Badge
          tone={task.recurrence.agentDidSimilar ? "success" : "neutral"}
          icon="human-tasks/repeat"
          title={
            task.recurrence.agentDidSimilar
              ? "An agent already did a similar task. Let it do this one too."
              : `You've had ${task.recurrence.count} similar ${task.recurrence.count === 1 ? "task" : "tasks"}. Worth giving an agent access.`
          }
        >
          {task.recurrence.agentDidSimilar ? "An agent can do this" : `Recurring ×${task.recurrence.count + 1}`}
        </Badge>
      ) : null}
    </>
  );
}

function Chip({ onClick, title, children }: { onClick?: () => void; title: string; children: ReactNode }) {
  const className = "inline-flex min-w-0 max-w-[15rem] items-center gap-1 rounded px-1 py-0.5";
  if (!onClick) return <span title={title} className={className}>{children}</span>;
  return (
    <button type="button" title={title} onClick={onClick} className={cn(className, "hover:bg-state-hover hover:text-foreground")}>
      {children}
    </button>
  );
}

/** Project, bot, and thread the task came from, each a link, plus its age. */
export function Relations({ task, showAge = true, children }: { task: TodoView; showAge?: boolean; children?: ReactNode }) {
  const navigate = useBbNavigate();
  const preview = usePreview();
  // Only a thread known to be live gets a link; finished tasks don't look their thread up.
  const live = task.thread !== null && task.thread.state === "live" && !preview;
  const botThreadId = task.bot?.mainThreadId ?? (live ? task.thread!.id : null);
  return (
    <div className="-ml-1 flex min-w-0 flex-wrap items-center gap-x-0.5 text-xs text-muted-foreground">
      {children}
      {task.project ? (
        <Chip title={`Project: ${task.project.name}`} onClick={preview ? undefined : () => navigate.toProject(task.project!.id)}>
          <Icon name="human-tasks/folder" className="size-3.5 shrink-0" />
          <span className="truncate">{task.project.name}</span>
        </Chip>
      ) : null}
      {task.bot ? (
        <Chip
          title={`Bot: ${task.bot.name}${task.bot.role ? ` (${task.bot.role})` : ""}${task.bot.via === "project" ? ", which owns this project" : ""}`}
          onClick={botThreadId && !preview ? () => navigate.toThread(botThreadId, { split: true }) : undefined}
        >
          <span
            aria-hidden="true"
            className="size-2.5 shrink-0 rounded-full bg-muted-foreground"
            style={task.bot.color && HEX_COLOR.test(task.bot.color) ? { backgroundColor: task.bot.color } : undefined}
          />
          <span className="truncate">{task.bot.name}</span>
        </Chip>
      ) : null}
      {task.thread && task.thread.state !== "deleted" ? (
        <Chip
          title={task.thread.state === "archived" ? "The archived thread that asked" : "The thread that asked"}
          onClick={live ? () => navigate.toThread(task.thread!.id, { split: true }) : undefined}
        >
          <Icon name="human-tasks/message" className="size-3.5 shrink-0" />
          <span className="truncate">{task.thread.title ?? "Agent thread"}</span>
          {task.thread.state === "archived" ? <span className="shrink-0 italic">(archived)</span> : null}
        </Chip>
      ) : task.thread ? (
        <Chip title="The thread that asked was deleted">
          <Icon name="human-tasks/message" className="size-3.5 shrink-0" />
          <span className="italic">Thread deleted</span>
        </Chip>
      ) : null}
      {showAge ? (
        <span className="px-1">
          {isFinished(task) && task.completedAt ? `${task.status === "done" ? "Done" : "Dismissed"} ${timeAgo(task.completedAt)}` : timeAgo(task.createdAt)}
        </span>
      ) : null}
    </div>
  );
}

export function EmptyState({ icon, title, children }: { icon: string; title: string; children?: ReactNode }) {
  return (
    <div role="status" className="flex flex-col items-center rounded-xl border border-dashed border-border px-6 py-10 text-center">
      <span className="flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <Icon name={icon} className="size-5" />
      </span>
      <p className="mt-3 text-sm font-medium">{title}</p>
      {children ? <div className="mt-1 max-w-md text-sm text-muted-foreground">{children}</div> : null}
    </div>
  );
}
