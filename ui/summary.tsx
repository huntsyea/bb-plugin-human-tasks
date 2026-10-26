// The three counts at the top of the page: Blocked, Waiting and Done. Each is a
// button that jumps to its group in the List or its column on the Board; Done
// also switches the List to Finished. The page and the Board mark their jump
// targets with `data-jump` and focus them, so a keyboard lands there too.
import { useEffect, useRef } from "react";
import type { RefObject } from "react";
import { cn } from "@/lib/utils";

export type JumpTarget = "blocked" | "waiting" | "done";
/** A jump request; `n` changes on every tap, so tapping the same card twice jumps twice. */
export type Jump = { target: JumpTarget; n: number };

const CARDS: readonly { target: JumpTarget; label: string }[] = [
  { target: "blocked", label: "Blocked" },
  { target: "waiting", label: "Waiting" },
  { target: "done", label: "Done" },
];

export function SummaryCards({ counts, onJump }: { counts: Record<JumpTarget, number>; onJump: (target: JumpTarget) => void }) {
  return (
    <nav aria-label="Jump to" className="grid grid-cols-3 gap-2">
      {CARDS.map(({ target, label }) => (
        <button
          key={target}
          type="button"
          onClick={() => onJump(target)}
          className="flex h-11 min-w-0 items-baseline gap-2 rounded-lg border border-border bg-card px-3 pt-3 text-left transition-colors hover:bg-state-hover focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring md:h-10 md:pt-2.5"
        >
          <span className={cn("text-base font-semibold leading-none tabular-nums", target === "blocked" && counts.blocked > 0 && "text-destructive-text")}>
            {counts[target]}
          </span>
          <span className="truncate text-xs text-muted-foreground">{label}</span>
        </button>
      ))}
    </nav>
  );
}

/**
 * Scrolls to and focuses the `[data-jump~=target]` element inside `root` once
 * it is rendered. `ready` is anything that changes when the target may have
 * appeared (a tab or a phone column switching), so the jump waits for it.
 */
export function useJumpFocus(root: RefObject<HTMLElement | null>, jump: Jump | null, key: (target: JumpTarget) => string, ready: unknown) {
  const pending = useRef<{ jump: Jump; at: number } | null>(null);
  useEffect(() => {
    pending.current = jump && { jump, at: Date.now() };
  }, [jump]);
  useEffect(() => {
    const wanted = pending.current;
    if (wanted === null) return;
    // A target that never shows (an empty group) must not fire later, out of the blue.
    if (Date.now() - wanted.at > 1000) return void (pending.current = null);
    const element = root.current?.querySelector<HTMLElement>(`[data-jump~="${key(wanted.jump.target)}"]`);
    if (!element) return;
    pending.current = null;
    element.scrollIntoView?.({ block: "start", behavior: "smooth" });
    element.focus({ preventScroll: true });
  }, [root, jump, key, ready]);
}
