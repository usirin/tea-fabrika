# 87. Given, When, Then: a language hidden in our moves?

Gherkin writes a test as Given (the world), When (something happens), Then
(what must be true). Our moves are Gather, Act, Listen, Draft, Check and Judge.
Is Gherkin just our moves in other words? And if it is, does writing criteria
as scenarios help on real tickets?

**Answer: mostly yes for the words, no for the runner.** Every Gherkin step
in four real tickets mapped to a move we already have, plus one thing that is
not a move: handing the code a fake service. No new primitive is needed.
Scenarios written from the issue text alone went red before each fix and green
after it. But the glue was not shared between tickets at all, and for tea the
same checks read better as plain vitest. Confidence 80% (the mapping), 75%
(the runner).

## How it was done

Four closed tickets in kamp-us/demlik, each with a merged fix:

| Ticket | Package | Kind | Base | Merge |
|---|---|---|---|---|
| 709 move apply drops the import extension | structure-sweep | bug | `bb5d563` | `4f6eb70` |
| 692 done() and result() before the terminal save | tea | bug | `e608bdd` | `854e0dc` |
| 631 define a Cmd from plain Effect schemas | tea | feature | `9915b2e` | `f4d0c71` |
| 686 report a test that loads the whole app | code-graph | feature | `8d2276c` | `752bfd1` |

The base is the merge commit's first parent. For each ticket:

1. A user story and scenarios in a `.feature` file, from the issue text and its
   recorded ruling only. The fix's diff was not read while writing them.
2. Glue (`steps.ts`) written against the base commit's code. Each scenario is
   tagged `@change` (must be red at base) or `@guard` (green at both).
3. `87-scenarios.ts` copies the folder into the package in a scratch worktree,
   runs it at base and at merge with quickpickle (Gherkin for vitest), and
   writes `results/87-scenarios.json`.

Every step is registered through `lib/moves.ts`: `Given("act", ...)`,
`When("listen", ...)`, `Then("check", ...)`. So each step says which move it
is, and a Then must answer a list of problems, empty for a pass.

## Q1. The mapping

81 step definitions across the four tickets:

```
Given act       12   write a scratch world: a repo, files, a store
Given provide    7   hand the code a fake service or a defined Cmd
When act        18   the user does it: run the command, dispatch, apply
When listen      3   the world moves on its own: a Sub fires, a save lands
Then check      41   read the world, then a pure check
Then judge       0
```

Where it does not fit:

- **Given is not Gather.** The obvious guess was Given = Gather. In practice a
  Given *makes* the world (an Act on a scratch folder) or *provides* a fake
  (an interpret table, a slow store). Providing is not one of our moves. It is
  the program's wiring: Elm's flags and simulated effects, Effect's Layer.
  7 of 19 Givens were this.
- **Then is two moves.** Every Then reads something (git log, a file, the
  JSON report, `getState()`) and then judges it purely. That is a Gather
  followed by a Check. Gherkin fuses them into one word.
- **When is two moves.** "I apply the plan" is an Act. "the final save lands"
  is a Listen: nothing is done, the step waits for the world. Gherkin has one
  word for both.
- **Draft has no word.** No scenario writes a draft. **Judge was never
  needed:** every criterion in these four tickets had a concrete answer.
  Prose criteria (docs, a changeset) were left out, not forced into steps.
- **Repetition and time are not steps.** "Three runs", "both engines",
  "during the save" became Examples rows. The timing lives in the glue (a
  store that takes 50 ms), not in the text.
- **Compile-time criteria are awkward.** 631 says "refused when compiled".
  That became a DocString holding TypeScript source and a tsc run whose errors
  must sit on the marked lines and no others. It works, but it is a `checkRun`
  dressed as a scenario.

**The Elm answer** is elm-program-test, and it splits the same way. Given is
`ProgramTest.createElement ... |> withSimulatedEffects ... |> start`: init
plus fake effects, so "provide" is there too and is not a message. When is
`simulateDomEvent`, `simulateIncomingPort`, `simulateHttpOk`,
`advanceTime`: user input (Act) and the outside world arriving (Listen). Then
is `expectModel`, `expectView`, `expectLastEffect`: read, then assert. Elm
adds no new primitive for any of it.

**Verdict: Given/When/Then is a sequence over moves we have. No new
primitive. Confidence 80%.**

