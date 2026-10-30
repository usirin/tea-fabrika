# Errors are diagnostics, drawn the way rustc draws them

Proposed 2026-10-29.

```ts
// An error is a TaggedError with its facts as fields. It knows how to describe itself
// as a Diagnostic. Drawing is a service: the terminal, a window and an agent each get
// their own drawing of the same data.
class DoesNotFit extends Schema.TaggedError<DoesNotFit>()("DoesNotFit", {
	line: Schema.String,
	from: Stage, // tally, where it sits on the line, what it sends
	to: Stage, // trace, where it sits, what it takes
	senders: Schema.Array(Schema.String), // programs whose output does fit `to`
}) {
	get diagnostic(): Diagnostic { /* below */ }
}
```

```text
error[T0103]: tally's output does not fit trace's input
  |
1 | seq --to 3 | tally | trace
  |              ----- ^ ----- takes: id (a trace id), do
  |              |
  |              sends: total (integer), refused
  |
  = note: nothing tally sends is a trace id
  = help: a program that sends a trace id: runs
  |
1 | runs --ticket 7 | trace
  | ++++++++++++++++
  |
  = for more: explain T0103
Nothing was started.
```

## What is proposed

- **Good errors are how an agent answers well.** An agent reads our errors as
  its only clue to what to do next. Anthropic's guide on writing tools for
  agents says the same: an error should say specifically what to change, not
  give an opaque code. So an error pass is agent work as much as
  people work.
- **An error is data first, text second.** Every error a person or an agent
  can see is an Effect `Schema.TaggedError` with its facts as typed fields:
  the line, the programs, the flag, what was expected. No error is only a
  string. This follows the `_tag` rule: made through `TaggedError`, never by
  hand.
- **Every error describes itself as one `Diagnostic`,** the shape rustc uses:
  a code, one message, labels on places in the line, notes for the why, helps
  for what to do, and fixes. The error class computes it, the same way
  Effect's own `CliError.UnrecognizedOption` computes its `message` from its
  fields. Domain logic stays in the domain object.
- **Drawing is a swappable service,** like Effect's `CliOutput.Formatter`, a
  `Context.Reference` with a default. Three drawings of the same data:
  - **terminal:** the rustc drawing above, with colour, and a compact form
    for a narrow tile;
  - **window:** the same diagnostic drawn in the tile;
  - **agent:** the `Diagnostic` itself as JSON through MCP, as rustc's
    `--error-format=json` gives tools.
- **Help is computed, not written once.** "Did you mean" by edit distance, as
  rustc and Effect's CLI do; the programs whose output fits; the flags a
  program does have. A fix is a whole line a person can take with Tab and an
  agent can use as it is.
- **Every code has an explain page and a snapshot test.** `explain T0103`
  opens the long form with examples, like `rustc --explain`. Each code has a
  saved expected drawing, like rustc's UI tests, so a change to an error shows
  in review. A lint fails when a code has no page or no test.

```ts
// Sketch: the shape, after rustc's Diagnostic. Keys are short words.
type Diagnostic = {
	code: string; // "T0103": T tsh, H host, P a program
	level: "error" | "warning";
	message: string; // one line, names the person's own things
	labels: ReadonlyArray<{at: Span; text: string; main: boolean}>; // main: ^^^, others: ---
	notes: ReadonlyArray<string>; // why
	helps: ReadonlyArray<string>; // what to do
	fixes: ReadonlyArray<{line: string; applies: "safe" | "maybe" | "holes"}>;
};
type Span = {start: number; end: number}; // characters in the line as typed

// rustc's Applicability, in short words: "safe" can be applied with no look
// (MachineApplicable), "maybe" needs a look (MaybeIncorrect), "holes" has parts
// to fill in (HasPlaceholders).
```

```ts
// Sketch: the drawing service, after CliOutput.Formatter.
type Draw = (d: Diagnostic) => string;
const Drawing: Context.Reference<Draw> = Context.Reference("@kampus/fabrika/Drawing", {
	defaultValue: () => terminal({colours: true, width: 80}),
});
// tsh asks for Drawing; the app's tile, a test and the MCP door each provide their own.
```

