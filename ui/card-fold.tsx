// What a folded task shows: its title, one key chip and a short meta line.
// Unfolding shows the steps, the why and the hand-off options. Snooze, dismiss
// and hand back stay in the overflow menu, which a phone shows as a sheet.
import type { TodoView } from "../server";
import { DropdownMenuItem, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger } from "@/components/ui/dropdown-menu";
import { useIsCompactViewport } from "@/components/ui/hooks/use-compact-viewport";
import { Icon } from "@/components/ui/icon";
import { HEX_COLOR, dueInfo, isFinished, snoozePresets, timeAgo } from "@/lib/tasks";
import { cn } from "@/lib/utils";
import { Badge } from "./bits";

/** True on a phone-sized viewport, where targets grow to 44px and actions wait for a tap. */
export const useCompactCards = useIsCompactViewport;

/**
 * The one chip a folded card keeps. Unfinished: the agent doing it, then
 * blocking, then reopened by the agent, then the due date. Finished: who
 * finished it, or that it was dismissed.
 */
export function KeyChip({ task }: { task: TodoView }) {
  if (isFinished(task)) {
    if (task.status === "dismissed") return <Badge>Dismissed</Badge>;
    if (task.doneByAgent) {
      return (
        <Badge tone="success" icon="human-tasks/bot" title={task.handoffSummary ?? "The agent did this one"}>
          Done by agent
        </Badge>
      );
    }
    return null;
  }
  if (task.handedBack) {
    return (
      <Badge tone="accent" icon="human-tasks/bot" title={task.handbackNote ?? "You asked the agent to do it this time"}>
        Agent is on it
      </Badge>
    );
  }
  if (task.blocking) {
    return (
      <Badge tone="danger" title="The agent's work is stopped until you do this">
        Blocking
      </Badge>
    );
  }
  if (task.agentNote) {
    return (
      <Badge tone="danger" icon="human-tasks/alert" title={task.agentNote}>
        Reopened by agent
      </Badge>
    );
  }
  if (task.dueAt === null) return null;
  const due = dueInfo(task.dueAt);
  return (
    <Badge tone={due.urgent ? "danger" : "neutral"} icon="human-tasks/calendar">
      {due.label}
    </Badge>
  );
}

/** "6m", "3h", "2d": the age a row shows, from creation or from when it was finished. */
export function shortAge(task: TodoView): string {
  const at = isFinished(task) && task.completedAt ? task.completedAt : task.createdAt;
  return timeAgo(at).replace(/ ago$/, "");
}

/** Where a task came from, quietly: the bot's color, the project, and its age. */
export function RowMeta({ task, aligned, className }: { task: TodoView; /** Keep the dot's slot without a bot, so project names line up down the List. */ aligned?: boolean; className?: string }) {
  return (
    <span className={cn("flex min-w-0 items-center gap-1.5 text-xs text-subtle-foreground", className)}>
      {task.bot || aligned ? (
        <span
          aria-hidden="true"
          title={task.bot?.name}
          className={cn("size-2 shrink-0 rounded-full", task.bot ? "bg-muted-foreground" : "invisible")}
          style={task.bot?.color && HEX_COLOR.test(task.bot.color) ? { backgroundColor: task.bot.color } : undefined}
        />
      ) : null}
      {task.project ? <span className="min-w-0 truncate">{task.project.name}</span> : null}
      <span className="ml-auto shrink-0 pl-1.5 tabular-nums">{shortAge(task)}</span>
    </span>
  );
}

/**
 * The snooze choices. A phone's menu is a sheet with no room for a submenu,
 * so there they are listed flat.
 */
export function SnoozeItems({ onSnooze }: { onSnooze: (until: number) => void }) {
  const compact = useIsCompactViewport();
  if (compact) {
    return snoozePresets().map((preset) => (
      <DropdownMenuItem key={preset.label} onSelect={() => onSnooze(preset.until)}>
        <Icon name="human-tasks/snooze" className="size-4" />
        Snooze {preset.label.charAt(0).toLowerCase() + preset.label.slice(1)}
      </DropdownMenuItem>
    ));
  }
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger>
        <Icon name="human-tasks/snooze" className="size-4" />
        Snooze
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent>
        {snoozePresets().map((preset) => (
          <DropdownMenuItem key={preset.label} onSelect={() => onSnooze(preset.until)}>
            {preset.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}
