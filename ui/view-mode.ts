// Which view the Human tasks page shows, remembered per device in local
// storage, so a phone and a desktop can differ. Nothing goes to the server.
import { useCallback, useState } from "react";

export type ViewMode = "list" | "board";

const KEY = "bb-plugin-human-tasks:view";

function read(): ViewMode {
  try {
    return window.localStorage.getItem(KEY) === "board" ? "board" : "list";
  } catch {
    return "list"; // storage blocked: fall back to the List
  }
}

export function useViewMode(): [ViewMode, (mode: ViewMode) => void] {
  const [mode, setMode] = useState(read);
  const choose = useCallback((next: ViewMode) => {
    setMode(next);
    try {
      window.localStorage.setItem(KEY, next);
    } catch {
      // storage blocked: the choice lasts until the page closes
    }
  }, []);
  return [mode, choose];
}