## Q2. Red at base, green at merge

All 35 scenarios, final glue, one run of `87-scenarios.ts`:

```
            @change (red at base, green at merge)   @guard (green at both)
709         3 of 3                                  1 of 1
692         12 of 12                                6 of 6
631         5 of 5                                  none
686         7 of 7                                  1 of 1
total       27 of 27                                8 of 8
```

Why each base red failed:

- **709:** real. `app/src/barrel.ts names "./core/format", without .ts`. The
  type-position `import("../reviewer.ts")` was dropped too.
- **692:** real. `result()` said `{"phase":"over"}` while the save was still in
  flight, the store still held `working` when `done()` resolved, and on a failed
  save `done()` never settled.
- **631:** shallow. All 5 failed because `@demlik/tea/effect` had no `Cmd`
  export, either at the step or as TS2305. The red says only "the export is
  new".
- **686:** shallow. All 7 failed because the base gate refuses the unknown key
  `compositionRoots`.

It took three corrections to get there. Each one is a real finding:

- **Wrong label (692).** Two rows, "done() asked before the end", were tagged
  `@change` and passed at base. The issue's own repro says that case already
  worked. The red run caught the label, and the rows moved to a `@guard`
  outline.
- **Green for the wrong reason (686).** The two "refused rules file" rows
  passed at base: exit 2, one error line naming `compositionRoots`. They passed
  because the old gate refuses any unknown key. A step was added: the line must
  also name the reason (`testFiles`, or the bad glob). Now they are red at base
  for the right reason and green at merge.
- **Wrong glue (631).** At merge, "saw the same Msgs both times" failed. Each
  settled Msg carries `at`, the clock time it settled, and the glue compared
  that too. It was fixed in the glue, not the scenario. Fixing it meant reading
  the merged code's Msg shape.

Two lessons. For a bug, a base red is strong evidence, because it fails on the
behaviour. For a feature, a base red is cheap and says little, because it fails
on "this name does not exist yet". The merge green carries the weight there.
And the base run is worth doing anyway: it caught one wrong label and one pass
for the wrong reason.

**Verdict: yes, scenarios from the issue text alone run red then green on all
four tickets. Confidence 85%. For features, red at base proves little
(confidence 70%).**

## Q3. Is the glue honest?

The question: could a builder make each scenario pass without building the
behaviour?

- **709: hard to fake.** Always appending `.ts` fails the `.js` row and the
  Bundler guard. The specifiers must also exist on disk, tsc must pass, and a
  second apply must add no commit.
- **692: one real hole.** The store's save always takes 50 ms. A builder that
  made `done()` and `result()` wait a fixed 100 ms after the end would pass
  every timing row. Only the failed-save row would catch it, because a sleep
  does not reject. The fix is cheap: an Examples column with two delays, such
  as 5 ms and 300 ms. Not done here.
- **631: honest, with one over-claim.** Passing needs a real `Cmd.define` that
  wraps both schemas and refuses two-sided ones at compile time.
  `and no other` stops the trivial pass: without the export, every line errors
  and nothing is "refused for a reason". But the title says "every runner
  takes it with no cast", and the glue checks only the Effect `run` and
  `drive`.
- **686: honest after the fix above, with one over-claim.** The counts are
  exact: 123 rows, 120 of them at the first file. "The plain view prints one
  line per test" checks one line, not one per test.

What the move wrapper caught: nothing in these runs. A Then that answers no
problems list fails ("checks nothing"), but TypeScript already refuses that in
typed glue. It would only matter for untyped glue.

The real gap is that **the step text is not the check**. A step's words can
promise more than its glue does, and no tool compares the two. Two of 81 steps
did that here, and both were found by reading.

Glue size, code lines only (no blanks, no comments, after `pnpm format`):

```
lib/moves.ts                     60
lib/common.ts                   123
709 steps.ts                    140
692 steps.ts                    207
631 steps.ts                    283
686 steps.ts                    266
vitest config                    14
total                          1093   (lib: 183, 17%)
```

Reuse across tickets was **zero at the step level**. No step ran in more than
one ticket. Four lib steps ran at all: three tsc steps (631) and "it exits"
(686). The other five lib steps (a scratch folder, write a file, run a command,
and two checks on them) were written in advance and never used. 709 reused lib
*functions* (`git`, `scratchRepo`, `typecheck`), not steps. Each ticket needs
its own world. A shell-level step library does not carry over between a file
mover, a run's lifecycle, a type API and a lint gate.

