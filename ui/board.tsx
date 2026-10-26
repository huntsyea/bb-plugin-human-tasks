// The Board view: To do, In progress and Done columns. Side by side on a
// desktop, where cards can be dragged between columns; one column at a time on
// a phone, where an unfolded card moves through its status buttons instead.
// Every move goes through the card's own check-off path (see board-card.tsx).
import { useState } from "react";
import type { ReactNode } from "react";
import type { TodoView } from "../server";
import { Icon } from "@/components/ui/icon";
import { isSnoozed } from "@/lib/tasks";
import { cn } from "@/lib/utils";
import { useIsCompactViewport } from "@/components/ui/hooks/use-compact-viewport";
import { BOARD_COLUMN_TITLE, BoardCardsProvider, useColumnDrop } from "./board-card";
import type { BoardStatus } from "./board-card";
import { Segmented } from "./segmented";
import { TaskCard } from "./task-card";

const COLUMNS: readonly BoardStatus[] = ["open", "in_progress", "done"];
const COLUMN_ICON: Record<BoardStatus, { icon: string; className: string }> = {
  open: { icon: "human-tasks/circle", className: "text-subtle-foreground" },
  in_progress: { icon: "human-tasks/circle-half", className: "text-warning" },
  done: { icon: "human-tasks/check-circle", className: "text-success" },
};

function columnOf(task: TodoView): BoardStatus {
  return task.status === "dismissed" ? "done" : task.status;
}

function Cards({ tasks, focusId }: { tasks: TodoView[]; focusId: string | null }) {
  if (tasks.length === 0) return null;
  return (
    <ul className="flex flex-col gap-1.5">
      {tasks.map((task) => (
        <TaskCard key={task.id} task={task} focused={task.id === focusId} />
      ))}
    </ul>
  );
}

/** Snoozed cards stay folded at the foot of their column, as in the List. */
function Snoozed({ tasks, focusId }: { tasks: TodoView[]; focusId: string | null }) {
  const [open, setOpen] = useState(tasks.some((task) => task.id === focusId));
  if (tasks.length === 0) return null;
  return (
    <div className="flex flex-col gap-1.5">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="flex items-center gap-1 self-start rounded-md px-1.5 py-1 text-xs text-muted-foreground hover:bg-state-hover hover:text-foreground max-md:min-h-11"
      >
        <Icon name="ChevronRight" className={cn("size-3.5 transition-transform", open && "rotate-90")} />
        Snoozed <span className="tabular-nums text-subtle-foreground">{tasks.length}</span>
      </button>
      {open ? <Cards tasks={tasks} focusId={focusId} /> : null}
    </div>
  );
}

function Column({
  status,
  title,
  count,
  compact,
  children,
  footer,
}: {
  status: BoardStatus;
  title: string;
  count: number;
  /** On a phone the switcher above names the column, so it drops its own header and tint. */
  compact: boolean;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const drop = useColumnDrop(status);
  return (
    <section
      aria-label={title}
      {...drop.props}
      className={cn(
        "flex min-w-0 flex-col gap-1.5 transition-colors",
        !compact && "min-h-32 rounded-lg bg-surface-recessed p-1.5",
        drop.active && "bg-state-hover ring-1 ring-inset ring-ring",
      )}
    >
      {compact ? null : (
        <h2 className="flex items-center gap-2 px-1.5 pb-1 pt-1 text-sm font-medium text-foreground">
          <Icon name={COLUMN_ICON[status].icon} className={cn("size-3.5 shrink-0", COLUMN_ICON[status].className)} />
          {title} <span className="font-normal tabular-nums text-subtle-foreground">{count}</span>
        </h2>
      )}
      {count === 0 ? <p className="px-1.5 py-6 text-center text-xs text-subtle-foreground">Nothing in {title}</p> : null}
      {children}
      {footer}
    </section>
  );
}

export function Board({ tasks, focusId }: { tasks: TodoView[]; focusId: string | null }) {
  const compact = useIsCompactViewport();
  const focusTask = focusId ? tasks.find((task) => task.id === focusId) : undefined;
  const [showDismissed, setShowDismissed] = useState(focusTask?.status === "dismissed");
  // A phone shows one column; a deep link opens the one holding its task.
  const [shown, setShown] = useState<BoardStatus>(focusTask ? columnOf(focusTask) : "open");
  const inColumn = (status: BoardStatus) =>
    tasks.filter((task) => task.status === status || (status === "done" && showDismissed && task.status === "dismissed"));

  return (
    <BoardCardsProvider compact={compact}>
      {compact ? (
        <Segmented
          label="Column"
          value={shown}
          onChange={setShown}
          className="mb-3 flex w-full"
          options={COLUMNS.map((status) => ({ value: status, label: BOARD_COLUMN_TITLE[status], count: inColumn(status).length }))}
        />
      ) : null}
      <div className="grid gap-2 md:grid-cols-3 md:items-start">
        {(compact ? [shown] : COLUMNS).map((status) => {
          const members = inColumn(status);
          const awake = members.filter((task) => status === "done" || !isSnoozed(task));
          const snoozed = members.filter((task) => status !== "done" && isSnoozed(task));
          return (
            <Column
              key={status}
              status={status}
              compact={compact}
              title={BOARD_COLUMN_TITLE[status]}
              count={members.length}
              footer={
                status === "done" ? (
                  <DismissedSwitch on={showDismissed} onChange={setShowDismissed} count={tasks.filter((task) => task.status === "dismissed").length} />
                ) : null
              }
            >
              <Cards tasks={awake} focusId={focusId} />
              <Snoozed tasks={snoozed} focusId={focusId} />
            </Column>
          );
        })}
      </div>
    </BoardCardsProvider>
  );
}

function DismissedSwitch({ on, onChange, count }: { on: boolean; onChange: (on: boolean) => void; count: number }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label="Show dismissed"
      onClick={() => onChange(!on)}
      className="flex items-center gap-2 self-start rounded-md px-1.5 py-1 text-xs text-muted-foreground hover:bg-state-hover hover:text-foreground max-md:min-h-11"
    >
      <span className={cn("relative h-3.5 w-6 rounded-full transition-colors", on ? "bg-foreground" : "bg-input")}>
        <span className={cn("absolute top-0.5 size-2.5 rounded-full bg-background transition-transform", on ? "translate-x-3" : "translate-x-0.5")} />
      </span>
      Show dismissed
      {count > 0 ? <span className="tabular-nums text-subtle-foreground">{count}</span> : null}
    </button>
  );
}
