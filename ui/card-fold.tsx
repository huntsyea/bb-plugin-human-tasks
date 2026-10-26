// What a task card shows on a phone. Folded, it is the title and one key chip;
// unfolding shows the steps, the why and the hand-off options. Snooze, dismiss
// and hand back stay in the overflow menu, which a phone shows as a sheet.
import type { TodoView } from "../server";
import { DropdownMenuItem, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger } from "@/components/ui/dropdown-menu";
import { useIsCompactViewport } from "@/components/ui/hooks/use-compact-viewport";
import { Icon } from "@/components/ui/icon";
import { dueInfo, isFinished, snoozePresets } from "@/lib/tasks";
import { Badge } from "./bits";

/** True on a phone-sized viewport, where cards fold and targets grow to 44px. */
export const useCompactCards = useIsCompactViewport;

/** The one chip a folded card keeps: blocking first, then the due date. */
export function KeyChip({ task }: { task: TodoView }) {
  if (isFinished(task)) return null;
  if (task.blocking) {
    return (
      <Badge tone="danger" title="The agent's work is stopped until you do this">
        Blocking
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