**Verdict: mostly honest, one timing hole, two over-claims, 0% step reuse.
Confidence 75%.**

## Q4. Against plain vitest

Each fix PR shipped its own vitest tests, and they had the same shape. 692's
`terminal-save.test.ts` has an `it.each` over engines with a three-run loop.
686's `test-reach.test.ts` has a `describe` per idea: "lists the 123 tests",
"is off without compositionRoots", "two routes, two entries". The issue
criteria were already written as observable outcomes, so the plain tests read
almost like the scenario titles.

```
            fix PR's new test lines    feature steps + glue code lines
                (all lines)            (plus a share of lib's 183)
709         148                        19 + 140
692         276                        27 + 207
631         537                        20 + 283
686         366                        50 + 266
```

The scenarios are not shorter, and the fix tests cover more ground.

What Gherkin cost:

- **Types are lost at the step boundary.** Arguments arrive as `unknown`, the
  world is a bag of strings (`need(world, "rules")`), and 631's glue needs 10
  `as never` casts to drive a typed machine.
- **Compile-time checks get worse.** In vitest, `expectTypeOf` and
  `// @ts-expect-error` sit next to the code. Here they became a tsc run over a
  DocString and a "marked lines" convention.
- **The tool has traps.** In a Cucumber expression `/` means "or" and `()`
  means optional, so `@demlik/tea/effect` and `done()` must be escaped. A
  second tagged Examples block was dropped without a word. The default step
  timeout is 3 s. And a module exporting `then` is a thenable, which hung
  vitest's setup import with no message.
- **Two files per test**, and a failure points at the feature line, not the
  glue.

What it gave:

- The text was written before any glue, from the issue alone. That forced each
  outcome to be observable and each scenario to be labelled change or guard.
  But that is the red/green discipline, not Gherkin. A plain test file with
  the same tags would get the same benefit.
- Examples tables read well for repetition. `it.each` does the same.
- The move labels on steps made the Q1 count possible.

For tea (692, 631): plain vitest is the better fit. The types matter, and
Effect's test helpers (`drive`, scoped runs) are code, not sentences.

**Verdict: keep Given/When/Then as the shape of a criterion's text, with an
example table where it repeats. Run it as plain vitest. Confidence 75%.**

## Q5. Cost

- **Runs:** $0. No model, no Jev, no key. One full run of all eight sides
  (four tickets at base and merge, each with an offline `pnpm install`) took
  37 to 39 s over three runs, and all three gave the same 35 results.
- **Writing:** about two hours of one agent's time, no sub-agents. Most of it
  went on glue and on the quickpickle traps above, not on the scenarios. The
  token count of the session was not measured.

## Q6. A typed step library

Not built. Q1 says the words map onto our moves, but Q3 found no step shared
between tickets, and Q4 says the runner should be vitest. A library would only
rename what `lib/moves.ts` already does inside this folder.

## What this cannot tell

- Four tickets, all from one repo, all with criteria already rewritten as
  observable outcomes by triage. Rougher issue text might map worse.
- One writer wrote the scenarios and the glue. The glue was written against
  the base code, so its author knew the APIs. A builder who sees only the
  scenarios might read them differently.
- The 631 glue was fixed after reading the merged code's Msg shape. The
  scenario text did not change, but it was not fully blind from then on.
- Nobody tried to fake a pass. The holes in Q3 come from reading, not from an
  adversary.

## Next experiment

The cheapest fake per ticket: for each `@change` scenario, have an agent
write the smallest change to the base commit that turns it green without the
behaviour, then see whether the guards or the fix PR's own tests catch it.
That measures glue honesty directly, and checks whether the 692 timing hole is
real. Run it with the plain vitest form of the same criteria too, to compare.

## Failures, plainly

- The first full run of `87-scenarios.ts` died at once: npm climbed to the
  repo's `package.json` and stopped at `catalog:`. The cache folder now gets
  its own `package.json`.
- vitest's JSON report keeps only the stack of a quickpickle failure, not the
  message. The second full run recorded no reasons. The step wrapper now logs
  each failure with its scenario.
- One edit to a glue file went through a script, not the editor tool, against
  this repo's rule. The result was checked by the runs above.
