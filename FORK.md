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

None yet — installed unmodified at the fork point above.
