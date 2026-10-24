import { useCallback, useEffect, useRef, useState } from "react";
import { useRealtime, useRpc } from "@get-bb/plugin-sdk/app";
import type { BotInfo, rpcContract, TaskStats, TodoView } from "../server";

/** Every task with its relations, kept current by the server's change signal. */
/** Coalesce bursts of change signals into one refetch. */
export function useDebounced(fn: () => void, ms = 250): () => void {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef(fn);
  latest.current = fn;
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);
  return useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => latest.current(), ms);
  }, [ms]);
}

/** Every task with its relations. `openOnly` skips finished ones for small surfaces. */
export function useTasks(options: { openOnly?: boolean } = {}) {
  const openOnly = options.openOnly === true;
  const rpc = useRpc<typeof rpcContract>();
  const [tasks, setTasks] = useState<TodoView[] | null>(null);
  const [stats, setStats] = useState<TaskStats | null>(null);
  const [bots, setBots] = useState<BotInfo[]>([]);
  const [error, setError] = useState<string | null>(null);
  const latestRequest = useRef(0);
  const refetch = useCallback(() => {
    const request = ++latestRequest.current;
    rpc.call("todos_list", openOnly ? { openOnly } : null).then(
      (result) => {
        if (request !== latestRequest.current) return; // a newer response is on its way
        setTasks(result.todos);
        setStats(result.stats);
        setBots(result.bots);
        setError(null);
      },
      (cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)),
    );
  }, [rpc, openOnly]);
  useEffect(() => {
    refetch();
  }, [refetch]);
  useRealtime("todos-changed", useDebounced(refetch));
  return { tasks, stats, bots, error };
}
