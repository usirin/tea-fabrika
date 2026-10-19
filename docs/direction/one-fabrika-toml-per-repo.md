# One fabrika.toml per repo

Decided 2026-10-05. Packs added 2026-10-18. The full story is
[blog post 10](../../blog/10-knobs-in-a-file.md); the first code is
`legacy/src/settings.ts`.

## What was decided

- **Each repo fabrika works on has one `fabrika.toml`.** TOML, not JSON:
  real comments, sections, no braces to balance.
- **A knob is a number, a name, or a pick between paths the code already has
  and tests.** Floors, limits, a model name.
- **The order of the steps stays in code.** No `steps = [...]`, no `when = "..."`.
  A config file that decides what happens next is a worse programming language.
- **Three load rules:**
  - an empty file changes nothing: every key defaults to the code's value;
  - an unknown key or table is an error, so a typo cannot be ignored;
  - a value out of range fails and names the key.
- **A run copies its settings when it is filed.** Machines never read the
  file. A restarted or replayed run keeps the rules it started with.
- **Each agent step can get its own model and effort** (agreed 2026-10-10):
  `[agents.<step>]` with `model` and `effort`.
- **Add-on packs are listed here** (2026-10-18), not in `tsh.toml`:

  ```toml
  packs = ["@tea-fabrika/owner-desk"]

  [pack."@tea-fabrika/owner-desk"]   # one pack's own settings; the pack checks them
  ```

  Packs depend on the repo: a UI pack fits a product repo, not a library.
  `tsh.toml` keeps only the shell's own settings.
- **Only knobs a machine decides with are copied into a run** (2026-10-05).
  A Jev reader's floor is read when the reader is built, so a question asked
  again after a restart uses what the file says then. The machine never
  decides with the floor; it keeps the reader's answer.
- **An old saved run keeps the rules it really ran by** (2026-10-05). When a
  saved state lacks a field, fill in the value it ran with, written as a named
  constant, or mark it "not recorded". Never fill in today's default. A saved
  shape the code does not know is refused, not guessed.
- **A knob that switches a check off shows on the record** (2026-10-05). The
  record says "skipped" and why, so a skipped check never reads as a clean one.
- **Each machine is handed its own settings when it is made** (2026-10-11),
  the way `createShip({ waits })` is. No settings list on the root names its
  children, and no machine reads the computer it runs on. The file is read
  once, at the edge, and each machine is handed its values.
- **The first file's `[lane] attempts` knob no longer fits.** Since
  2026-10-12 there is no cap on build rounds; a stall rule stops the loop
  instead ([done is per criterion](./done-is-per-criterion.md)). It stays in
  `legacy` only.

## Where the code is

- `wip/src/settings.ts` reads the file, with Effect Schema (2026-10-18).
  Its tests in `settings.test.ts` pin the three load rules.
- The file sits at the root of the repository: the nearest folder up from
  where tsh starts that holds `.git` (`repoOf`). Outside any repository, the
  folder tsh starts in.
- tsh's edge, `wip/src/tsh/fabrika-main.ts`, reads it once and hands the desk
  its packs (`deskSession(settings, …)`). Pack names are found from the
  file's folder. No machine reads it.
- A `tsh.toml` that still has `packs` or a `[pack."<name>"]` table stops tsh
  and says to move them here.

  ```toml
  # fabrika.toml, today: every key the wip reader accepts
  packs = ["@tea-fabrika/owner-desk"]

  [pack."@tea-fabrika/owner-desk"]   # must name a pack that packs lists
  dir = "desk"
  ```

  ```ts
  readSettings(`${yield* repoOf(cwd)}/${SETTINGS_FILE}`)
  // ""                                   -> { packs: [], pack: {} }
  // "[failure]\nfloor = 0.9"             -> fails: "failure: no such key or table"
  // 'packs = ["a"]\n[pack."b"]'          -> fails: 'pack."b": packs does not list it'
  // 'packs = [""]'                       -> fails: "packs[0]: a pack is named by its package"
  ```

- **No knob from the first file came over.** Every one of them belongs to a
  step `wip` does not have yet: the Jev readers (`[jev]`, `[review]`,
  `[comments]`, `[failure]`), triage (`[triage]`) and the old lane (`[lane]`).
  A knob comes back with the step that decides with it, and is copied into
  the run when it is filed. Until then there is no restart test, because no
  `wip` machine decides with a value from this file.
- **Not done yet:** `[agents.<step>]` with `model` and `effort`. Model,
  effort, budget and rounds are still one value each in `tsh.toml`, as flag
  defaults, and operate uses one model for the builder and the reviewer.
- `legacy/src/settings.ts` keeps the first file (zod) and `knobsOf`. The
  legacy run reads it only from the path `CONFIG` names. Its schema does not
  know `packs`, and the wip schema does not know the old knobs, so one file
  cannot feed both.

## What would change it

A knob two repos need to set differently that is not a number, a name or a
pick between tested paths. That would mean the step belongs in a pack or in
code, not in the file.
