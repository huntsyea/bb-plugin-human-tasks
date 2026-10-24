// The reply box under a task: what the agent asked for, a note that refuses
// credentials, and a reminder of where credentials go instead.
import { useState } from "react";
import type { Ref } from "react";
import type { Todo } from "../server";
import { Icon } from "@/components/ui/icon";
import { detectSecret } from "@/lib/tasks";
import { cn } from "@/lib/utils";

export interface NoteState {
  note: string;
  setNote: (note: string) => void;
  /** Non-null when the note looks like it holds a credential. */
  secretWarning: string | null;
  allowSecretLike: boolean;
  setAllowSecretLike: (allow: boolean) => void;
  /** False while a credential-looking note has not been confirmed. */
  canSend: boolean;
}

export function useNoteState(): NoteState {
  const [note, setNote] = useState("");
  const [allowSecretLike, setAllowSecretLike] = useState(false);
  const secretWarning = note.trim() === "" ? null : detectSecret(note);
  return {
    note,
    setNote: (next) => {
      setNote(next);
      setAllowSecretLike(false);
    },
    secretWarning,
    allowSecretLike,
    setAllowSecretLike,
    canSend: secretWarning === null || allowSecretLike,
  };
}

export function notePlaceholder(task: Pick<Todo, "replyPrompt"> & { thread: { state: string } | null }): string {
  if (task.thread === null) return "Note for your records (optional). No agent thread is linked, so nobody is told.";
  if (task.thread.state === "archived") return "Note for your records (optional). The thread that asked is archived, so the agent won't be told.";
  if (task.thread.state === "deleted") return "Note for your records (optional). The thread that asked was deleted, so the agent won't be told.";
  if (task.replyPrompt) return "Your answer. Sent when you mark this done, only if its thread is still open (not archived).";
  return "Note for the agent (optional). Sent with Mark done or Let the agent do it, only if its thread is still open (not archived).";
}

export function NoteField({
  task,
  state,
  autoFocus,
  inputRef,
}: {
  task: Pick<Todo, "replyPrompt" | "secrets"> & { thread: { state: string } | null };
  state: NoteState;
  autoFocus?: boolean;
  inputRef?: Ref<HTMLTextAreaElement>;
}) {
  return (
    <div className="space-y-2">
      {task.replyPrompt ? (
        <p className="flex items-start gap-1.5 text-sm">
          <Icon name="human-tasks/message" className="mt-0.5 size-4 shrink-0 text-primary" />
          <span>
            <span className="font-medium">The agent asks:</span> {task.replyPrompt}
          </span>
        </p>
      ) : null}
      {task.secrets.length > 0 ? (
        <div className="flex items-start gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          <Icon name="human-tasks/shield" className="mt-0.5 size-4 shrink-0 text-foreground/70" />
          <span>
            After you mark this done, the agent opens bb's secure form for{" "}
            {task.secrets.map((secret, index) => (
              <span key={secret.name}>
                {index > 0 ? ", " : ""}
                <code className="rounded bg-muted px-1 py-0.5 font-mono text-[11px] text-foreground">{secret.name}</code>
              </span>
            ))}
            . The value goes straight to a .env file and never into the chat. Don't paste it in the note.
          </span>
        </div>
      ) : null}
      <textarea
        ref={inputRef}
        value={state.note}
        onChange={(event) => state.setNote(event.target.value)}
        maxLength={4000}
        rows={task.replyPrompt ? 3 : 2}
        autoFocus={autoFocus}
        placeholder={notePlaceholder(task)}
        aria-label={task.replyPrompt ?? "Note for the agent"}
        aria-invalid={state.secretWarning !== null && !state.allowSecretLike}
        className={cn(
          "w-full resize-y rounded-lg border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
          state.secretWarning && !state.allowSecretLike ? "border-destructive" : "border-input",
        )}
      />
      {state.secretWarning ? (
        <div role="alert" className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-destructive">
          <span className="flex items-center gap-1.5">
            <Icon name="human-tasks/alert" className="size-3.5" />
            This looks like {state.secretWarning}. Notes land in the agent's chat history.
            {task.secrets.length === 0 ? " Ask the agent to request it with `bb secret request` instead." : ""}
          </span>
          <label className="flex cursor-pointer items-center gap-1.5 text-muted-foreground">
            <input
              type="checkbox"
              checked={state.allowSecretLike}
              onChange={(event) => state.setAllowSecretLike(event.target.checked)}
            />
            It's not a secret
          </label>
        </div>
      ) : null}
    </div>
  );
}
