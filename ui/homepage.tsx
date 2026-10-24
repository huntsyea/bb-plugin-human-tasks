// A short "waiting on you" list on the new-thread screen.
import { useBbNavigate } from "@get-bb/plugin-sdk/app";
import { Icon } from "@/components/ui/icon";
import { isFinished, isSnoozed } from "@/lib/tasks";
import { KindIcon, Relations } from "./bits";
import { useTasks } from "./use-tasks";

const SHOWN = 4;

export function HomepageSection({ projectId }: { projectId: string | null }) {
  const { tasks } = useTasks({ openOnly: true });
  const navigate = useBbNavigate();
  if (tasks === null) return null;
  const open = tasks.filter((task) => !isFinished(task) && !isSnoozed(task) && !task.handedBack);
  // bb always shows this section's title, so say so plainly when it is empty.
  if (open.length === 0) {
    return (
      <p className="flex items-center gap-2 px-1 text-sm text-muted-foreground">
        <Icon name="Check" className="size-4" />
        Nothing is waiting on you.
      </p>
    );
  }
  // Tasks for the project in view first, blocking ones before the rest.
  const ranked = [...open].sort(
    (a, b) =>
      Number(b.project?.id === projectId) - Number(a.project?.id === projectId) || Number(b.blocking) - Number(a.blocking),
  );
  return (
    <div className="space-y-1">
      <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
        {ranked.slice(0, SHOWN).map((task) => (
          <li key={task.id}>
            <button
              type="button"
              onClick={() => navigate.toPluginPanel("tasks", { subPath: task.id })}
              className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-state-hover"
            >
              <KindIcon kind={task.kind} blocking={task.blocking} size="sm" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm">{task.title}</span>
                <Relations task={task} />
              </span>
              {task.blocking ? <span className="shrink-0 text-xs font-medium text-destructive">Blocking</span> : null}
            </button>
          </li>
        ))}
      </ul>
      {open.length > SHOWN ? (
        <button
          type="button"
          onClick={() => navigate.toPluginPanel("tasks")}
          className="flex items-center gap-1 px-1 text-xs text-muted-foreground hover:text-foreground"
        >
          {open.length - SHOWN} more
          <Icon name="ChevronRight" className="size-3" />
        </button>
      ) : null}
    </div>
  );
}
