// Above a thread's composer: the tasks this thread is waiting on.
import { useCallback, useEffect, useState } from "react";
import { useBbNavigate, useComposer, useRealtime, useRpc } from "@get-bb/plugin-sdk/app";
import type { rpcContract, Todo, TodosChangedSignal } from "../server";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";
import { useDebounced } from "./use-tasks";

export function ThreadBanner() {
  const composer = useComposer();
  const threadId = composer.scope.kind === "thread" ? composer.scope.threadId : null;
  const rpc = useRpc<typeof rpcContract>();
  const navigate = useBbNavigate();
  const [tasks, setTasks] = useState<(Todo & { waitingInThread: boolean })[]>([]);
  const refresh = useCallback(() => {
    if (threadId === null) return;
    rpc.call("todos_for_thread", { threadId }).then((result) => setTasks(result.todos), () => setTasks([]));
  }, [rpc, threadId]);
  useEffect(() => {
    refresh();
  }, [refresh]);
  // Skip changes that name other threads; refetch when the signal names this one or doesn't say.
  const refreshLater = useDebounced(refresh);
  useRealtime("todos-changed", (payload: unknown) => {
    const threadIds = (payload as Partial<TodosChangedSignal> | null)?.threadIds;
    if (threadId !== null && Array.isArray(threadIds) && !threadIds.includes(threadId)) return;
    refreshLater();
  });

  if (threadId === null || tasks.length === 0) return null;
  const first = tasks[0]!;
  const blocking = tasks.some((task) => task.blocking);
  return (
    <div
      className={cn(
        "mb-2 flex items-center gap-2 rounded-lg border px-3 py-2 text-sm",
        blocking ? "border-destructive/30 bg-destructive/5" : "border-border bg-muted/40",
      )}
    >
      <Icon name="human-tasks/hand" className={cn("size-4 shrink-0", blocking ? "text-destructive" : "text-muted-foreground")} />
      <span className="min-w-0 flex-1 truncate">
        <span className="text-muted-foreground">Waiting on you: </span>
        {first.title}
        {tasks.length > 1 ? <span className="text-muted-foreground"> and {tasks.length - 1} more</span> : null}
      </span>
      <button
        type="button"
        onClick={() => navigate.toPluginPanel("tasks", { subPath: first.id })}
        className="shrink-0 rounded px-2 py-0.5 text-xs font-medium hover:bg-state-hover"
      >
        Open
      </button>
    </div>
  );
}
