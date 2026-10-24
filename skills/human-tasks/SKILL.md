---
name: human-tasks
description: Hand the user a step only a human can do through the Human tasks list, instead of asking in chat or writing a .md file. Use when you need the user to log in somewhere, click through a web console, create or share a credential, add a DNS record, pay or sign something, test on a real device, send something in their name, or act in the physical world.
---

# Human tasks

Human tasks is the user's checklist of steps that agents could not do
themselves. The user works through it on the Human tasks page in bb. When they
finish a task, the thread that created it gets a `[Human tasks]` message with
their note. The message is sent only if that thread still exists and is not
archived.

## When to create a task

Create one when the work needs a human action you cannot take:

- **access**: create an API key, grant a permission, invite a bot or user
- **setup**: change a dashboard, add a DNS record, verify a domain, edit a store listing
- **payment**: buy, renew, or sign something
- **review**: test on a real device, or make a taste or design call
- **communicate**: send an email, post, or call someone in the user's name
- **physical**: anything in the physical world

Do not create a task for something you can do yourself, for a quick question
you can ask in chat, or for a decision between options (ask in chat for that).

## How

1. Call `human_task_create`. If the tool is not available, run
   `bb human-tasks add --title "…" --instructions "…" --agent-needs "…" --kind <kind>`.
2. `title`: a short imperative, such as "Create a restricted Stripe key".
3. `instructions`: Markdown, step by step. Put the main URL first as a link,
   say exactly what to enter, and what happens next. The user reads this later,
   away from this conversation. Put values to copy in code blocks.
4. `agent_needs` (required): exactly what you would need to do this yourself,
   this time and next time: "a Cloudflare API token with DNS edit on
   acme.dev", "the Stripe MCP server", "permission to use your signed-in bb
   browser". If only a person can do it (signing, paying, physical), say why.
   The user reads this to decide whether to do it or let you do it.
5. `kind`: access, setup, payment, review, communicate, physical, or other.
6. `blocking: true` only when your work cannot continue until it is done. It
   opens a form in this thread and notifies the user.
7. `reply_prompt` when you need information back, phrased as a question.
   `secrets` + `env_file` when you need a credential back; never ask for a
   credential in the note or in chat.
8. `due` for a real deadline, `not_before` when it cannot happen yet (after DNS
   propagates). Both are ISO dates.
9. Tell the user in one line that you added the task, then continue with other
   work or end the turn. Do not poll.

## What happens next

The user either does it, or lets you do it.

- **They did it.** A `[Human tasks]` message arrives with their note (for a
  blocking task, as the tool's answer). Check it worked when you can (query
  the record, call the API). If it didn't, call `human_task_update` with
  `action: "send_back"` and what is missing. If the message says to run
  `bb secret request`, run that exact command; never print the env file.
- **They let you do it.** A message says they want you to do it yourself.
  In the thread, tell them exactly what you need and how to give it (connect an
  MCP server, a scoped key via `bb secret request`, a CLI login, or permission
  to use their signed-in bb browser). Wait for it, then do the task. Ask before
  anything irreversible: payments, deletions, sending messages. Finish with
  `human_task_update` `action: "complete"`, a one-line `summary`, and `method`
  (how you got access: mcp, api_access, cli_login, browser, new_tool, skill,
  schedule, other), so similar tasks come to agents next time. If you can't do
  it, use `action: "send_back"` with the reason.
- **They ask a question.** Answer in the thread; fix unclear instructions with
  `human_task_update` (default `action: "edit"`).
- **You no longer need it.** `human_task_update` with `action: "dismiss"`.

Creating a task with the same title again returns the existing one. If another
thread already asked for it, you are added and told when it is done. When an
agent already did a similar task, the create result says so: try it yourself
first and dismiss the task if you can.

## CLI

| Command | Effect |
| --- | --- |
| `bb human-tasks list [--all] [--mine]` | List unfinished tasks in this project. `--all` adds finished ones. |
| `bb human-tasks show <id>` | Show one task with its instructions. |
| `bb human-tasks add --title … --instructions … --agent-needs … [--kind …] [--reply-prompt …] [--secret NAME:desc --env-file …] [--due …] [--not-before …]` | Add a task. |

Only the user finishes, reopens, dismisses, or deletes tasks, from the bb page.
Act on your own tasks with `human_task_update`.

Add `--json` to any command when code reads the output.
