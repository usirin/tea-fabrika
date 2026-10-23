# @kampus/promises

Each formal check as a record tied to the code it covers. A gate in CI fails when that code
changes and the record is not confirmed again. Built in
[experiment 117](../../experiments/117-promises-stay-in-step.md).

```sh
pnpm promises                        # the list, then each promise with its check and planted break
pnpm promises gate --base <ref>      # what CI runs
pnpm promises confirm <id>           # after the covered code changed and the promise still fits
```

- **A record** is one file in `promises/` at the top of the repo. Its shape is `Entry` in
  [`src/record.ts`](./src/record.ts): the promise, the harm, the tool, the check command, the
  planted break, what it covers, what its exam is, and when it was last confirmed.
- **Covered code is named, not numbered.** `file.ts#name` is every top-level statement that
  declares `name`; `file.ts` alone is the whole file. A print is the first 16 hex of the
  sha256 of that text. Code that moves up or down keeps its print.
- **A check command** prints one `Verdict` as JSON, last on stdout. The runner asks for the
  planted break by running the same command with `PROMISE_PLANT=<name>`, so the plant can
  never be a different command.
- **The gate** runs every check and every plant at the head, every time. It fails on a stale
  or missing piece, a red check, a plant not caught, or a command that gave no verdict. It
  lists exam changes (a check, its plant, a record's own words) for the owner.

| File | What it does |
|---|---|
| [`src/record.ts`](./src/record.ts) | The record and the verdict, as Effect Schema |
| [`src/blocks.ts`](./src/blocks.ts) | Splits a TypeScript file into its top-level statements, by name |
| [`src/judge.ts`](./src/judge.ts) | Pure: one promise's facts in, green or its problems out |
| [`src/show.ts`](./src/show.ts) | Pure: the text a person reads |
| [`src/node.ts`](./src/node.ts) | The reading: files, git, the check commands, sha256 |
| [`src/main.ts`](./src/main.ts) | `pnpm promises` |
