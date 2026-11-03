# Naming sweep

**Proposed** 2026-10-24 for the pipeline stages, and widened on 2026-10-28 to
every new package. It proposes names; it renames nothing. The owner picks, and
each pick carries its date (**picked 2026-10-24**, **picked 2026-10-28**).
Then one rename pass and a short glossary page follow, as
[Use the industry's names](../direction/use-the-industrys-names.md) says.

```ts
// The whole idea, on one name.
type Row = {
	name: "Check";                       // the name in our code, or a schema key
	means: "a criterion's {how, what}";  // what it means here
	industry: "verification method";     // what others call it, with a source
	mark: "two-ideas";                   // ok | differs | two-ideas | two-words | collides
	proposal: "Verification, 55%";       // only where the mark is not ok
};
```

## The answer

The sweep lists every exported name and schema key a reader meets in the new
packages, finds the industry's word for each, and marks where ours differs.
It covers everything except `wip`, `legacy` and `experiments`: 1880 rows.
1115 are fine as they are; 765 are not.

| Area | File | Rows | ok | two-ideas | two-words | differs | collides |
|---|---|---|---|---|---|---|---|
| `packages/fabrika` | [core.md](./core.md) | 325 | 195 | 61 | 29 | 23 | 17 |
| `packages/pipeline`, `packages/promises`, `packages/ledger-server` | [pipeline.md](./pipeline.md) | 1281 | 776 | 254 | 119 | 114 | 18 |
| `apps/fabrika`, `programs/*`, `packs/*` | [app.md](./app.md) | 274 | 144 | 63 | 28 | 32 | 7 |
| All | | 1880 | 1115 | 378 | 176 | 169 | 42 |

- The big problem is not words that differ from the industry's. It is one
  word used for two things inside this repo: 378 rows. Fixing those first
  gives the most clarity per rename.
- Counts are rows, not names. A row often groups several names of one idea.
- A row a pick covers keeps the mark it had before the pick, so the counts
  still show where the trouble was.

## The marks

- `ok`: ours is the industry's.
- `differs`: the industry has a different name for this.
- `two-ideas`: one word means two things in this repo.
- `two-words`: two words mean one idea.
- `collides`: it shadows or clashes with a JS, TypeScript or Effect built-in.

A proposal is given only where the mark is not `ok`. A confidence under 80%
is a lean. Every schema key a reader sees has its own row, written
`Type.key`.

## Picked

- **2026-10-24**, all in plan, the stages and fabrika's agent types (rows in
  [pipeline.md](./pipeline.md)):
  - `planDraft` -> `draftPlan`; `PlanAsk` -> `PlanInput`, and every `*Job`
    and `*Ask` input becomes `*Input`.
  - `Numbered` -> `WithIds`; `Spent` and `Spend` -> `Usage`, one type in
    fabrika, and every `spend` key becomes `usage`.
  - `stuck:unchecked` -> `stuck:unfixed`; plan's state `key` -> `session`.
  - `Promise` -> `Property`, saying `when`, `result`, `why`, `behavior: "new"
    | "existing"`, `tool: "test" | "tla"`, `stories`, `code`; its id is `p1`.
  - Plan's `Check` value goes: `Check` is only the move. A check a tool runs
    is a `Property`; one a reviewer reads is a `Criterion`, with `read`.
  - A criterion's `serves` -> `stories`. A task's `job` -> `scenario`, with a
    required `fixture`.
  - `Facts` -> `CodeContext`, `readFacts` -> `readCodeContext`, `plan_facts`
    -> `plan_code_context`. `Revision` stays.
  - The verify writer -> the test writer, and its outcome words (now in
    code).
  - Held for the glossary pass, not picked: `pointers`, `goal`, `at`,
    `Claim`, and calling a revision's number `version`.
