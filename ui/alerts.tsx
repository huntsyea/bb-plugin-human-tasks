// App-wide alerts: a count badge on the navigation icon, plus a toast (or a
// system notification while bb is in the background) when a task arrives.
import { useCallback, useEffect, useSyncExternalStore } from "react";
import type { CSSProperties } from "react";
import { useBbNavigate, useRealtime, useRpc, useSettings } from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import type { rpcContract, TaskCreatedSignal, TaskEventSignal, TodosChangedSignal } from "../server";
import { useDebounced } from "./use-tasks";

let counts = { open: 0, blocking: 0 };
const listeners = new Set<() => void>();
function publish(next: typeof counts) {
  if (next.open === counts.open && next.blocking === counts.blocking) return;
  counts = next;
  for (const listener of listeners) listener();
}
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
const snapshot = () => counts;

const HAND_PATHS = [
  "M18 11V6a2 2 0 0 0-2-2a2 2 0 0 0-2 2",
  "M14 10V4a2 2 0 0 0-2-2a2 2 0 0 0-2 2v2",
  "M10 10.5V6a2 2 0 0 0-2-2a2 2 0 0 0-2 2v8",
  "M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15",
];

// Registered icons render outside the plugin's CSS scope, so styles are inline.
const BADGE: CSSProperties = {
  position: "absolute",
  top: -5,
  right: -7,
  boxSizing: "border-box",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  minWidth: 15,
  height: 15,
  padding: "0 4px 1px",
  borderRadius: 8,
  fontSize: 9,
  fontWeight: 600,
  lineHeight: 1,
};

/** The navigation icon: a raised hand with the number of open tasks. */
export function NavIcon({ className }: { className?: string }) {
  const { open, blocking } = useSyncExternalStore(subscribe, snapshot, snapshot);
  const label = open === 0 ? "No human tasks" : `${open} human ${open === 1 ? "task" : "tasks"}${blocking ? `, ${blocking} blocking` : ""}`;
  return (
    <span className={className} style={{ position: "relative", display: "inline-flex" }} title={label}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" style={{ width: "100%", height: "100%" }} aria-hidden="true">
        {HAND_PATHS.map((d) => (
          <path key={d} d={d} />
        ))}
      </svg>
      {open > 0 ? (
        <span
          style={{
            ...BADGE,
            background: blocking > 0 ? "var(--destructive)" : "var(--foreground)",
            color: blocking > 0 ? "var(--destructive-foreground, white)" : "var(--background)",
          }}
        >
          {open > 99 ? "99+" : open}
        </span>
      ) : null}
    </span>
  );
}

/** Mounted once per window: feeds the badge and announces new tasks. */
export function AlertsController() {
  const rpc = useRpc<typeof rpcContract>();
  const navigate = useBbNavigate();
  const { values } = useSettings();
  const systemNotifications = values?.systemNotifications !== false;

  const refresh = useCallback(() => {
    rpc.call("todos_summary").then(
      (summary) => publish({ open: summary.open, blocking: summary.blocking }),
      () => undefined,
    );
  }, [rpc]);
  useEffect(() => {
    refresh();
    return () => publish({ open: 0, blocking: 0 });
  }, [refresh]);
  // The change signal carries the counts; fetch only when it doesn't (older servers).
  const refreshLater = useDebounced(refresh);
  useRealtime("todos-changed", (payload: unknown) => {
    const signal = payload as Partial<TodosChangedSignal> | null;
    if (typeof signal?.open === "number" && typeof signal.blocking === "number") publish({ open: signal.open, blocking: signal.blocking });
    else refreshLater();
  });

  useRealtime("task-created", (payload: unknown) => {
    const task = payload as TaskCreatedSignal;
    if (typeof task?.id !== "string") return;
    const open = () => navigate.toPluginPanel("tasks", { subPath: task.id });
    const heading = task.blocking ? "An agent is blocked on you" : "New task for you";
    const description = task.from ? `${task.title} · from ${task.from}` : task.title;
    const NotificationApi = typeof window === "undefined" ? undefined : window.Notification;
    if (document.hidden && systemNotifications && NotificationApi?.permission === "granted") {
      const notification = new NotificationApi(heading, { body: description, tag: `human-task-${task.id}` });
      notification.onclick = () => {
        window.focus();
        open();
        notification.close();
      };
      return;
    }
    toast(heading, { description, duration: task.blocking ? 15_000 : 8_000, action: { label: "Open", onClick: open } });
  });

  useRealtime("task-event", (payload: unknown) => {
    const event = payload as TaskEventSignal;
    if (typeof event?.id !== "string") return;
    const open = () => navigate.toPluginPanel("tasks", { subPath: event.id });
    const copy: Record<TaskEventSignal["event"], string> = {
      due: "A snoozed task is back",
      reopened: "An agent sent a task back to you",
      answered: "The agent answered your question",
      completed_by_agent: "The agent finished a task you handed back",
      handback_cancelled: "You deleted the hand-off message, so the task is yours again",
    };
    const description = event.detail ? `${event.title} · ${event.detail}` : event.title;
    toast(copy[event.event], { description, duration: 10_000, action: { label: "Open", onClick: open } });
  });

  return null;
}
