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
- **Desktop:** columns side by side and dragging (folded cards only). **Phone (< 768px, bb's compact viewport):** one column at a time behind a switcher with counts, and Move/Done buttons on each card instead of dragging.
- **Phone cards:** folded to the title plus one key chip ("Agent is on it", else Blocking, else due/overdue). Tapping unfolds the steps, badges, relations and hand-off buttons. The quick hand-back button and the expand chevron are hidden, and snooze, dismiss and hand back are in the overflow menu. Under 768px these get 44px touch targets: the controls on the page and cards, the menu items, the filter sheet, and the "It's not a secret" confirm, through its label. Inline text links inside instructions keep their size.
- **Phone filters:** project, bot and kind sit behind one Filter button that opens a bottom sheet.
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

### The check typechecks the tests (BBP-58)

`tsconfig.json` now includes `tests/` and `vitest.config.ts`; `server.test.ts` was already included. `npm run check` runs `typecheck` and then `test`, and it fails on a deliberate type error in either test file.
