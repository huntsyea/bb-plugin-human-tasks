// One task on the Human tasks page: a one-line row in the List, a card on the
// Board. Folded, it shows the title, one key chip and where it came from;
// unfolding shows the instructions, the reply box, the agent's notes and the
// actions. The overflow menu waits for hover on a desktop and for the unfolded
// card on a phone.
import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Markdown, useBbNavigate } from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import type { TodoView } from "../server";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Icon } from "@/components/ui/icon";
import { KIND_META, firstLink, isFinished, isSnoozed, timeAgo } from "@/lib/tasks";
import { cn } from "@/lib/utils";
import { useTaskActions } from "./actions";
import { MarkDoneMove, OtherMoves, useBoardCard } from "./board-card";
import { KeyChip, RowMeta, SnoozeItems, useCompactCards } from "./card-fold";
import { Badge, Relations, TaskBadges } from "./bits";
import { NoteField, useNoteState } from "./note-field";
import { usePreview } from "./preview";

function Callout({ tone, icon, children }: { tone: "danger" | "accent" | "neutral"; icon: string; children: ReactNode }) {
  return (
    <div
      className={cn(
        "flex items-start gap-2 rounded-lg px-3 py-2 text-sm",
        tone === "danger" && "bg-destructive/10 text-destructive",
        tone === "accent" && "bg-primary/10 text-primary",
        tone === "neutral" && "bg-muted/60 text-muted-foreground",
      )}
    >
      <Icon name={icon} className="mt-0.5 size-4 shrink-0" />
      <div className="min-w-0">{children}</div>
    </div>
  );
}

