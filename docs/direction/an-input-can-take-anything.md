# An input can take anything, and says so

**Proposed 2026-10-29.** A program may declare one input that takes any value, with `anyInput`.
A pipe feeds it only when no typed input of the program fits, and then with the source's first
output. Every other input keeps today's fit check, unchanged.

```ts
// programs/trace/src/index.ts
inputs: {
	toggle: input(Toggle, "Open or close a row that groups others."),
	choose: input(Choose, "Show one row's detail, or none with `null`."),
	quit: input(Schema.Null, "Stop."),
	id: input(TraceId, "A job's trace id: its record replaces the one shown, as `runs` sends."),
	any: anyInput("Anything else on a pipe, let go unread: being in the line is enough, as with `pv`."),
},
// main: one handler per input, in the run's one mailbox. `any`'s does nothing.
serve({id: look, any: () => Effect.void, toggle, choose, quit: () => end}, {until: ["toggle", "choose", "quit"]})

// tsh> runs --ticket 7 | trace          runs' id fits trace's id: a typed fit wins
// tsh> seq --to 3 | tally | trace       tally's total fits nothing typed: wired total → any
// tsh> seq --to 3 | upper               refused, as before: upper has no `any`
```

## The answer others already give

| Where | Its "anything" | What it promises |
|---|---|---|
| Elm | `Json.Decode.value` | A value nobody decodes. You can hold it and pass it on, not read it |
| JSON Schema | `{}` | Every value is valid |
| Unix | `pv`, `cat > /dev/null` | Reads whatever comes on stdin. Being in the pipe is the point |
| Unix pipe | fd 1 | `a \| b` carries `a`'s stdout. stderr (fd 2) stays where it was |

So the shape is Elm's and JSON Schema's. The wiring rule is the Unix pipe's.

## How it works

```ts
// packages/fabrika/src/program/shape.ts
export const anyInput = (description: string): Input<unknown, "auto", false> => ({
	...input(Schema.Unknown, description, {writes: false}),
	any: true,
});

export type Fit = "fits" | "takes_any" | "does_not_fit" | "cannot_tell";

fit(seq.outputs.n, trace.inputs.any)       // "takes_any"
fit(runs.outputs.id, trace.inputs.id)      // "fits"
fit(seq.outputs.n, input(Schema.Unknown))  // "does_not_fit": a plain input never takes anything
```

```ts
// packages/fabrika/src/shell/check.ts, wiring one `|`
const typed = pairs.filter((p) => p.fit === "fits");
const fitting = typed.length > 0 ? typed : firstOutput(pairs.filter((p) => p.fit === "takes_any"));
// tally's outputs are [total, refused]: both could go to `any`, total goes, as stdout would
```

- `any: true` is set only by `anyInput`. You cannot get it by writing `input(Schema.Unknown)`. So
  no program takes everything by mistake.
- A typed fit always wins. So `runs | trace` still sends the trace id to `id`.
- `takes_any` only shows up when nothing else fits. If a program has two `anyInput`s and both
  could be fed, that is two ways to wire it, and tsh asks you to name one (`<b`).
- A named wire (`tally >refused | trace`) still works. It sends what you named.
- An `anyInput` is not an MCP tool. An agent has nothing to send it (`toolInputsOf` leaves it
  out, as it leaves out a `personOnly` input).
- It is an ordinary input, not a control one. Its values wait their turn in the run's one
  mailbox, like every other input's, and its handler lets each go. A long stream into it is
  served one value at a time, in order with the window's inputs. It writes no data
  (`{writes: false}`).
- The frame's bottom line says what a pipe can feed (`Shell.fedBy`). For trace that is now
  `takes id, any`: true, since a pipe from anything feeds `any`.
- It is not a window command, so the rule "one input per command, named by its verb" does not
  name it. Like `id`, it is named for what it takes.

## Why a separate input and not a union on `id`

One input could be "an id, or anything" (`Schema.Union([TraceId, Schema.Unknown])`). It was
weighed and dropped:

- A union with `Unknown` is just `Unknown`. The id's type would be gone, `runs | trace` would
  fit by luck, and trace could no longer tell an id from a number.
- Two inputs keep each type exact. `id` is read. `any` is drained and never read. The program's
  definition says which is which, and the wiring picks by fit, as everywhere else.

## Cost

- One optional field on `Input`, one more `Fit` answer, about 20 lines in `check.ts`.
- One rule to learn: "first output goes", as on Unix.

## How sure

About 85% on the shape: it is Elm's and JSON Schema's. About 70% on "first output goes". It depends
on each program declaring its main output first, and nothing checks that. If a program's first
output turns out not to be its main one, the fix is a `main` mark on one output, not a change here.

## What this cannot tell us

- If a second program wants `anyInput`. Today only `trace` has one.
- If people will expect `a | trace` to show `a`'s values. It does not. trace shows the job the
  line runs in, not what flows in the pipe.
