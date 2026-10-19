# Data first; markdown is a view

Decided 2026-10-11. How the data and its markdown view live together on GitHub
is still open (see the end).

## What was decided

Today's fabrika keeps what it knows as prose in markdown: a ticket's body, a
review verdict, a ruling, a skill. To know anything, something has to read the
prose.

Here every shape the pipeline works with is **data with a schema first**: a
ticket, a criterion, a review finding, a verdict, a ruling, a stage's answer.
Markdown is a view made from that data, for people to read. Nothing reads the
markdown back to find out what is true.

```ts
// The data. This is the truth.
const Criterion = Schema.Struct({
  id: Schema.String,                                    // "c2"
  text: Schema.String,                                  // what must hold
  deliveredBy: Schema.NullOr(Schema.String),            // the pull request that landed it, or null
});

const Ticket = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  type: Schema.Literals(["bug", "feature", "chore", "decision"]),
  criteria: Schema.Array(Criterion),
  owed: Schema.Literals(["nothing", "a_ruling", "an_owner_act"]),
});
type Ticket = typeof Ticket.Type;

// The view. Made from the data, never read back.
const toMarkdown = (t: Ticket): string =>
  [`# ${t.title}`, "", ...t.criteria.map((c) => `- [${c.deliveredBy ? "x" : " "}] ${c.text}`)].join("\n");
```

"What is left on this ticket?" stops being a reading task:

```ts
const left = ticket.criteria.filter((c) => c.deliveredBy === null);
```

## Why

- **Prose needs a reader, and a reader is an agent.** A fact held as data is
  read by code, for free, the same way every time. This is the same move as
  the rest of the experiment (see [Control lives in code](./control-in-code.md)),
  applied to what the pipeline knows instead of what it does.
- **It closes real gaps.** A ticket's criteria are checkboxes in a body today,
  and nothing ticks one when a part of the ticket lands, so nothing can say
  what is left. With a criterion as data, a landing writes `deliveredBy`.
- **It removes a whole kind of work.** Finding out why 500 reviews failed
  meant fetching their verdicts and sorting the prose with a classifier
  ([experiment 54](../../experiments/README.md)). With a finding as data, that
  is a query.
- **It makes the ledger portable.** A local ledger stores these shapes as they
  are. The GitHub ledger stores them and also shows the view. See
  [The ledger sits behind a service](./ledger-behind-a-service.md).

## What it means for the work

- Design the schema of a thing before its wording. If a stage needs a fact,
  the fact gets a field.
- An agent's answer is already typed (a Draft has an output schema). The same
  now holds for what the pipeline stores and what it shows.
- A markdown file or comment the pipeline writes is produced by a function
  from data. Hand-written markdown that the pipeline later has to read is a
  sign a schema is missing.
- This repo already does it in places: a criterion is data in `src/issue.ts`
  (a rule with the calls or snippets that check it), and a review finding
  carries a file, a line and a quote. Those are the pattern to follow.

## Open

- **Where the data lives on GitHub.** In the issue body beside the view, in a
  comment, in a file in the repository, or only in the ledger with the issue
  as a pure view.
- **What happens when a person edits the view by hand.** If markdown is only a
  view, a hand edit is either lost on the next render or has to be read back
  into data, which is the thing this note says not to do. People still need a
  way to change a ticket.

## The schema library: Effect Schema

Settled 2026-10-11. Schemas are written in Effect Schema.

`@demlik/tea` takes any [Standard Schema](https://standardschema.dev), so
nothing in the library ties this repo to zod. An Effect schema is not a
Standard Schema until it is wrapped with `Schema.toStandardSchemaV1`.
`defineCmd` in `src/schema.ts` does that wrapping, and the six moves go through
it, so no caller writes it:

```ts
import { Schema } from "effect";
import { act, gather } from "./primitives.ts";
import { defineCmd } from "./schema.ts";

// tea's `Cmd.define`, from Effect schemas. The same Cmd comes out.
const readTicket = defineCmd("ticket_read", {
  input: Schema.Struct({ id: Schema.String }),
  ok: Ticket,
  err: ["unknown"],
});

// A move, the same way. An Act adds its `intent` field to the struct itself.
const makeTree = act("tree_make", { input: Schema.Struct({ name: Schema.String }), ok: Schema.Null, err: ["unknown"] });