export function TaskCard({ task, focused }: { task: TodoView; focused: boolean }) {
  const navigate = useBbNavigate();
  const preview = usePreview();
  const actions = useTaskActions(task.id);
  const [expanded, setExpanded] = useState(focused);
  const compact = useCompactCards();
  const folded = !expanded;
  const noteState = useNoteState();
  const finished = isFinished(task);
  const link = finished ? null : firstLink(task.instructions);
  const threadLive = task.thread?.state === "live";
  const orphaned = !finished && task.thread !== null && task.thread.state !== "live";
  const ref = useRef<HTMLLIElement>(null);
  const noteRef = useRef<HTMLTextAreaElement>(null);
  const note = noteState.note.trim();

  useEffect(() => {
    if (!focused) return;
    setExpanded(true);
    ref.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [focused]);

  const focusNote = () => {
    setExpanded(true);
    setTimeout(() => noteRef.current?.focus(), 50);
  };

  const finish = async (status: "done" | "dismissed") => {
    if (!noteState.canSend) {
      focusNote();
      toast.error("Your note looks like it holds a credential. Remove it, or confirm it's not a secret.");
      return;
    }
    if (await actions.setStatus(status, note || undefined)) noteState.setNote("");
  };

  const toggleDone = (checked: boolean) => {
    if (!checked) return void actions.setStatus("open");
    // The agent asked for something back: get the answer before closing it.
    if (task.replyPrompt && note === "") {
      focusNote();
      toast(`The agent asks: ${task.replyPrompt}`, { description: "Answer below, then mark it done." });
      return;
    }
    void finish("done");
  };

  // The Board moves a card only through this, so Done is always the checkbox's path.
  const board = useBoardCard(task, { expanded, busy: actions.busy, moveTo: (status) => (status === "done" ? toggleDone(true) : void actions.setStatus(status)) });

  const ask = async () => {
    if (note === "") return focusNote();
    if (await actions.ask(note)) noteState.setNote("");
  };

  /** Hand it to the agent and open its thread, where it asks for the access it needs. */
  const letAgentDoIt = async () => {
    if (!noteState.canSend) return focusNote();
    if (await actions.handBack(note)) {
      noteState.setNote("");
      if (task.thread && !preview) navigate.toThread(task.thread.id, { split: true });
    }
  };

  const copy = () => {
    void navigator.clipboard?.writeText(task.instructions).then(
      () => toast.success("Instructions copied."),
      () => toast.error("Couldn't copy."),
    );
  };

  const menu = (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          size="icon"
          variant="ghost"
          aria-label="More actions"
          className={cn(
            "size-7 shrink-0 text-muted-foreground max-md:size-11",
            // On a pointer that hovers, the trigger waits for the row; touch and keyboard always reach it.
            !compact && !expanded && "[@media(hover:hover)]:opacity-0 group-hover/task:opacity-100 group-focus-within/task:opacity-100 data-[state=open]:opacity-100",
          )}
        >
          <Icon name="human-tasks/more" className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-52 max-md:[&>[role=menuitem]]:min-h-11">
        {finished ? (
          <DropdownMenuItem onSelect={() => void actions.setStatus("open")}>
            <Icon name="human-tasks/rotate" className="size-4" />
            Reopen
          </DropdownMenuItem>
        ) : (
          <>
            <DropdownMenuItem onSelect={() => void actions.setStatus(task.status === "in_progress" ? "open" : "in_progress")}>
              <Icon name="human-tasks/check-circle" className="size-4" />
              {task.status === "in_progress" ? "Mark not started" : "Mark in progress"}
            </DropdownMenuItem>
            {isSnoozed(task) ? (
              <DropdownMenuItem onSelect={() => void actions.snooze(null)}>
                <Icon name="human-tasks/snooze" className="size-4" />
                Unsnooze
              </DropdownMenuItem>
            ) : (
              <SnoozeItems onSnooze={(until) => void actions.snooze(until)} />
            )}
            <DropdownMenuItem disabled={!threadLive} onSelect={focusNote}>
              <Icon name="human-tasks/question" className="size-4" />
              Ask the agent…
            </DropdownMenuItem>
            {task.handedBack ? (
              <DropdownMenuItem onSelect={() => void actions.takeBack()}>
                <Icon name="human-tasks/hand" className="size-4" />
                Take it back
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem disabled={!threadLive} onSelect={() => void letAgentDoIt()}>
                <Icon name="human-tasks/bot" className="size-4" />
                Let the agent do it
              </DropdownMenuItem>
            )}
          </>
        )}
        <DropdownMenuItem onSelect={copy}>
          <Icon name="human-tasks/copy" className="size-4" />
          Copy instructions
        </DropdownMenuItem>
        {task.thread && threadLive && !preview ? (
          <DropdownMenuItem onSelect={() => navigate.toThread(task.thread!.id, { split: true })}>
            <Icon name="human-tasks/message" className="size-4" />
            Open the thread that asked
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuSeparator />
        {finished ? (
          <DropdownMenuItem variant="destructive" onSelect={() => void actions.remove()}>
            <Icon name="Trash2" className="size-4" />
            Delete
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem onSelect={() => void finish("dismissed")}>
            <Icon name="human-tasks/x" className="size-4" />
            {task.blocking ? "Dismiss (tells the agent)" : "Dismiss"}
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );

  // Handing the task to the agent, or asking it something; for a card the agent is doing, its thread and taking it back.
  const handoffs = finished ? null : task.handedBack ? (
    <>
      {task.thread && threadLive && !preview ? (
        <Button size="sm" variant={board.onBoard ? "ghost" : "outline"} onClick={() => navigate.toThread(task.thread!.id, { split: true })}>
          <Icon name="human-tasks/message" className="size-4" />
          Open the thread
        </Button>
      ) : null}
      <Button size="sm" variant="ghost" disabled={actions.busy} onClick={() => void actions.takeBack()}>
        <Icon name="human-tasks/hand" className="size-4" />
        Take it back
      </Button>
    </>
  ) : (
    <>
      <Button size="sm" variant={board.onBoard ? "ghost" : "outline"} disabled={actions.busy || !threadLive || !noteState.canSend} onClick={() => void letAgentDoIt()}>
        <Icon name="human-tasks/bot" className="size-4" />
        Let the agent do it
      </Button>
      <Button size="sm" variant="ghost" disabled={actions.busy || !threadLive || !noteState.canSend} onClick={() => void ask()}>
        <Icon name="human-tasks/question" className="size-4" />
        {note ? "Ask the agent" : "Ask…"}
      </Button>
    </>
  );

  const title = (
    <span
      className={cn(
        "min-w-0 text-sm font-medium leading-5",
        board.onBoard || compact ? "line-clamp-2" : "truncate",
        finished && "text-muted-foreground",
      )}
    >
      {task.title}
    </span>
  );

  return (
    <li
      ref={ref}
      {...board.itemProps}
      className={cn(
        "group/task relative",
        board.onBoard
          ? cn("rounded-lg border bg-card shadow-xs transition-colors hover:border-input", expanded ? "border-input" : "border-border")
          : "first:rounded-t-[inherit] last:rounded-b-[inherit]",
        focused && (board.onBoard ? "ring-1 ring-ring" : "ring-1 ring-inset ring-ring"),
        board.className,
      )}
    >
      {board.onBoard ? (
        // A Board card: the title clamped to two lines over its key chip and where it came from.
        <div className="relative">
          <button type="button" className="block w-full px-3 py-2.5 text-left max-md:min-h-11" onClick={() => setExpanded((value) => !value)} aria-expanded={expanded}>
            <span className={cn("flex", !compact && "pr-6")}>{title}</span>
            {/* Opened, the meta line below names the project and the age, so the face doesn't repeat them. */}
            {folded ? (
              <span className="mt-2 flex items-center gap-2">
                <KeyChip task={task} />
                <RowMeta task={task} className="flex-1" />
              </span>
            ) : null}
          </button>
          {compact ? null : <span className="absolute right-1.5 top-1.5">{menu}</span>}
        </div>
      ) : (
        // A List row: one line of checkbox, title, key chip and where it came from.
        <div className="flex items-center gap-1 rounded-[inherit] pl-1 pr-1.5 transition-colors hover:bg-state-hover/60 md:gap-2.5 md:pl-3">
          {/* On a phone the label is the checkbox's 44px touch target. */}
          <label className={compact ? "flex size-11 shrink-0 cursor-pointer items-center justify-center" : "contents"}>
            <Checkbox
              className={compact ? "size-5" : undefined}
              checked={task.status === "done"}
              disabled={actions.busy || task.status === "dismissed"}
              onCheckedChange={(checked) => toggleDone(checked === true)}
              aria-label={task.status === "done" ? `Reopen "${task.title}"` : `Mark "${task.title}" done`}
            />
          </label>
          <button
            type="button"
            className="flex min-h-10 min-w-0 flex-1 items-center gap-3 py-2 text-left max-md:min-h-12"
            onClick={() => setExpanded((value) => !value)}
            aria-expanded={expanded}
          >
            {title}
            <span className="ml-auto flex shrink-0 items-center gap-3">
              {folded ? <KeyChip task={task} /> : null}
              {compact || !folded ? null : <RowMeta task={task} aligned className="w-40" />}
            </span>
          </button>
          {compact ? null : menu}
        </div>
      )}

      {expanded ? (
        <div className={cn("space-y-3", board.onBoard ? "border-t border-border-hairline p-3" : "px-3 pb-4 pt-1 md:pl-[2.375rem] md:pr-4")}>
          <div className="space-y-1.5">
            <div className="flex flex-wrap items-center gap-1.5">
              <Badge icon={KIND_META[task.kind].icon} title={KIND_META[task.kind].description}>
                {KIND_META[task.kind].label}
              </Badge>
              <TaskBadges task={task} />
            </div>
            <div className="max-md:[&_button]:min-h-11">
              <Relations task={task}>
                {link ? (
                  <button
                    type="button"
                    title={`Open ${link.url}`}
                    onClick={() => (preview ? toast("This is an example. Nothing is saved.") : navigate.openUrl(link.url))}
                    className="inline-flex max-w-[15rem] items-center gap-1 rounded px-1 py-0.5 font-medium text-foreground hover:bg-state-hover"
                  >
                    <Icon name="human-tasks/external" className="size-3.5 shrink-0" />
                    <span className="truncate">{link.host}</span>
                  </button>
                ) : null}
              </Relations>
            </div>
          </div>

          {task.agentNote && !finished ? (
            <Callout tone="danger" icon="human-tasks/alert">
              <span className="font-medium">The agent sent this back:</span> {task.agentNote}
            </Callout>
          ) : null}
          {task.handedBack && !finished ? (
            <Callout tone="accent" icon="human-tasks/bot">
              <span className="font-medium">The agent is doing this one.</span>{" "}
              {task.handbackNote ? `You said: “${task.handbackNote}”. ` : ""}It asks for any access it needs in the thread, then marks the task
              done or sends it back with a reason.
            </Callout>
          ) : null}
          {task.question && !finished ? (
            <Callout tone="neutral" icon="human-tasks/question">
              You asked {task.questionAt ? timeAgo(task.questionAt) : ""}: “{task.question}”. The answer arrives in the thread, and the instructions update if they were unclear.
            </Callout>
          ) : null}
          {orphaned ? (
            <Callout tone="neutral" icon="human-tasks/inbox">
              The thread that asked {task.thread!.state === "archived" ? "is archived" : "was deleted"}, so nobody is waiting on this.{" "}
              <button type="button" className="font-medium underline underline-offset-2" onClick={() => void finish("dismissed")}>
                Dismiss it
              </button>{" "}
              if it's no longer needed.
            </Callout>
          ) : null}

          <div className="text-sm">
            <Markdown content={task.instructions} />
          </div>

          {task.agentNeeds && !finished && !task.handedBack ? (
            <div className="flex items-start gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm">
              <Icon name="human-tasks/bot" className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0">
                <span className="font-medium">To do this itself, the agent needs: </span>
                <span className="text-muted-foreground">{task.agentNeeds}</span>
                {task.recurrence.agentDidSimilar ? (
                  <span className="mt-1 block text-xs text-primary">An agent already did a similar task, so it may have this access already.</span>
                ) : null}
              </div>
            </div>
          ) : null}

          {task.completionNote ? (
            <p className="rounded-lg bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
              <span className="font-medium text-foreground">{task.completionNote.startsWith("Done by the agent") ? "" : "Your note: "}</span>
              {task.completionNote}
            </p>
          ) : null}
          {task.status === "done" ? (
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Icon
                name={task.resumedAt ? "human-tasks/check-circle" : task.notifyResult === "failed" ? "human-tasks/alert" : task.notifyResult === "notified" ? "human-tasks/bell-ring" : "human-tasks/bell-off"}
                className={cn("size-3.5", task.resumedAt && "text-primary")}
              />
              {task.resumedAt
                ? `The agent picked it back up ${timeAgo(task.resumedAt)}`
                : task.notifyResult === "notified"
                  ? `${task.notifyDetail ?? "The agent was told"}; waiting for it to pick up`
                  : task.notifyDetail}
            </p>
          ) : null}

          {!finished && !task.handedBack ? <NoteField task={task} state={noteState} inputRef={noteRef} /> : null}

          {board.onBoard ? (
            // A Board card is narrow: its status buttons first, then the hand-offs on a quieter line.
            <div className="space-y-1.5">
              <div className="flex flex-wrap items-center gap-2 max-md:[&>button]:h-11">
                {finished ? null : <MarkDoneMove busy={actions.busy} canSend={noteState.canSend} move={board.move} />}
                <OtherMoves task={task} busy={actions.busy} move={board.move} />
              </div>
              {handoffs || compact ? (
                <div className="-ml-2 flex flex-wrap items-center gap-1 max-md:[&>button]:h-11">
                  {handoffs}
                  {compact ? <span className="ml-auto">{menu}</span> : null}
                </div>
              ) : null}
            </div>
          ) : !finished || compact ? (
            <div className="flex flex-wrap items-center gap-2 max-md:[&>button]:h-11">
              {finished || task.handedBack ? null : (
                <Button size="sm" disabled={actions.busy || !noteState.canSend} onClick={() => void finish("done")}>
                  <Icon name="Check" className="size-4" />
                  Mark done
                </Button>
              )}
              {handoffs}
              {compact ? <span className="ml-auto">{menu}</span> : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}
