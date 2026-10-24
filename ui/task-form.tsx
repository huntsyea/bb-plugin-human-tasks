// The in-thread form for a blocking task. It replaces the composer while the
// agent waits, so the thread shows as waiting on the user.
import { useEffect, useState } from "react";
import type { PluginPendingInteractionProps } from "@get-bb/plugin-sdk/app";
import { Markdown, useBbNavigate, useRpc } from "@get-bb/plugin-sdk/app";
import type { rpcContract, TodoView } from "../server";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { KIND_META } from "@/lib/tasks";
import { KindIcon } from "./bits";
import { NoteField, useNoteState } from "./note-field";

export function TaskForm({ interaction, submit, cancel }: PluginPendingInteractionProps) {
  const rpc = useRpc<typeof rpcContract>();
  const navigate = useBbNavigate();
  const taskId =
    typeof interaction.payload === "object" && interaction.payload !== null && "taskId" in interaction.payload
      ? String((interaction.payload as { taskId: unknown }).taskId)
      : null;
  const [task, setTask] = useState<TodoView | null>(null);
  const [busy, setBusy] = useState(false);
  const noteState = useNoteState();

  useEffect(() => {
    if (taskId === null) return;
    rpc.call("todos_get", { id: taskId }).then(setTask, () => setTask(null));
  }, [rpc, taskId]);

  const send = async (action: "done" | "dismiss" | "hand_back") => {
    if (busy || !noteState.canSend) return;
    setBusy(true);
    const note = noteState.note.trim();
    try {
      await submit({ action, ...(note !== "" ? { note } : {}) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3 p-3">
      <div className="flex items-start gap-3">
        {task ? <KindIcon kind={task.kind} blocking /> : null}
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium uppercase tracking-wide text-destructive">Waiting on you{task ? ` · ${KIND_META[task.kind].label}` : ""}</p>
          <p className="text-sm font-medium">{interaction.title}</p>
        </div>
        {taskId ? (
          <button
            type="button"
            onClick={() => navigate.toPluginPanel("tasks", { subPath: taskId })}
            className="shrink-0 rounded px-2 py-0.5 text-xs text-muted-foreground hover:bg-state-hover hover:text-foreground"
          >
            Open in Human tasks
          </button>
        ) : null}
      </div>
      {task ? (
        <>
          <div className="max-h-56 overflow-y-auto rounded-lg border border-border bg-muted/30 px-3 py-2 text-sm">
            <Markdown content={task.instructions} />
          </div>
          <NoteField task={task} state={noteState} />
          {task.agentNeeds ? (
            <p className="text-xs text-muted-foreground">
              <span className="font-medium text-foreground">To do this itself, the agent needs:</span> {task.agentNeeds}
            </p>
          ) : null}
        </>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" disabled={busy || !noteState.canSend} onClick={() => void send("done")}>
          <Icon name="Check" className="size-4" />
          Mark done
        </Button>
        <Button size="sm" variant="outline" disabled={busy} onClick={() => void cancel()}>
          Later
        </Button>
        <Button size="sm" variant="outline" disabled={busy || !noteState.canSend} onClick={() => void send("hand_back")}>
          <Icon name="human-tasks/hand-back" className="size-4" />
          Let the agent do it
        </Button>
        <span className="flex-1" />
        <Button size="sm" variant="ghost" className="text-muted-foreground" disabled={busy || !noteState.canSend} onClick={() => void send("dismiss")}>
          I won't do this
        </Button>
      </div>
    </div>
  );
}
