# Fork notes

Local fork of [kvaliotti/bb-plugin-human-tasks](https://github.com/kvaliotti/bb-plugin-human-tasks), a single BB plugin (**Human tasks**) from the `bb-community` marketplace by Konstantin Valiotti.
`main` is our branch, pushed to `origin` ([huntsyea/bb-plugin-human-tasks](https://github.com/huntsyea/bb-plugin-human-tasks), a GitHub fork of upstream).
The `upstream` remote is fetch-only (push is disabled). Take upstream updates with `git fetch upstream && git merge upstream/main` (or rebase our changes onto a new tag), then `npm install && npm run build`.

- **Base:** upstream `main` at `0a0975f` (one commit past tag `v0.1.1`).
- **Local checkout:** `/Users/huntsyea/Dev/bb-plugins/bb-plugin-human-tasks`.
- **Installed in BB from this fork:** `2026-10-26` (Warden). `bb plugin list` shows the source under this folder.
- **Build:** npm (`package-lock.json`); `npm run build` runs `bb plugin build` → `dist/` (git-ignored). Engines: bb `>=0.46`, Plugin SDK `>=0.6.49`. `better-sqlite3` is a transitive dev dep, not used by the built server bundle.
- **Adds:** a `bb human-tasks` CLI (`list`, `show`, `add`), an in-thread app surface, and two internal schedules (`prune` nightly, `resurface` every minute).

## Our changes

### List and Board views, mobile first (BBP-59, branch `sync/BBP-59`)

- **List | Board toggle** on the Human tasks page. The List is unchanged (urgency groups, To do / Finished tabs). The Board has To do (`open`), In progress (`in_progress`) and Done (`done`) columns. Dismissed tasks show in Done only with "Show dismissed". Snoozed cards stay folded at the foot of their column. The choice is kept in `localStorage` (`bb-plugin-human-tasks:view`), so it is per device. No server, schema or stored-data change.
- **Moves reuse the check-off.** `TaskCard` hands the Board its own `moveTo`: Done runs `toggleDone(true)`, which is the checkbox path (reply-prompt and credential-note checks first, then `todos_set_status`, which closes any in-thread form, resumes the agent and sends the `bb secret request` follow-up). Other moves call `setStatus`, the same as the overflow menu. A card that needs an answer opens its reply box instead of completing. The Board offers only the moves the List already does: an open card goes to In progress or Done, an in-progress card goes back to To do or to Done, and a finished card (done or dismissed) reopens only to To do, like Reopen, which is the only move that clears a hand-back. A card the agent is doing (`handedBack`, unfinished) can only go to Done. Moves wait while the card's previous change is still in flight, the same `busy` lock as the checkbox, so a double tap sends one call.
- **Desktop:** columns side by side and dragging (folded cards only). **Phone (< 768px, bb's compact viewport):** one column at a time behind a switcher with counts, and status buttons instead of dragging (inside the unfolded card since BBP-64).
- **Phone cards:** folded to the title plus one key chip ("Agent is on it", else Blocking, else due/overdue; BBP-64 extends this to desktop). Tapping unfolds the steps, badges, relations and hand-off buttons. The quick hand-back button and the expand chevron are hidden, and snooze, dismiss and hand back are in the overflow menu. Under 768px these get 44px touch targets: the controls on the page and cards, the menu items, the filter sheet, and the "It's not a secret" confirm, through its label. Inline text links inside instructions keep their size.
- **Phone filters:** project, bot and kind sit behind one Filter button that opens a bottom sheet (bb's menu since BBP-64).
- **Fixes an upstream bug:** on viewports under 768px, the overflow menu became a sheet with no Radix menu root, but Snooze was still a Radix submenu, so opening the menu on any unsnoozed task threw `MenuSub must be used within Menu`. The phone menu now lists the snooze presets as plain items.
- **New modules:** `ui/view-mode.ts`, `ui/segmented.tsx`, `ui/board.tsx`, `ui/board-card.tsx`, `ui/card-fold.tsx`, `ui/filter-sheet.tsx`.
- **Upstream-owned files touched:**
  - `ui/page.tsx`: the toggle, the Board body, the Filters wrapper, 44px classes and a wider page in Board view.
  - `ui/task-card.tsx`: the board hook, phone folding, 44px targets, snooze items, and an unfolded-body indent only from 768px.
  - `ui/note-field.tsx`: one class, the 44px label for "It's not a secret".
  - `icons.tsx`: two added Lucide icons, `filter` and `arrow-right`.
  - `package.json`: dev deps and the `check` script.
  - `package-lock.json`.
  - `tsconfig.json`.
- **Tests:** `tests/views.test.tsx` drives the registered nav panel through the SDK's `renderSlot` (jsdom). New dev dependencies: `jsdom` and `@testing-library/react`/`dom`. `vitest.config.ts` adds the `@/` alias.

### Design pass on List and Board (BBP-64, branch `sync/BBP-64`)

Design only: no new features, and `server.ts`, `lib/` and stored data are untouched. Benchmark: Linear's issue list and board, in bb's own components and theme tokens.

- **Less chrome.** The three stat cards and the intro line are gone. Counts sit in the group headings and the To do scope; "Nothing is waiting on you" still explains the page when it is empty. The example banner is one quiet line.
- **One control bar:** the To do / Finished scope as quiet pills on the left, then Filter and the List | Board toggle (an outlined icon group, icons only on a phone) on the right. The scope and the toggle no longer look like the same control.
- **List rows are one line:** checkbox, title, one key chip, then the bot's color, the project and the age on the right. Each group is one hairline-divided container. Desktop rows fold to one key chip too, and the kind icon, the quick hand-back button and the chevron are gone: the title row toggles the row, kind shows in the unfolded meta, and hand back is in the menu and the unfolded actions. The overflow menu shows on hover or keyboard focus on a pointer that hovers, and inside the unfolded row on a phone.
- **Board cards:** no checkbox, kind icon or buttons on the face. The title clamps to two lines over the key chip and the meta, on recessed columns with To do / In progress / Done status icons. **Status moves left the card face:** they live in the unfolded card, as Mark done (which goes through the card's `moveTo`, so the checkbox's check-off path with its reply-prompt and credential holds) and "Move to …" (sighted label "In progress"/"To do"), with the hand-offs on a quieter line beneath. The menu's Mark in progress / Mark not started is unchanged. Moves still honour `movesFor` and the busy lock, and a done card still reopens only to To do.
- **Filters:** one bb `DropdownMenu` of `DropdownMenuCheckboxItem`s (project, bot with "No bot", kind), so a desktop gets a popover and a phone gets bb's bottom sheet; no native selects. bb's `DropdownMenuRadioItem` renders nothing on a phone, hence checkbox items with single-choice behaviour. On a desktop the filters that are on also sit beside the button as chips that clear on click.
- **Chips:** `Badge` is a hairline-outlined chip. Color sits on the icon or a dot (destructive, success), and only danger text is tinted (`destructive-text`). The folded key chip also covers "Reopened by agent", "Done by agent" and "Dismissed".
- **Tokens:** `surface-recessed`, `border-hairline`, `subtle-foreground`, `state-hover`/`state-active`, `destructive-text`, `success` and `warning`, all from bb's theme, so the page follows the active theme in light and dark.
- **Kept:** completion through the checkbox handler with the hold rules, the remembered view, 44px phone targets (measured: 0 of 24 List and 0 of 19 Board controls under 44px at 390px), one Board column at a time on a phone, the busy lock, done cards reopening only to To do.
- **Tests:** the BBP-59 tests keep their intent but follow the new path: phone status moves and the phone menu are reached by unfolding the card first, Board cards fold by tapping the title (no Collapse button), the move button is named "Mark done", and filters are menu items instead of selects. New tests cover a folded Board card with no status controls or checkbox, an unfolded desktop card's Mark done holding for a reply, desktop rows folding to one chip, the counts in the headings and scope, and the desktop filter menu with its chips.
- **Files:**
  - Fork-owned, rewritten: `ui/filter-sheet.tsx` (now `FilterMenu` and `ActiveFilters`), `ui/segmented.tsx` (pills and toggle looks), `ui/card-fold.tsx` (`KeyChip`, `RowMeta`), `ui/board-card.tsx` (`MarkDoneMove`, `OtherMoves`; the always-on footer is gone), `ui/board.tsx`.
  - Upstream-owned:
    - `ui/page.tsx`: the stat cards and native selects are removed; adds the control bar and the grouped containers.
    - `ui/task-card.tsx`: the row and card layouts and the menu placement. The handlers (`finish`, `toggleDone`, `letAgentDoIt`, `ask`, the menu items) are unchanged.
    - `ui/bits.tsx`: the `Badge` look.
    - `icons.tsx`: four Lucide icons, `list`, `board`, `circle`, `circle-half`.
- **Preview method:** the before/after shots are the live page at `/plugins/human-tasks/tasks/example` in a headless bb session. For the after shots, that page alone answered bb's request for this plugin's `app.js`/`app.css` with the candidate build, so the real shell, theme (Hunter's `codex`) and host icons render the candidate with no server change. Dark mode is emulated `prefers-color-scheme`, since bb's mode is the per-browser `localStorage["bb.theme"]` (default `system`).

### The check typechecks the tests (BBP-58)

`tsconfig.json` now includes `tests/` and `vitest.config.ts`; `server.test.ts` was already included. `npm run check` runs `typecheck` and then `test`, and it fails on a deliberate type error in either test file.
