// Every task mutation goes through here: one place for errors, toasts, and the
// read-only example mode.
import { useCallback, useState } from "react";
import { useRpc } from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import type { rpcContract, Todo, TodoStatus } from "../server";
import { usePreview } from "./preview";

function message(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function finishToast(task: Todo, verb: string) {
  if (task.notifyResult === "notified") toast.success(`${verb}. ${task.notifyDetail ?? "The agent was told"}.`);
  else if (task.notifyResult === "failed") toast.error(task.notifyDetail ?? "Could not tell the agent.");
  else if (task.notifyResult === "skipped" && task.notifyDetail) toast.success(`${verb}. ${task.notifyDetail}, so no one was told.`);
  else toast.success(`${verb}.`);
}

export function useTaskActions(id: string) {
  const rpc = useRpc<typeof rpcContract>();
  const preview = usePreview();
  const [busy, setBusy] = useState(false);

  const run = useCallback(
    async <T,>(work: () => Promise<T>): Promise<T | null> => {
      if (preview) {
        toast("This is an example. Nothing is saved.");
        return null;
      }
      setBusy(true);
      try {
        return await work();
      } catch (cause) {
        toast.error(message(cause));
        return null;
      } finally {
        setBusy(false);
      }
    },
    [preview],
  );

  return {
    busy,
    setStatus: (status: TodoStatus, note?: string) =>
      run(async () => {
        const task = await rpc.call("todos_set_status", { id, status, ...(note ? { note } : {}) });
        if (status === "done") finishToast(task, "Done");
        if (status === "dismissed") finishToast(task, "Dismissed");
        return task;
      }),
    snooze: (until: number | null) =>
      run(async () => {
        const task = await rpc.call("todos_snooze", { id, until });
        toast.success(until === null ? "Back on your list." : "Snoozed. It comes back with a reminder.");
        return task;
      }),
    ask: (question: string) =>
      run(async () => {
        const task = await rpc.call("todos_ask", { id, question });
        toast.success("Sent to the agent. Its answer arrives in the thread.");
        return task;
      }),
    handBack: (note: string) =>
      run(async () => {
        const task = await rpc.call("todos_hand_back", { id, ...(note.trim() ? { note: note.trim() } : {}) });
        toast.success("Handed to the agent. It tells you in the thread what access it needs.");
        return task;
      }),
    takeBack: () =>
      run(async () => {
        const task = await rpc.call("todos_take_back", { id });
        toast.success("It's yours again. The agent was told to stop.");
        return task;
      }),
    remove: () => run(() => rpc.call("todos_remove", { id })),
  };
}
