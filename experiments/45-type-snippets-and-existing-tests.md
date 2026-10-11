# 45. Two more checks: type snippets and existing tests

Not an experiment, a redesign, with offline probes and one real run. Run 4 of
#558 wrote 7 criteria, all unchecked: a ticket about types has no call whose
value shows it. So vetting passed it with nothing to run, and the lane parked
`unchecked` before writing a test. And section 44's published-API check let
through a widening hidden inside a named signature. Two new criterion kinds
make both checkable:

```ts
{ kind: "type", id, rule, files, uses: Import[],
  snippets: [{ expect: "compiles" | "rejects", today: "holds" | "fails", code }, ...] }
{ kind: "existing_test", id, rule, test, files }
```

**A `type` criterion** is one or more TypeScript snippets. `compiles`: the code
must typecheck. `rejects`: the line under each `// @ts-expect-error` must be a
type error and the rest must compile, the idiom of demlik's `*.test-d.ts`.
`today` says how the snippet stands before the change: `fails` for one that
shows the change, `holds` for a guard, a limit the change must keep. After the
change every snippet must hold. Guards are how a limit ("do not widen
`ctx: undefined`") becomes a check: a call that is rejected today must still be
rejected after.

**An `existing_test` criterion** names a test file in the repo that must pass
after the change, such as a doc page's twin (section 42). It is not locked: a
twin mirrors its page, so a change to the page changes the twin too.

**Vetting** runs each on HEAD in the fresh copy it already makes for examples:

| Check | Fine | Sent back |
|---|---|---|
| Snippet marked `fails` | fails today, the right way round: a `compiles` one has a type error; a `rejects` one has a marked line that compiles (TS2578, unused directive) | holds already: it shows nothing |
| Snippet marked `holds` | holds today | fails today: either it shows the change (mark it `fails`) or it is wrong |
| Any snippet | | broken: a type error no change fixes (a syntax error, a name never imported or never used, a missing module or export), an error outside a marked line, a marked line rejected for such a reason, or bad imports; a `compiles` snippet with a mark, a `rejects` one without |
| Existing test | at HEAD, and runs: passing or failing today, both recorded | not at HEAD, or the workspace cannot run it (a vitest flavour runs tests in its own package only) |

And something must fail today: an example, a snippet marked `fails`, or an
existing test. A draft of guards and passing tests only shows nothing.

How a `rejects` snippet is read: the snippets are written to their file twice,
as they are and as a "bare" copy whose marks are plain comments, line for
line, and both go into one `tsc` run. In the copy as written, a marked line
that compiles shows as TS2578; in the bare copy, the error the mark hid shows,
so vetting can tell a call rejected because `ctx` is missing from one rejected
because `db` was never imported. Codes are read off the message: the list of
"no change fixes this" codes is short and on purpose.

**The generated file.** Prepare writes the snippets to
`src/fabrika-<n>.test-d.ts` beside the examples' `src/fabrika-<n>.test.ts`,
commits both, and locks both: the builder may not change them. Each snippet is
a block of its own under a line naming it (`// "id: snippet 1" compiles`), so
what one declares never meets another; what they use is imported once on top,
relative to the file. The examples' file is now written only when there are
examples: vitest fails a test file with no test in it. Each snippet is a check
named `<id>: snippet <n>`, each existing test `<id>: <test>`, beside the
examples' tests, so the lane's `prepared` needed no change: a check that did
not run parks `tests_broken`; nothing failing parks `nothing_to_build`; a guard
that holds is passing, like an example that holds already.

**After a build** the check runs the repo's command, then the issue's own
checks by themselves: `tsc` on the snippets' file alone with the package's
test tsconfig (the same path vetting uses), and each existing test alone. Same
on the fresh copy. On demlik, `pnpm typecheck` happens to cover the file
already (tea's `tsconfig.json` excludes `*.test.ts`, not `*.test-d.ts`), but a
repo whose typecheck skips it would let a broken snippet through, so the
flavour checks it itself. The Workspace's `check` and `freshCheck` now take the
issue, which the build loop's Cmd already holds. Ship's retest after a merge
still runs only the repo's command.

**Briefs.** The enricher learns the two kinds in four lines, under "Prefer a
checkable one: a rule is unchecked only when no snippet or test can show it",
and is asked to write the ticket's limits, from its no-gos and rabbit holes
too, as type guards when they are about types. Its schema gains `check`,
`snippets` and `test`. A doc page with a twin now becomes an `existing_test`.
The builder is shown each snippet as the check has it, guards marked "it holds
today: keep it so", told the snippets file is typechecked with the tests and
locked, and told one sentence about section 44's rule: a change to a published
name the issue does not name, or a new export, is sent back.

**Old saved runs.** Criteria need no migration: the union only grew. Facts
packs saved before section 42 get `calledIn: null` on every name and
`pages: []` in `parseFactory`, wherever triage keeps them (its facts, and an
enrichment run's brief), so `ticketNames` no longer tolerates a missing
`calledIn`. Runs `558-1` to `558-4` parse, their issues and facts pass the
schemas, and their ticket names are unchanged.

## Offline, on #558, before any agent

A hand-written type criterion for #558 (`experiments/41-vet-probe.ts`, now with
`ISSUE=`), on demlik at d2730b1. One snippet that shows the change, two guards,
and the how-to's twin:

1. `compiles`, `fails`: a `NoCtx` machine, `replay(pure, { msgs: [{ type: "bump" }] })`
2. `rejects`, `holds`: a machine whose `init` reads `ctx.db`, `replay(db, { msgs: [] })`
3. `rejects`, `holds`: a machine typed `ctx: undefined`, `replay(undef, { msgs: [] })`

Vetting took 7.0 s and passed it: 1 fails with TS2345, 2 and 3 are rejected
with "`ctx` is missing", the twin passes. Then the lane's side
(`experiments/45-type-guard-probe.ts`: prepare in a throwaway copy, a diff
applied, the check), with two snippets more to explain snippet 1:

| Snippet | HEAD | `CtxArg<Ctx>` on `replay` | run 2's builder diff |
|---|---|---|---|
| 1 `replay(pure, { msgs: [{ type: "bump" }] })` | fails | **fails** | **fails** |
| 2 guard: `db` machine needs `ctx` | holds | holds | holds |
| 3 guard: `ctx: undefined` machine needs `ctx` | holds | holds | **fails** (TS2578) |
| 4 `replay(pure, { msgs: [{ type: "bump" }], ctx: {} })` | fails | fails | fails |
| 5 `replay(pure, { msgs })`, `msgs` typed `{ type: "bump" }[]` | fails | holds | holds |
| the twin test | passes | passes | passes |

Two findings:

- **The guard catches what section 44 could not.** Run 2's `ReplayCtxArg`
  widened `ctx: undefined` machines; kept private, the API check would have
  allowed it inside `replay`'s named signature. Snippet 3 sends it back.
- **A snippet can fail today for a reason the change does not fix, and
  vetting cannot tell.** Snippet 1 fails because a literal `{ type: "bump" }`
  in `msgs` widens to `{ type: string }` and `M` is inferred from it, with or
  without `ctx` (snippet 4, which holds `ctx`, fails on HEAD too). Vetting
  marked it "fails, as it should". The builder could never make it hold. Same
  gap as an example that fails for the wrong reason, but a type error says
  less than an assertion. A sibling guard catches it: snippet 4 is snippet 1
  with `ctx` given, marked `holds`; it fails on HEAD, so vetting sends it back
  with the widened `M` in its message. Nothing asks the enricher for such a
  sibling yet.

The check costs 2 s per run on demlik (one `tsc` of one file, one vitest of one
test).

## Run 5 of #558, triage only

`runs/558-5`, demlik at 26d22c9 (origin/main; `packages/tea` as at d2730b1),
`vet_tries = 2` so at most two enricher turns, one Jev sort. 2 min 38 s in all.

| | Run 4 | Run 5 |
|---|---|---|
| Criteria | 7 | 9 |
| Checked | 0 | 8: 5 type (one snippet each), 3 existing tests |
| Unchecked | 7 | 1 (`other`: `replay` hands `init` `{}` when `ctx` is left out) |
| Guards (`holds` today) | none | 3 |
| Lane | parks `unchecked`, 7 rules | parks `unchecked`, 1 rule |

What vetting said, per draft:

| Snippet | Meant | Draft 1 | Draft 2 |
|---|---|---|---|
| a `{}`-satisfied machine replays with only `msgs` | fails today | fails (TS2345) | fails: `{ msgs }` lacks `ctx` |
| `expectFinalState` takes options with no `ctx` | fails today | fails (TS2345) | fails: `ReplayOpts` needs `ctx` |
| guard: a `db` machine still needs `ctx` in `replay` | holds | **broken**: an error outside the marked line | holds: rejected, `ctx` missing |
| guard: the testing helpers still need it | holds | holds | holds |
| guard: `ctx: undefined` still accepted for a pure machine | holds | **fails today** | holds: compiles |
| the how-to's twin, the tutorial's twin, `tutorials-typecheck.test.ts` | pass or fail | pass | pass |

Draft 1's two problems were the literal-`msgs` trap from the probe above:
`[{ type: "bump" }]` widened `M`, so the call failed for a reason the change
does not fix. Here it hit guards, so vetting saw it and said so; the enricher
typed `msgs` as `Msg[]` everywhere in draft 2, the two failing snippets too.
Draft 2 passed and Jev sorted it a feature, p2, worth doing.

No guard for the `ctx: undefined` widening appeared. The enricher wrote the
opposite limit: explicit `ctx: undefined` must stay accepted. A machine typed
`ctx: undefined` that may now omit `ctx` is not asked about, so run 2's
`ReplayCtxArg` would still pass this draft's snippets. The brief asks for
limits the ticket sets, and this one sets none; the report has no pitch with
no-gos yet.

The one unchecked rule is runtime behaviour behind a call that does not
typecheck today: an example of it cannot run before the change. A `compiles`
snippet with a runtime assertion would not help either: types only.

Cost: two enricher turns in one conversation (Opus 5.5 through `claude -p`, 10
assistant messages: 14.8k output tokens, 213k cache reads, 40.8k cache
writes), one Jev sort call, and two vettings, which cost only time. The
enricher's dollar figure is in `claude -p`'s result, and the run does not keep it.

Open: a sibling guard for every snippet that shows the change (the same call
with the change's part put back must hold today), asked of the enricher or
written by code; a way for the builder to contradict a snippet, as it can an
example (`contradiction` names a call today); a `ctx: undefined` guard needs
the ticket, or a person, to say it is a limit; runtime rules behind a type
change; ship's retest after a merge does not run the type snippets and
existing tests on their own.
