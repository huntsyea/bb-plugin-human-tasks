// How a card behaves on the Board. The card hands over its own `moveTo`, which
// is its check-off path: Done runs exactly what ticking the checkbox runs (the
// reply prompt and credential checks, then todos_set_status, which closes any
// in-thread form and resumes the agent). A drop on a column and the unfolded
// card's status buttons both call it, so neither has a way around that path.
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

/** What a card adds on the Board: drag props on desktop, and its guarded moves for the unfolded card's status buttons. */
export function useBoardCard(
  task: TodoView,
  { expanded, busy, moveTo }: { expanded: boolean; busy: boolean; moveTo: MoveTo },
): { onBoard: boolean; itemProps: Omit<LiHTMLAttributes<HTMLLIElement>, "className">; className?: string; move: MoveTo } {
  const board = useContext(BoardCardsContext);
  // While the card's last change is on its way, moves wait, as the checkbox does.
  const guarded: MoveTo = (status) => {
    if (!busy) moveTo(status);
  };
  const latest = useRef(guarded);
  latest.current = guarded;
  useEffect(() => board?.register(task.id, (status) => latest.current(status)), [board, task.id]);
  if (board === null) return { onBoard: false, itemProps: {}, move: guarded };
  // Phones move cards from the unfolded card. Expanded cards hold text to select and a note to type, so only folded ones drag.
  if (board.compact || expanded) return { onBoard: true, itemProps: {}, move: guarded };
  return {
    onBoard: true,
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
    move: guarded,
  };
}

/** The unfolded card's Mark done on the Board: the check-off path, through the card's guarded move. */
export function MarkDoneMove({ busy, canSend, move }: { busy: boolean; canSend: boolean; move: MoveTo }) {
  return (
    <Button size="sm" disabled={busy || !canSend} onClick={() => move("done")}>
      <Icon name="Check" className="size-4" />
      Mark done
    </Button>
  );
}

/** The unfolded card's other move on the Board: the one change the List would also allow. */
export function OtherMoves({ task, busy, move }: { task: TodoView; busy: boolean; move: MoveTo }) {
  const finished = task.status === "done" || task.status === "dismissed";
  return movesFor(task)
    .filter((status) => status !== "done")
    .map((status) => (
      <Button key={status} size="sm" variant={finished ? "outline" : "ghost"} disabled={busy} onClick={() => move(status)}>
        <Icon name={finished ? "human-tasks/rotate" : "human-tasks/arrow-right"} className="size-4" />
        {finished ? (
          "Reopen"
        ) : (
          <span>
            <span className="sr-only">Move to </span>
            {BOARD_COLUMN_TITLE[status]}
          </span>
        )}
      </Button>
    ));
}
