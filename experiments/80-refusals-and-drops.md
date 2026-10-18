# 80. A program defineProgram did not make, and values a run never read

Code and tests only: no agent, no GitHub, $0.

```ts
// Before: an object with a program's fields ran, skipping defineProgram's checks.
start({...echo, name: ""}, {})              // ran main
// After: refused by the types for a hand-built object, and at start for a spread copy.
start({...echo, name: ""}, {})              // dies: was not made by defineProgram

// Before: a run's end said nothing of what was still on its inputs.
yield* run.ended                            // {kind: "ended"}, 4 values gone
// After: the end counts them, per input.
yield* run.ended                            // {kind: "ended", unread: {word: 4}}
```

## What was asked

Two of the four details the #657 harvest marked "worth taking", tested in
tea-program on its own terms (#657 is a source of cases, not a spec):

- **Row 20.** `start` runs a program object that never went through
  `defineProgram`, so its refusals (a blank name or description, a kind with
  no status line, a parent that is no machine of the program) can be skipped.
  Make it impossible, not warned.
- **Row 27.** When a run ends, the values still waiting on an `auto` input are
  thrown away without a word. Decide what a run's end does with them.
- The tiny one from row 2: a test that a branded schema is refused.

## What was found

**Row 20, reproduced.** A plain object with a blank name, a blank description
and the fields of a real program ran its `main` through `start`, `call` and
`pipe` (`src/program/defined.test.ts`, three tests red before the fix). The
type `Program` was a plain interface, so the compiler took it too. No test or
program in the repo built one by hand: the fix changed **0** existing tests.
Four of tsh's programs (`build-scripted`, `review-scripted`, `ship-sandbox`
and the read-only ship) are made with `defineProgram({...other, ...})`, which
stays the way to make one program from another.

**Row 27, reproduced.** A program that reads one word and returns, told five:
its listeners heard one, its end said `{kind: "ended"}`, and four values were
gone. tsh then said `[1] lazy ended: it had nothing left to do`, or, with an
input closed, `it finished all it held`, which was false.

**A second drop, inside the read.** `main` read each input with
`Stream.fromQueue`, which takes *every* value on the line at each pull. The
four values above were not on the line when the run ended; they were in the
chunk `main` had taken and never got to. Counting the line with that read
says **0 unread** for that run (measured: the first test in
`src/program/unread.test.ts` fails with `unread: {}` on the old read). So a
count is only true if `main` takes one value at a time.

**What one-at-a-time reading changed.** One existing test moved: ship told
each of five pull requests twice in a row. With the whole line taken at once,
the second copy always found the first still on ship's kept queue, which
holds one, and was dropped with no answer: 11 outcomes for 16 tells. Read one
at a time, ship finishes the first before it reads the second, which is then
answered from what ship kept: 16 outcomes for 16 tells, 10 of 10 runs. Reads
and writes are the same either way (each pull request read once, queued once).
The test now waits for the run's end instead of counting outcomes, and asserts
`unread: {}`.

**Branded schemas.** tea-program already has the rule: `ShapeSchema<T>` is
`Codec<T, T>`, so `Schema.String.pipe(Schema.brand("Url"))` (out
`string & Brand<"Url">`, in `string`) does not compile. Past the types it is
only the check under it: Effect's `brand` adds no runtime step, so the value
passes as it came. The test is in `src/program/shape.test.ts`.

## The decisions

**1. A program comes from `defineProgram` or it does not run.**
`src/program/program.ts`.

- In the types: `Program` carries a mark keyed by a `unique symbol` that is
  never exported, and `defineProgram` alone returns one. An object built by
  hand is not a `Program`, so `start`, `call`, `pipe` and `listing` refuse it
  at compile time. `Definition` leaves the mark out, so
  `defineProgram({...other, name})` still compiles.
- At run time: a spread copy keeps the type's mark, so the types cannot catch
  `start({...echo, name: ""})`. `defineProgram` puts each program it returns
  in a module `WeakSet`; `start` and `call` die before anything runs for one
  not in it, and `pipe` dies before it opens a writer on the receiver, so a
  refused sender never holds the receiver's input open.
