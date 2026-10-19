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

## Where the code is

- `legacy/src/settings.ts` has the file, its schema (zod) and `knobsOf`.
- The rewrite in `wip` has not brought it over yet. Packs were put in
  `tsh.toml` (`wip/src/tsh/config.ts`) in the meantime; moving them is the
  next step.

## What would change it

A knob two repos need to set differently that is not a number, a name or a
pick between tested paths. That would mean the step belongs in a pack or in
code, not in the file.
