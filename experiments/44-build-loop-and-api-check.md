# 44. The build loop on the draft-and-check child, and a published-API check

Not an experiment, a redesign, with one offline measurement. Every step is
one of five moves: **gather** (code looks something up), **draft** (an agent
with free hands), **check** (code judges the output: pass, or problems),
**judge** (Jev, one narrow question), **ask** (park with typed answers).
Gather, draft, check and judge are Effect services behind Cmds; the loops
that combine them are pure child machines a hand-written parent holds with
`applyCell`. There is no general pipeline language. The rule: limit what
comes out, not how the work is done.

**Part 1: the lane's build loop is now a `createRefine` child** (`building`,
Cmds `build_write` and `build_check`). Section 41 kept it apart because the
builder's answers are richer, a failed run is read for whose fault it is, a
try can be given back, and the lane holds review. Here is how each one fits:

| Lane need | Where it went |
|---|---|
| Draft = the builder's whole answer (done, contradiction, blocked, dispute) | The child's draft type is that union |
| A non-change answer ends the run with no check | New in refine: `stopOf(draft, null, brief)`, a pure hook. The run stops as `stopped` with the reason; the lane parks, or sends back a contradiction that names no real example |
| Tests in the folder, the fresh copy, reading a failure | One Check service (`build_check`): folder tests, the published API, the fresh copy. On a failure it calls the failure reader, a Judge inside a Check. Code reads the run; the verdict is data |
| A sure setup or test-file failure parks; an unsure one does what `onUnsure` says | `stopOf(draft, verdict, brief)` again, after the check: the same hook |
| Review needs the diff and snapshot of the change that passed | Refine's `done` keeps the `verdict` that passed it. This replaces `checked: boolean` (`null` = accepted unchecked) |
| One attempt count across review rounds and a person's answers | New in refine: `start` takes `tries`, the count the run's first draft takes. The lane starts a new run in the same conversation for each send-back: on `attempt + 1`, or on `attempt` when a try is given back |
| The policy sees the issue and knobs | `problemsOf` and `stopOf` get the brief as a third argument |
| Review | Stays a separate child of the lane |

What did not fit as the owner first guessed: **giving a try back is not
refine's `more`.** Every give-back in the lane (a withdrawn finding, a fixed
example, an owner's comment) happens after the run has ended. So it is a new
run that starts on the same try number. `more` adds to the limit of a run
that ran out. The lane does not use it either: "out of attempts" keeps its old
shape, and "more" starts a new run.

So refine got one real addition (`stopOf` and the `stopped` phase) and three
one-line ones (`tries` on start, the brief in the policy, the verdict on
`done`). Each is useful to the enricher too: `stopOf` could send a draft that
names an open decision straight to the owner, skipping the vetting run (6.7 s
on demlik); `tries` could keep one vetting budget across the owner's rulings.
Neither is wired yet.

| | Before | After |
|---|---|---|
| `lane.ts` lines (code without comments or blanks) | 821 (591) | 852 (597), of which about 25 code lines are part 2 |
| Lane phases | 11 | 8 (`checking`, `checking_fresh`, `diagnosing` gone) |
| Lane Cmds and their update cells | 5 Cmds (`prepare`, `build`, `check`, `fresh_check`, `diagnose`), 10 build cells | `prepare` + the child's 2, 4 one-line cells |
| `refine.ts` | 196 (137) | 233 (157) |
| `handlers.ts` | 177 | 197 (the checks run in one handler) |
| `factory.ts` | 448 | 504 (the migration) |

The lane is not shorter. It is simpler in shape: three phases and three Cmds
gone, and the whole "what goes back to the builder" rule is two pure
functions, `buildStop` and `buildProblems`, which drive.ts reuses to print a
check. Lane, restart and factory tests pass with renames: Cmd names, `named:
[]` on start, `newExports` in knobs. Two changes are more than renames:

- **A restart during the checks runs all of them again** (folder, API, fresh
  copy), not only the step in flight. They are one Cmd now.
- **A first build killed in flight is asked again as a first build**
  (`continues: false`). The lane used to guess `true`. Both are guesses; the
  builder tries the other way when the guess is wrong, and the conversation
  is the same either way.