- Prior art: Effect's own values carry a `TypeId` symbol and Effect's `Brand`
  is a type-only mark; a `WeakSet` of the objects a factory made is the same
  trick as `writers` here (only `pipe` can open a writer). Confidence **85%**.

**2. A run's end names what it never read, per input. It does not keep it.**
`src/program/program.ts`, `src/program/trace.ts`, `src/tsh/execute.ts`.

- `Ended` carries `unread`: each input with values still on its line, and how
  many. `{}` is a run that read everything it was told. Every end has it:
  ended, stopped, failed.
- `main` reads each input one value per pull (`Stream.fromEffectRepeat` of
  `Queue.take`), so what it has not asked for stays on the line and the end
  counts it. A value `main` has taken and is working on is the one it holds,
  as `close` already says ("the value main holds is finished").
- The count is taken in the same turn that shuts the lines, so no tell lands
  between them. A tell after it answers `stopped`, as before.
- The run's span gets one `unread <input>` event per input, with the count
  under `tea.input.unread`.
- tsh says it: a foreground line prints `tsh: lazy ended with 5 told on n
  never read`; a job's end says `it stopped reading, with 3 told on n never
  read` and never "finished all it held". The exit status does not change:
  a reader that stops early is not a failure in a shell either.
- Prior art: Elm has no run end and no answer here. Erlang drops a dead
  process's mailbox without a word, and Unix drops unread pipe bytes when the
  reader exits; both leave reliability to the sender (links, acks, SIGPIPE).
  Akka counts what it could not deliver and logs it as dead letters. AMQP can
  keep it, in a dead-letter exchange. We take Akka's: name the count. Keeping
  the values would be a second, durable queue with nobody to read it, and the
  way to not lose a value already exists: a `manual` input, whose sender keeps
  it until it is acked (75d). Confidence **80%**.

**The link to 75d's rec 4 (host tells have no ack).** Unchanged, and now
visible. A host's tell into a `manual` input has nobody holding it; if `main`
never reads it, the end now counts it (the third test in
`src/program/unread.test.ts`). It does not bring it back. A value a pipe sent
into a `manual` input is counted the same, though its sender still holds it
and sends it again at its next start; the count says "this run never read
it", not "it is lost".

## Recommendations

1. **Keep one-at-a-time reads.** They make the count true and they bound what
   `main` holds to one value. The cost is the behavior change above: a burst
   is no longer swallowed into one chunk, so repeats are answered instead of
   dropped in the queue. That is closer to "every tell gets an answer".
   **75%.** Doubt: a program that relied on batch reads for speed; none in
   this repo does. A timing run of a 10,000-value burst would settle it.
2. **Put `unread` on the run record too**, so `jobs` and an `attach` after a
   restart can say it. Left out here to keep this change off `storage.ts`,
   which experiment 79 is changing. **60%.**
3. **Mark `flag`, `input` and `output` the same way.** A hand-built
   `{shape, description: ""}` still gets past `described`, and a hand-built
   shape can claim any check. Same trick, three more constructors. **70%.**
4. **A spread copy across two copies of the package** would be refused: the
   `WeakSet` lives in one module. Effect solves the same with
   `Symbol.for` keys. Matters only once tea-program is a published package
   that can be installed twice. **50%**, revisit at formalization.
5. **Allow brands on a shape?** A brand adds no runtime step, so a branded
   input still "only checks"; refusing it costs a nominal type on `main`'s
   values (a `Url` instead of a `string`). The rule stays for now, since
   `Codec<T, T>` is what keeps transforms out. **55%** that we want to let
   brands through later; a real program that needs one would settle it.

## Numbers

- Tests: 1544 before, **1556** after (5 for row 20, 5 for row 27, 1 tsh, 1
  brand). 28 assertions on `Ended` gained `unread: {}`; one ship test was
  reworked to wait on the run's end.
- Gates: typecheck, lint, and the suite twice, green.
