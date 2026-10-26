// How a card behaves on the Board. The card hands over its own `moveTo`, which
// is its check-off path: Done runs exactly what ticking the checkbox runs (the
// reply prompt and credential checks, then todos_set_status, which closes any
// in-thread form and resumes the agent). A drop on a column and the phone's
// status buttons both call it, so neither has a way around that path.
import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { DragEvent, LiHTMLAttributes, ReactNode } from "react";
import type { TodoStatus, TodoView } from "../server";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";

/** The Board's columns, by the status a card has in each. */
export type BoardStatus = Extract<TodoStatus, "open" | "in_progress" | "done">;
export type MoveTo = (status: BoardStatus) => void;

export const BOARD_COLUMN_TITLE: Record<BoardStatus, string> = { open: "To do", in_progress: "In progress", done: "Done" };

/**
 * Where a card may go from its column: only the changes the List already offers.
 * A finished card reopens to To do, as Reopen does (that is also the only move
 * that clears a hand-back). A card the agent is doing can only be checked off.
 */
export function movesFor(task: Pick<TodoView, "status" | "handedBack">): BoardStatus[] {
  if (task.status === "done" || task.status === "dismissed") return ["open"];
  if (task.handedBack) return ["done"];
  return task.status === "open" ? ["in_progress", "done"] : ["open", "done"];
}

interface BoardCards {
  /** Phone: cards show status buttons. Desktop: cards drag. */
  compact: boolean;
  register: (id: string, move: MoveTo) => () => void;
  /** Run a card's own move, as if the user used that card's controls. */
  move: (id: string, status: BoardStatus) => void;
  dragging: TodoView | null;
  setDragging: (task: TodoView | null) => void;
}

const BoardCardsContext = createContext<BoardCards | null>(null);

/** Wraps the Board so its cards can be moved; outside it, cards behave as in the List. */
export function BoardCardsProvider({ compact, children }: { compact: boolean; children: ReactNode }) {
  const moves = useRef(new Map<string, MoveTo>());
  const [dragging, setDragging] = useState<TodoView | null>(null);
  const value = useMemo<BoardCards>(
    () => ({
      compact,
      register: (id, move) => {
        moves.current.set(id, move);
        return () => {
          if (moves.current.get(id) === move) moves.current.delete(id);
        };
      },
      move: (id, status) => moves.current.get(id)?.(status),
      dragging,
      setDragging,
    }),
    [compact, dragging],
  );
  return <BoardCardsContext.Provider value={value}>{children}</BoardCardsContext.Provider>;
}

/** Drop-target props for a column; `active` while a card that may land here is over the board. */
export function useColumnDrop(status: BoardStatus): { active: boolean; props: Pick<LiHTMLAttributes<HTMLElement>, "onDragOver" | "onDrop"> } {
  const board = useContext(BoardCardsContext);
  const dragging = board?.dragging ?? null;
  const accepts = dragging !== null && movesFor(dragging).includes(status);
  return {
    active: accepts,
    props: {
      onDragOver: (event: DragEvent) => {
        if (!accepts) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
      },
      onDrop: (event: DragEvent) => {
        if (!accepts || dragging === null) return;
        event.preventDefault();
        board?.setDragging(null);
        board?.move(dragging.id, status);
      },
    },
  };
}

/** What a card adds on the Board: drag props on desktop, status buttons on a phone. */
export function useBoardCard(
  task: TodoView,
  { expanded, busy, moveTo }: { expanded: boolean; busy: boolean; moveTo: MoveTo },
): { itemProps: Omit<LiHTMLAttributes<HTMLLIElement>, "className">; className?: string; footer: ReactNode } {
  const board = useContext(BoardCardsContext);
  // While the card's last change is on its way, moves wait, as the checkbox does.
  const guarded: MoveTo = (status) => {
    if (!busy) moveTo(status);
  };
  const latest = useRef(guarded);
  latest.current = guarded;
  useEffect(() => board?.register(task.id, (status) => latest.current(status)), [board, task.id]);
  if (board === null) return { itemProps: {}, footer: null };
  if (board.compact) return { itemProps: {}, footer: <MoveButtons task={task} busy={busy} moveTo={guarded} /> };
  // Expanded cards hold text to select and a note to type, so only folded ones drag.
  if (expanded) return { itemProps: {}, footer: null };
  return {
    itemProps: {
      draggable: true,
      onDragStart: (event) => {
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", task.title);
        board.setDragging(task);
      },
      onDragEnd: () => board.setDragging(null),
    },
    className: cn("cursor-grab active:cursor-grabbing", board.dragging?.id === task.id && "opacity-50"),
    footer: null,
  };
}

function MoveButtons({ task, busy, moveTo }: { task: TodoView; busy: boolean; moveTo: MoveTo }) {
  return (
    <div className="flex flex-wrap gap-2 border-t border-border px-3 py-2">
      {movesFor(task).map((status) => (
        <Button key={status} size="sm" variant="outline" className="max-md:h-11 flex-1" disabled={busy} onClick={() => moveTo(status)}>
          <Icon
            name={status === "done" ? "Check" : status === "in_progress" && task.status === "open" ? "human-tasks/arrow-right" : "human-tasks/rotate"}
            className="size-4"
          />
          {status === "done" ? "Done" : task.status === "done" || task.status === "dismissed" ? "Reopen" : `Move to ${BOARD_COLUMN_TITLE[status]}`}
        </Button>
      ))}
    </div>
  );
}