Saved runs still read back (`laneWithBuildLoop`). A build in flight becomes
the child writing, with the same feedback. A check in flight, at any of the
old three steps, becomes the child checking again. A `could_not_run` or
`run_failed` park holds the child, so a retry checks again. The real saved
runs `558-1`, `558-2` and `558-3` parse, and resume issues nothing new, as
before.

**Part 2: the published-API check.** In run 2 of #558, the builder dropped
`NoInfer` from `expectCmdEmitted`'s `cmd` to make a bad generated test
compile, and published a new `ReplayCtxArg` type. The check, done by code
(`src/declarations.ts`, `localPublishedApi`):

1. Emit the package's declarations with its own compiler: `tsc --declaration
   --emitDeclarationOnly --removeComments`. This runs once at HEAD in a fresh
   copy (cached per HEAD), and once in the builder's folder.
2. For each export-map entry, read what it publishes by name, with the
   declaration text. The reader follows `export *`, re-exports, aliases and
   imports. It folds in the unexported declarations of the same file that a
   published name refers to, so a change to a private helper type shows up on
   the name that uses it. TypeScript 7 has no compiler API, so a small
   statement reader does this. It works because emitted files are regular.
3. Compare: added, removed and changed names, each with before and after.

The policy is pure, in the reducer (`ruleOnApi`). A changed or removed name is
allowed if the issue names it. "Named" means: names in the criteria's rule
text, the names its examples call and use, and the names the ticket itself
gave. The ticket's names are the facts with `calledIn === null`. Names that
only a doc page's code calls are left out, so a page that uses a helper does
not unlock it. An allowed change is listed for the person who approves. Any
other change or removal goes back to the builder: "you changed X's published
signature; the ticket doesn't name it; put it back, or answer contradiction".
Added names go back too, unless `[lane] new_exports = "listed"`. Names
declared in a file a criterion names are not allowed by that alone, since a
rule about `runtime-types.ts` would then unlock all of it. A comparison that
cannot run (no package, emit failed) is recorded as skipped, never guessed.

**On #558, offline** (`experiments/44-api-probe.ts`): run 2's `builder.diff`
applied to a scratch clone of demlik at d2730b1, against run 3's issue (the
latest enrichment):

| Run-2 change | Result |
|---|---|
| `expectCmdEmitted` drops `NoInfer` on `cmd` (`./testing`) | **Flagged**: changed, not named |
| `ReplayCtxArg` added (`.`) | **Flagged**: added, not named |
| `ReplayOpts` turned from an interface into a type with an optional `ctx` (`./testing`) | **Flagged**: changed, not named |
| `replay` takes `ReplayCtxArg<Ctx> & …` (`.`) | Allowed and listed: `replay` is named |
| `ctx` made optional for a machine typed `ctx: undefined` | **Missed**, see below |

The `undefined` widening is in the branch `[undefined] extends [Ctx] ? { ctx?:
Ctx }` of `ReplayCtxArg`. It was caught here only by luck: the builder
exported the helper type. Had it kept the type private, the text would have
been folded into `replay`'s, which is named, so it would have been allowed and
listed. A name-level check cannot tell the asked change to a signature from
an extra one in the same signature. A negative type test would catch it, a
criterion like "`replay(m, { msgs })` is still a type error for a machine
typed `ctx: undefined`" (a `@ts-expect-error` line). That needs a check for
`type` criteria, which are unchecked today.

Against run 2's own issue, the owner's ruling put the testing helpers in
scope, so the criteria name `expectCmdEmitted`. There the `NoInfer` removal is
allowed and listed, not flagged, for the same reason. Only `ReplayCtxArg` and
`ReplayOpts` go back. The check stops changes to names nobody asked about. It
does not judge changes to names someone did ask about. Those reach the person
who approves, as a list.

Time on demlik's tea package (199 declaration files, 26 export-map entries):
11.2 s for the first check, with HEAD emitted in a fresh copy (worktree,
`pnpm install`, emit). After that, 3.1 s per check with HEAD cached. The
emit alone takes 3.2 s.

Open: per-parameter diffs, so an extra change inside a named signature is
seen. The builder's brief does not mention the rule yet; it learns it from
the first send-back. Saved facts from before section 42 have no `calledIn`,
and `ticketNames` reads a missing one as the report's (done in section 45).
