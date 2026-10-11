# Every stage answers in the same five verbs, spelled one way

Decided 2026-10-11. Built for the ship machine first; the other stages are
still to be checked against it.

```text
passing it on:   verb : who : why        send:builder:checks_red
                                         ask:owner:approval

ending here:     verb : why              done        done:part
                                         skip:closed
                                         stuck:read_failed
```

## What was decided

A stage machine hands back one outcome. Every outcome, from every stage, is
one of five verbs:

| Verb | It means | Who is next |
|---|---|---|
| `done` | The job is finished, wholly or in part. | nobody |
| `send` | Another stage has to do something. | that stage |
| `ask` | A person has to decide or act. | that person |
| `skip` | There is nothing here for this stage to do. | nobody |
| `stuck` | Something could not be read. Stop, never guess. | nobody |

And every outcome has a name written by one grammar:

- `send` and `ask` pass the work to someone, so they say **who**, then **why**.
- `done`, `skip` and `stuck` end here, so they only say **why**.
- The second part of a passing-on name is always who gets it next. It is never
  what is asked, and never why.
- The parts are joined with `:`. The words themselves use `_`
  (`checks_red`), so `_` cannot also be the joint.

## The data is the truth; the name is how it is spelled

```ts
{ kind: "send", to: "builder", why: "checks_red" }   →   "send:builder:checks_red"
{ kind: "ask", who: "owner", for: "approval" }       →   "ask:owner:approval"
{ kind: "done", part: true, commit: "d694f6b" }      →   "done:part"
```

Code does a `switch` on the data. People, logs, the ledger and a drawing of
the machine read the name. One function makes the name from the data, so the
two cannot drift, and the name's pattern is a type, so the compiler refuses a
misspelled one.

A name holds the verb, who and why. It does not hold the rest of the data (a
commit, say), so a name alone is not the whole outcome.

This is the same rule as
[Data first; markdown is a view](./data-first-markdown-is-a-view.md).

## Why

- A parent machine can be written once. It reacts to five verbs, not to each
  stage's own list of endings.
- One line per outcome is easy to log and easy to count
  (`send:builder:*` this week).
- An arrow on a drawing of the machine is a `send` and its `to`. Nothing has
  to be read out of prose.
- It is the usual Elm way for a child to report to its parent (often called
  the OutMsg pattern): a shared type, nothing new in tea.

## What it means for the work

- A new stage machine defines its own `who` and `why` words and nothing else
  about the shape.
- A `why` is a short everyday word. It does not repeat the verb or the stage.
- A stage that seems to need a sixth verb is a finding. Write it down before
  adding one.

## Open, found while building it for ship

Built in `src/stages/outcome.ts` (`outcomesOf`, `nameOf`, `partsOf`). Ship has
21 names. Five things did not sit cleanly:

- **`stuck` is used wider than its meaning.** It is defined as "could not be
  read", but ship also uses it for a write that failed
  (`stuck:enqueue_failed`), a wait that ran out (`stuck:queue_silent`,
  `stuck:checks_stuck`) and a loop that would not settle
  (`stuck:head_moving`). Either the meaning widens to "could not finish and
  cannot say more", or these want a sixth verb.
- **`ask`'s last part is called `for` in the data and "why" in the grammar.**
  One word should win.
- **`done:part` puts a flag where a why goes.** It works, but "part" is not a
  reason.
- **A `skip` names nobody, yet someone may need to be told.** A closed or
  draft pull request ends as `skip`, and the ship design says a person is
  told. The parent has to know that by itself.
- **A name can hide something a reader wants.** A `done` whose tidy-up failed
  still prints as `done`.

## What would change this

Only the ship machine is built. If the build, review or triage machines end
in a way that fits none of the five verbs, or that needs a `who` on an
ending, the grammar changes.
