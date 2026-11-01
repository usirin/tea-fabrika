# Elm first

Decided before this repo started; it comes with `@demlik/tea`, which is the Elm
architecture in TypeScript.

## What was decided

Before adding any new shape (a plugin, a pipeline builder, a composition
helper, an interface), say what Elm does for the same need. If Elm solves it
with plain functions, do that. Anything bigger needs a reason written down.

## What it means for the work

- **Parents are written by hand.** A parent machine holds its children's state
  and steps each one with the child's own `update`. There is no pipeline
  language that wires stages together inside tea; tsh lines are the one named
  exception (changed 2026-10-28, below).
- **The machine sees only typed answers.** An agent's free text never drives a
  step; it is turned into a typed value first, by code or by a narrow question.
- **Limit outputs, not process.** An agent is free in how it works and tightly
  limited in what it may hand back.
- A one-shot action is a Cmd. Something that stays open (a wait for checks, a
  wait for a reply) is a Sub. Two clocks at once is two entries in the list of
  Subs, not a new abstraction.
- **tea stays as close to Elm as it can** (2026-10-14). A new idea gets a new
  name, so it never clashes with what an Elm word means. tea is Elm;
  tea-program is ours, and its words come from programs and Unix, not from Elm.
- **No late-bound dispatch** (2026-10-17). No slot that holds the runtime so a
  callback can send to it later. An agent run inside a machine is a Sub, since
  it keeps talking, and each tool call that changes something arrives as a Msg
  when it happens.

## Why

Earlier work spent many rounds designing composition layers that plain
functions already covered. Naming the Elm answer first stops that early.

## Changed 2026-10-28: exceptions are named, with their reason

Elm's guidelines are the default, everywhere. A place that does not follow
them is allowed only when it is named here with its reason, the way a
`// oxlint-disable-next-line` carries its reason on the line.

```ts
// The shape of an exception: what, and why Elm's answer does not fit there.
type Exception = {what: string; why: string; status: "decided" | "proposed"};
```

- **tsh lines are a small language** (decided). "There is no pipeline
  language" stays true inside tea and its programs: parents are written by
  hand. A person at a shell still needs to type one line that wires programs
  together, and tsh's lines are that language. Following Elm strictly is what
  made tsh possible: each program has typed inputs and outputs, so a pipe is
  just wiring, checked before anything runs.
- **The factory is not a line** (decided 2026-10-29). The factory is one thin
  coordinator program, a hand-written parent around the stage programs, with
  its children listed as jobs under it.
  [Experiment 168](../../experiments/168-the-factory-is-one-line.md) explored
  `tracker | triage | plan | build | review | ship` as the factory; it ran, and
  it was an exploration, not a plan. What stays is that each stage is a program
  that runs alone and pipes, so a person can run one part again by hand
  (`build --ticket 7 | review`) and watch it.

## Decided 2026-10-30: UI state lives in tea machines

Every piece of state a window keeps lives in a tea machine, even state that
belongs to one component: a draft comment, a picked row, a drag. A window
uses `useMachine` from `@demlik/tea/react`, never React's `useState`.

```tsx
// A sketch. A comment box: the draft is a machine, not a useState.
const Draft = machine({
	init: {text: "", sending: false},
	update: (m, msg) =>
		msg.type === "typed" ? {...m, text: msg.text}
		: msg.type === "send" ? [{...m, sending: true}, postComment(m.text)]
		: msg.type === "sent" ? {text: "", sending: false}
		: m,
});
const [draft, dispatch] = useMachine(Draft);
// "typed" -> {text: "looks good", sending: false}; "send" -> sending: true, a Cmd out
```

- **Why:** `useState` is a loose function; a machine gives every change a
  name, a typed Msg and one `update`. Agents follow that structure well,
  every change can be watched, and a machine's laws can check it.
- **Cost:** a few more lines per component. Today about 7 `useState` calls
  remain, in the tracker and ticket windows and the frame.
- **Manti's own parts** keep their Zag.js machines inside
  ([UI on Manti](./ui-on-manti.md)). What our code keeps never lives in them.
  Proposed.