```json
// What an agent gets through MCP for the line above: the same facts, no parsing.
{"_tag": "DoesNotFit", "code": "T0103",
 "message": "tally's output does not fit trace's input",
 "labels": [{"at": {"start": 19, "end": 20}, "text": "", "main": true},
            {"at": {"start": 13, "end": 18}, "text": "sends: total (integer), refused", "main": false},
            {"at": {"start": 21, "end": 26}, "text": "takes: id (a trace id), do", "main": false}],
 "notes": ["nothing tally sends is a trace id"],
 "helps": ["a program that sends a trace id: runs"],
 "fixes": [{"line": "runs --ticket 7 | trace", "applies": "maybe"}]}
```

## What Effect already gives, and what is ours

Checked in Effect 4.0.6, the version in the catalog.

| Need | Effect | Ours |
|---|---|---|
| Typed errors with fields | `Schema.TaggedError`, `Data.TaggedError` | use as is |
| An error that formats itself from its fields | `effect/cli`'s `CliError` classes: a `message` getter, `suggestions` fields | the same pattern, returning a `Diagnostic` |
| A swappable formatter | `CliOutput.Formatter`, a `Context.Reference` with `formatError` | the same pattern, the `Drawing` service |
| Why a value did not decode | `SchemaIssue`: a tree with paths, and a `Formatter` with leaf and check hooks | turn an issue's path into a label on the flag |
| Many failures at once | `Cause`, with `Cause.pretty` for defects | defects stay `Cause.pretty`; what a person typed wrong gets a `Diagnostic` |
| Did you mean | `effect/cli`'s `suggest`, edit distance, but internal | a small copy of our own until Effect exports it |
| Sending errors on to a tracker or a trace | `ErrorReporter`, with `severity` and `attributes` on the error | report into the job's trace |
| Labels on a line, codes, helps, fixes, the drawing | nothing | the `Diagnostic` shape and its drawings |

- **Why not `effect/cli` itself:** it parses one command's argv. tsh is a shell
  with pipes, programs and inputs; a program's flags are already Effect
  schemas. Its errors' pattern fits; its parser does not.

## Why

- **rustc is the known way.** Its errors are a data structure first
  (rustc dev guide, "Errors and lints"); the drawing, JSON for tools and
  `cargo fix` all read the same data. Elm's compiler made the same turn
  ("Compiler errors for humans", 2015): show the person's own code, point at
  it, say what to do.
- **Effect is what we build on.** Its errors are already tagged data, and its
  CLI shows the self-formatting pattern. We add only what it lacks.
- **One shape, three drawings** means an agent never parses text meant for a
  person, and a person never reads JSON meant for an agent.

## What it costs

- One `Diagnostic` shape and one terminal drawing in `@kampus/fabrika`, about a
  few hundred lines with their tests.
- Moving each area's errors onto it: tsh first, then programs, the host and the
  MCP door, one pull request each. Which errors go first comes from an
  inventory of every error and its text today.
- An explain page and a snapshot per code. That is writing, on purpose.

## Doubts

- **Narrow tiles (70% sure the compact form is enough).** rustc's drawing
  assumes a wide terminal. A tile can be 40 columns. The compact form puts
  labels in a list under the line instead of under the words. Settle it by
  drawing the ten most common errors at 40, 80 and 120 columns.
- **Runtime errors have no line to point at.** "tracker sent ticket down a
  pipe that answered stopped" happens after the line started. The diagnostic
  can point at the line from history; whether that reads well is untested.
- **Codes may be too much.** If codes stay few and nobody types `explain`,
  they are noise. Settle it after the first area moves.

## What would change it

Effect shipping a diagnostic shape of its own: then we use it. Or the
snapshot tests turning into churn nobody reads.

## Sources

- rustc dev guide, errors and lints: https://rustc-dev-guide.rust-lang.org/diagnostics.html
- Elm, compiler errors for humans: https://elm-lang.org/news/compiler-errors-for-humans
- Anthropic, writing effective tools for agents: https://www.anthropic.com/engineering/writing-tools-for-agents
- Command Line Interface Guidelines, errors: https://clig.dev/#errors
- Effect 4.0.6: `effect/cli` `CliError.ts`, `CliOutput.ts`; `SchemaIssue.ts`; `ErrorReporter.ts`