- **2026-10-28**, in the shell, the host, the app and the ledger:
  - `job` stays: a tsh line is one job, as in bash.
  - run -> process and run id -> pid, in the shell and the host only.
  - A process's id is a `pid`, full stop. A pid survives a host restart
    because the process resumes its saved state
    (`packages/fabrika/src/shell/jobs.ts`); an Erlang restart starts from
    fresh state, which is why it gets a new pid there. The two other uses are
    renamed: the OS process number in `agents/agent/turn.ts` -> `osPid`, and
    the test writer's property id -> `propertyId`.
  - `stage` is dropped from the shell's job record, and `shell/check.ts`'s
    `Stage` goes with it. The pipeline's stages are a different idea and keep
    their name.
  - wire -> pipe, for program-to-program connections only. The ledger and
    http network `Wire` and the app's `wire.ts` NDJSON framing are not
    renamed to pipe; each has its own row.
  - The sandbox's `Job` -> `SandboxCommand`.
  - The desk layout: stack -> container; orientation is `horizontal` or
    `vertical`; tabbed is removed; fold is per tile (double-click a title
    bar).
  - `fold` stays for reading the ledger into state (a left fold) and for the
    desk's tile fold. A ticket joining an open plan becomes "added to a plan"
    in the rebuilt pipeline: the old pipeline's `fold` and `foldsOf` are
    rebuilt, not renamed.
  - Fact vs Event -> `Event`, everywhere. A ledger entry is an event, event
    sourcing's word, and the host ledger already says so. The old pipeline's
    `*Fact` names are rebuilt, not renamed.

## Still open for the owner

- **Tracker #32's remaining words.** Each has a row at every place it shows
  up, and no pick.
  - **The tag key.** Nineteen or more keys tell union cases apart: `kind`,
    `type`, `_tag`, `phase`, `answer`, `go`, `ev`, `how`, `do`, `on`, `op`,
    `tag`, `at` and more.
  - **`ask`.** An outcome verb, the ledger record waiting on a person, a
    question's text, a combo, a GraphQL call, ACP's permission request, and
    the app's y/n prompt.
  - **The money cap.** `usd`, `budget`, `maxBudgetUsd` name one cap.
    `deliver` takes both `--budget` and `--usd`. The `Usage` pick covers only
    what was paid.
  - **Tries.** `tries`, `limit`, `MAX_RUNS`, `DEFAULT_TRIES` name one cap on
    attempts. Temporal says `maximumAttempts`.
  - **Lane or parent.**
  - **`kind`.** Every outcome's tag, fabrika's machine kind, the ledger row's
    event type, and many union tags.
- **run's other meanings.** The run -> process pick covers a program's live
  instance only. Still "run": one copy of a machine kind (`Ref`, `Copy`), a
  ledger name's life (`incarnation`), and the pipeline's draft, test and
  check runs.
- **Leftover folders.** `packages/tea-program`, `packages/tea-host` and
  `packages/tsh` are empty: only an untracked `node_modules`. The
  `packages/*` glob in `pnpm-workspace.yaml` still matches them. Delete them
  from disk?

## Across packages

The worst clashes that cross a package line. Each names both places; the rows
in the area files give the rest.

