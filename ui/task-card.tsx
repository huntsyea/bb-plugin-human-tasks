// One task on the Human tasks page. The collapsed row carries the everyday
// actions (done, open the site, hand off, snooze…); expanding shows the
// instructions, the reply box, and the agent's notes.
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
import { firstLink, isFinished, isSnoozed, timeAgo } from "@/lib/tasks";
import { cn } from "@/lib/utils";
import { useTaskActions } from "./actions";
import { useBoardCard } from "./board-card";
import { KeyChip, SnoozeItems, useCompactCards } from "./card-fold";
import { KindIcon, Relations, TaskBadges } from "./bits";
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
  const folded = compact && !expanded;
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
  const board = useBoardCard(task, { expanded, moveTo: (status) => (status === "done" ? toggleDone(true) : void actions.setStatus(status)) });

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

  return (
    <li
      ref={ref}
      {...board.itemProps}
      className={cn(
        "group rounded-xl border bg-card transition-shadow",
        task.blocking && !finished ? "border-destructive/30" : "border-border",
        expanded && "shadow-sm",
        focused && "ring-1 ring-ring",
        board.className,
      )}
    >
      <div className="flex items-start gap-3 p-3">
        {/* On a phone the label is the checkbox's 44px touch target. */}
        <label className={compact ? "-m-2 flex size-11 shrink-0 cursor-pointer items-center justify-center" : "contents"}>
          <Checkbox
            className={compact ? "size-5" : "mt-2"}
            checked={task.status === "done"}
            disabled={actions.busy || task.status === "dismissed"}
            onCheckedChange={(checked) => toggleDone(checked === true)}
            aria-label={task.status === "done" ? `Reopen "${task.title}"` : `Mark "${task.title}" done`}
          />
        </label>
        {compact ? null : <KindIcon kind={task.kind} blocking={task.blocking} finished={finished} />}
        <div className="min-w-0 flex-1">
          <button type="button" className="w-full text-left max-md:min-h-11" onClick={() => setExpanded((value) => !value)} aria-expanded={expanded}>
            <span className={cn("text-sm font-medium leading-5", finished && "text-muted-foreground line-through")}>{task.title}</span>
            <span className="ml-1.5 inline-flex flex-wrap gap-1 align-[1px]">
              {folded ? <KeyChip task={task} /> : <TaskBadges task={task} />}
            </span>
          </button>
          {folded ? null : (
            <div className="mt-1 max-md:[&_button]:min-h-11">
              <Relations task={task}>
                {link ? (
                  <button
                    type="button"
                    title={`Open ${link.url}`}
                    onClick={() => (preview ? toast("This is an example. Nothing is saved.") : navigate.openUrl(link.url))}
                    className="inline-flex max-w-[15rem] items-center gap-1 rounded px-1 py-0.5 font-medium text-primary hover:bg-state-hover"
                  >
                    <Icon name="human-tasks/external" className="size-3.5 shrink-0" />
                    <span className="truncate">{link.host}</span>
                  </button>
                ) : null}
              </Relations>
            </div>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-0.5">
          <span className="flex items-center gap-0.5">
            {!finished && !task.handedBack && !compact ? (
              <Button
                size="icon"
                variant="ghost"
                className="size-7 text-muted-foreground"
                aria-label="Let the agent do it"
                disabled={actions.busy || !threadLive}
                onClick={() => void letAgentDoIt()}
              >
                <Icon name="human-tasks/bot" className="size-4" />
              </Button>
            ) : null}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="icon" variant="ghost" className="size-7 text-muted-foreground max-md:-m-2 max-md:size-11" aria-label="More actions">
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
          </span>
          {compact ? null : (
            <Button
              size="icon"
              variant="ghost"
              className="size-7 text-muted-foreground"
              aria-label={expanded ? "Collapse" : "Expand"}
              onClick={() => setExpanded((value) => !value)}
            >
              <Icon name="ChevronDown" className={cn("size-4 transition-transform", expanded && "rotate-180")} />
            </Button>
          )}
        </div>
      </div>

      {expanded ? (
        <div className="space-y-3 border-t border-border px-3 pb-3 pt-3 sm:pl-[4.75rem]">
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

          {!finished ? (
            <div className="flex flex-wrap items-center gap-2 max-md:[&>button]:h-11">
              {task.handedBack ? (
                <>
                  {task.thread && threadLive && !preview ? (
                    <Button size="sm" variant="outline" onClick={() => navigate.toThread(task.thread!.id, { split: true })}>
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
                  <Button size="sm" disabled={actions.busy || !noteState.canSend} onClick={() => void finish("done")}>
                    <Icon name="Check" className="size-4" />
                    Mark done
                  </Button>
                  <Button size="sm" variant="outline" disabled={actions.busy || !threadLive || !noteState.canSend} onClick={() => void letAgentDoIt()}>
                    <Icon name="human-tasks/bot" className="size-4" />
                    Let the agent do it
                  </Button>
                  <Button size="sm" variant="ghost" disabled={actions.busy || !threadLive || !noteState.canSend} onClick={() => void ask()}>
                    <Icon name="human-tasks/question" className="size-4" />
                    {note ? "Ask the agent" : "Ask…"}
                  </Button>
                </>
              )}
            </div>
          ) : null}
        </div>
      ) : null}

      {board.footer}
    </li>
  );
}
