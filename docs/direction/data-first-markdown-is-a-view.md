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
  type: Schema.Literal("bug", "feature", "chore", "decision"),
  criteria: Schema.Array(Criterion),
  owed: Schema.Literal("nothing", "a_ruling", "an_owner_act"),
});

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
- **Which schema library.** The decision names Effect Schema. The repo's
  schemas are zod today, because `@demlik/tea`'s commands take zod. Moving is a
  separate, mechanical piece of work to size.