// Until the repo is off zod a slot takes a zod schema too, so a Cmd can move one schema at a time.
// A sketch: the zod `At` stays as it is while `PrState` becomes an Effect schema.
const readPr = gather("lane_pr", { input: At.extend({ pr: z.string() }), ok: PrState, err: ["unknown"] });
```

The same proposal for tea itself is
[kamp-us/demlik#631](https://github.com/kamp-us/demlik/issues/631). This repo
carries the local copy first. *2026-10-13: tea's own version was ruled on that
issue to be `Cmd.define` in tea's Effect entry, not `defineCmd`. The tea
release pinned here does not have it yet; once it does, the local `defineCmd`
gives way to it.*

### Where the move stands

The three places that were not mechanical are written:

| Place | Its Effect Schema form |
|---|---|
| `act` adds an `intent` field | `Schema.fieldsAssign({ intent: Schema.String })(input)` |
| `createJudge` builds its answer | `Schema.Struct({ choice: Schema.Literals(choices), confidence: Schema.Finite })` |
| A Draft's output goes to the agent as JSON Schema | `jsonSchema(output)` for the agent and `reader(output)` for its answer, both in `src/schema.ts` |

The two tree Cmds in `src/turn.ts` are the first moved, as the worked example.
Everything else is still zod: about 580 `z.…(` calls in 22 files. New code uses
Effect Schema. Old code moves when it is touched, or in one pass.

A Cmd can mix the two libraries, one slot each. A schema cannot: a zod schema
does not nest inside an Effect struct. So the order of a full move follows
which file's schemas sit inside which:

```ts
// 1. On their own, any time:        ship.ts, comments.ts, combos.ts, refine.ts
// 2. The operator, as one pass:     fabrika.ts, then the rest of turn.ts
// 3. The lane, leaves first:        issue.ts, surface.ts, facts.ts, vetting.ts
//    then what nests them:          review.ts, lane.ts, claude.ts, tracker.ts, replay.ts, ...
// 4. The files that parse, last:    settings.ts, replay-run.ts, local.ts (defaults and a transform)
```

### What Effect Schema asks that zod did not

Each line below was found by running it; `src/schema.test.ts` holds the tests.

```ts
// A Cmd's schema has the same type on both sides. This one turns a string into a number:
defineCmd("count", { input: Id, ok: Schema.Struct({ n: Schema.FiniteFromString }), err: [] }); // does not compile
// Its type side does fit: it checks `{ n: number }`, the value the machine holds.
defineCmd("count", { input: Id, ok: Schema.toType(Schema.Struct({ n: Schema.FiniteFromString })), err: [] });

z.number();                 // is Schema.Finite. Schema.Number lets NaN and Infinity in.
z.enum(["a", "b"]);         // is Schema.Literals(["a", "b"]). Schema.Literal takes one value.
z.array(z.string());        // is Schema.Array(Schema.String), and its type is readonly.
type Ticket = typeof Ticket.Type; // is z.infer<typeof Ticket>
```

- **Why both sides must match.** tea types a handler's answer by the type the
  schema hands on, and checks that answer as the type the schema takes in.
  With a schema that changes the type, a handler that returns what its type
  says gets `malformed_result` every time. The same is true of a zod
  `.transform` today. So `defineCmd` does not compile such a schema. It costs a
  brand too, which also needs `Schema.toType`.
- **tea checks synchronously.** A schema that needs a service to answer does
  not compile. One that needs a Promise does compile, and is refused when the
  Cmd settles, with tea's own `AsyncSchemaError`. In the test `drive` that ends
  the drive. On the live engine the error goes to the error sink and the Cmd
  never settles, so the machine waits.
- **A wrong answer looks the same.** `malformed_result` still carries a path
  and a message per field. Only the wording is the library's: `Expected string`
  where zod said `Invalid input: expected string, received number`.

### The JSON Schema an agent is handed

Claude Code checks the schema strictly before the first turn, and the run dies
there if it does not pass. It refuses zod's `$schema` line, and it refuses the
document Effect hands back as it comes:

```ts
Schema.toJsonSchemaDocument(ShellEnd);
// { dialect: "draft-2020-12", schema: { type: "object", ... }, definitions: {} }   refused: unknown keyword "dialect"

jsonSchema(ShellEnd); // src/schema.ts: the inner schema, closed, with any shared parts under `$defs`
// { type: "object", properties: { token: { type: "string" }, pr: { anyOf: [{ type: "string" }, { type: "null" }] } },
//   required: ["token", "pr"], additionalProperties: false }                        accepted
```

A Draft may use a schema whose two sides differ, because there outside data
does come in: the agent's JSON is read through the schema's JSON codec, the
one the JSON Schema describes. Use `Schema.Finite` for an answer's numbers.
`Schema.Number` adds the strings `"NaN"` and `"Infinity"` to what the agent may
write.

How this was checked, at no cost: `query` from the Agent SDK was run with each
schema as `outputFormat`, the API address pointed at a closed local port and a
key that is not a key. A refused schema ends with `--json-schema is not a valid
JSON Schema`. An accepted one gets as far as `Connection refused`.

**What this cannot tell us.** No agent has answered against an Effect-made
schema yet. The check above is Claude Code's check of the schema, not a model
filling it in. The first live Draft with an Effect schema should be watched.
About 85% sure it behaves as the zod one did: the two differ only in how "or
null" is spelled (`anyOf` against a list of types).