- **One word, two ideas**
  - **`Verdict`, `Entry`, `Row`.** `Verdict` nine times (a posted comment in
    `pipeline/src/verdict.ts`, a filed row in `criteria/book.ts`, a tool allow
    in `stages/build/builder-acp.ts`, the promises record). `Entry` eight
    times: `pipeline/src/criteria/book.ts` and `fabrika/src/program/listed.ts`
    (a packed program). `Row`: `pipeline/src/criteria/book.ts` and
    `fabrika/src/host/ledger.ts`, and again in `programs/tracker/src/rows.ts`
    and `packs/owner-desk/src/pages.ts`.
  - **`desk`.** The owner's ask list (`pipeline/src/tsh/desk.ts`,
    `laws/world/laws.ts`, and `packs/owner-desk`'s `Desk` and `DeskMsg`) and
    the app's tile layout (`apps/fabrika/src/desk/`).
  - **`door`.** Sign-in (`packages/ledger-server/src/config.ts`,
    `fabrika/src/host/door.ts`) and ship's re-read before a write
    (`pipeline/src/stages/ship/door.ts`). Lean: ship's -> `recheck`, 65%.
  - **`wire`.** After the pipe pick, the network still says wire
    (`fabrika/src/host/ledger.ts` `Wire`, `host/http.ts`), and so does the
    app's NDJSON framing (`apps/fabrika/src/wire.ts`). Only
    `programs/map/src/map.ts`'s `Wire` and the shell's wire are the picked
    pipe. The rename pass must not search and replace.
  - **`stage`.** The pipeline's stages (`pipeline/src/stages/`), the
    tracker's nine "steps" for the same idea (`programs/tracker/src/steps.ts`,
    while `head.ts` says `stage`), `AGENT_STEPS` in `pipeline/src/settings.ts`,
    and Alchemy's `--stage` flag (`packages/ledger-server`).
  - **`Usage`.** The ledger's quota (`fabrika/src/host/rules.ts`), ACP's
    token counts (`agents/acp/transcript.ts`), and the picked agent run cost
    (still `Spend` in `agents/claude/draft.ts` and `Spent` in the pipeline).
  - **`hold`.** A spend authorization in the ledger (`host/rules.ts`), a
    ticket lease and a cost reserve in the pipeline (`asks/ledger.ts`,
    `hosted/deliver.ts`).
  - **`Property`.** The picked plan `Property`
    (`stages/test-writer/brief.ts`), a law run as a fast-check property
    (`laws/ship-pbt.ts`), and the ticket view's "Properties" panel
    (`programs/ticket/src/window.tsx`, Linear's issue fields).
  - **`Plan`.** The pipeline's ticket plan, the ticket program's view
    (`programs/ticket/src/view.ts`), and a ledger move's plan
    (`fabrika/src/host/move.ts`).
  - **`Outcome`.** The pipeline's five-verb outcome
    (`stages/outcome.ts`) and the host's call and monitor outcomes
    (`host/call.ts`, `host/monitor.ts`).
  - **`Opened`, `Piece`, `Heard`, `Answer`.** Build's `Opened` is a pull
    request; the tracker's is a ticket page. The promises' `Piece` is code;
    the tracker's is text or a link. `Heard` is in the asks ledger,
    `tsh/desk.ts`, `fabrika/src/program/program.ts`, `agents/agent/turn.ts`
    and `apps/fabrika/src/tsh.ts`. `Answer` is the asks core's, ACP's
    permission answer, the supervisor's and the mcp server's.
  - **`home`.** `FABRIKA_HOME` (the app's folder), tsh's home
    (`pipeline/src/tsh/config.ts`), and every pack's `places.home` (the
    pack's own folder).
  - **`window` and `view`.** `defineProgram` says `view`, every program's
    text says "window", and the outbox's `WINDOW` is a send window
    (`fabrika/src/program/outbox.ts`).
  - **`check`.** Only the move since 2026-10-24, but `tickets/ticket.ts`
    names a GitHub check run `Check`, the promises record's `check` is a
    command, and ui-verification "raises one check".
- **One idea, two words**
  - **user or person.** `fabrika/src/host/door.ts` and `host/writer.ts` say
    `user`; `PERSON_KINDS`, `host/local.ts` and `mcp/serve.ts` say `person`;
    the pipeline's docs say "the owner".
  - **shape or schema.** fabrika says shape (`program/shape.ts`); AGENTS.md
    and the pipeline say schema.
  - **harness, adapter, agent, maker, provider.** Five words around one
    boundary: `agents/acp/harness.ts`, `agents/agent/turn.ts`, the acp flag
    `agent`, and the pipeline's `HARNESSES: sdk, acp`.
  - **release or cancel.** The ledger gives up a lease with `cancel`
    (`host/ledger.ts`); the pipeline's lanes say `release`.
  - **Two event vocabularies.** `tickets/ticket.ts` and the asks ledger both
    define `planned`, `reviewed`, `answered`, with other shapes. The answer's
    hash is `saw` in `combos.ts` and `text` in `tickets/ticket.ts`. Both are
    events now (picked 2026-10-28) and rebuilt, so the rebuild should use one
    set.
  - **The money and time words.** `Limits.usd` in the ledger and in a turn,
    with different keys; the acp flag `budget`; `Cost.usd`, `costUsd`; time as
    `wallMs`, `seconds`, `minutes`, `ttlMs`. `Budget` in
    `pipeline/src/laws/sample.ts` is time, not money.
- **Clashes with built-ins**
  - `Result` (Effect's module; `pipeline/src/check-runs.ts`,
    `controls.ts`), `Scope`, `Span` and `Path` in mutation (Effect),
    `Machine` in `laws/walk.ts` (tea's), `File` in the test writer (the DOM).
  - `Act`, `Move` and `Check` outside `primitives.ts`
    (`hosted/lane-trace.ts`, `laws/world/search.ts`, `tickets/ticket.ts`)
    clash with the six moves.
  - fabrika's `Agent` namespace silently shadows `host/writer.ts`'s `Agent`
    through `export *`.

## What this cannot tell us

- It renames nothing. No proposal was tried on a reader, so each confidence
  is one reader's judgment, not a measure.
- It reads code, not the experiments' write-ups or the direction notes,
  except where a name comes from one. Tests and fixtures were not swept for
  the core, so a name used only there has no row.
- Some links were checked for an HTTP 200 and some were written from known
  doc pages; each area file says which. A page that moves later is not
  caught.
- Line numbers in the rows are from the day of the sweep. They drift as code
  moves.
