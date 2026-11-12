# The checklist

The example program for `next/`, the new version of fabrika. It is small, and it uses the parts a
program has: saved state, a view, refusals, inputs only a person may send, a wake time, a query and
an output. Read [`src/program.ts`](./src/program.ts) beside this page; it is one file.

A program is a pure tea machine plus what it declares. It gets no clock, key, ledger or service.
The runner does the rest: it saves each input before the program sees it, steps the machine, saves
the model, and sends the view to whoever watches.

## What it does

A list of items, each known by its `name` (1 to 80 characters, unique in the list). An item is in
one of four states:

| State | What it means |
|---|---|
| `new` | just added; it has no time yet |
| `open {since}` | waiting since `since`, in milliseconds since 1970 |
| `late {since}` | waiting a day or more |
| `checked {note}` | done; `note` is `null` for now |

| Input | Who may send it | What it does |
|---|---|---|
| `add {name}` | a person | adds a `new` item |
| `rename {name, to}` | a person | gives the item a new name, same state |
| `remove {name}` | a person | takes the item out |
| `check {name}` | a person or an agent | the item is `checked` |
| `uncheck {name}` | a person or an agent | a checked item is `new` again, so it gets a fresh time |

`check` on a checked item, or `uncheck` on one that is not, changes nothing. It is not refused, so
an agent that repeats itself is not told no.

## State is saved for you

You write no storage code. The model is a schema (`Model` in `program.ts`), and the runner saves it
after each step, encoded by that schema. After a restart the runner reads it back and hands it to
`init` as `loaded`; with nothing saved yet, `loaded` is `null` and `init` starts an empty list.

`state: { v: 1, upgrades: [] }` is the saved shape's version. When you change the model's schema
in a way old saved state cannot decode, raise `v` and add a named upgrade that moves the old shape
to the new one.

## `refuse`: saying no before anything changes

`refuse(model, msg)` runs before the step. It answers `null` to let the input in, or
`{ reason }` to turn it away. A refused input changes nothing: not the model, the view or the wake
time. The checklist has two reasons:

- `taken`: `add`, or `rename`'s `to`, names an item that already exists.
- `missing`: `rename`, `remove`, `check` or `uncheck` names an item that does not exist.

A reason is a short word the sender can act on. Who may send an input is not `refuse`'s job: an
input marked `personOnly: true` in `inputs` is refused by the runner when an agent sends it.

## `wake`: time comes in as a message

A program never reads a clock. `wake(model)` says when the program wants to hear the time next, in
milliseconds since 1970, or `null` for never. When that time comes, the runner sends
`{ type: "timer", at }` with its own clock, and the step reads `at`.

The checklist answers:

- `0` while any item is `new`: a time in the past, so the alarm fires at once and the timer stamps
  every new item `open {since: at}`. An input's own `sentAt` is the sender's clock and decides
  nothing, so this is how an item gets a time it can trust.
- else the oldest open item's `since` plus one day (`LATE`): that timer makes it `late`, exactly
  when `at >= since + LATE`.
- else `null`.

## The view, the query and the output

- **View:** `{ items: [{ name, state, note }], left }`, where `state` is the state's word and
  `left` counts the items not checked. A window draws it and a watcher gets it.
- **Query `left`:** a read port. It answers from the view (`view.left`) and changes nothing; it is
  declared in `inputs` with `Input.cases.read.make`.
- **Output `done`:** `finished(model)` is `{ items: [...names] }` once there is at least one item
  and every one is checked, else `null`. It is declared in `outputs`; the runner does not send
  outputs yet.

## The window

`@kampus/checklist/window` exports `checklistWindow`. Its `data` is `checklistView`, the schema
that also types the program's view. The package's main entry stays free of React.

The window shows each item's name, a box and its state in words, the count left and a remove
button. Enter in the add field submits one `add` and clears the field. Its text lives in
`src/tile.ts`, a child tea machine stepped by the window parent. It stays in that tab and is never
saved as a record or shared with another tab. Boxes change only when the checked view arrives.

The registration's `refused` function gives the program's words for `taken` and `missing`, naming
the item. The parent keeps each tile's last refusal until its next press. The field describes that
line, and the page says it once in its polite region. Unknown word reasons use `Not done (reason).`;
free text uses `Not done.`. Keys and editing names arrive in a later slice.

## Its laws

`src/program.laws.test.ts` checks the machine, `refuse`, `wake`, the query and the output over
generated lists of inputs. `src/RunnerTest.ts` runs it at the real runner: who may send what, and a
restart that keeps every item and its time. The app runs that suite over SQLite, in
`next/apps/fabrika/src/checklist-runner.laws.test.ts`.
