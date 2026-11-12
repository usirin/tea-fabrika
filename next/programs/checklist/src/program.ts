// The checklist, next/: the example program that uses every part of a program (0125). A pure tea
// machine and its declarations, on P11's `Program.make` until ticket 302 moves it to the decided
// shape. Time comes in only as the runner's `timer {at}`, never from a clock here.
import { Machine } from "@demlik/tea/effect";
import { Input, Program, type Refusal } from "@kampus/libfabrika";
import { Schema } from "effect";

/** How long an open item waits before it is late: one day. A constant until a pack's settings
 *  reach a program (P40 slice 3, P38 slice 5); then it is the pack's `checklist.late`. */
export const LATE = 86_400_000;

const Name = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(80));

/** The checked wire view, shared by the program and its window. */
export const checklistView = Schema.Struct({
  items: Schema.Array(
    Schema.Struct({
      name: Name,
      state: Schema.Literals(["new", "open", "late", "checked"]),
      note: Schema.NullOr(Schema.String),
    }),
  ),
  left: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
});

/** The longest note an agent may leave on `check`: 256 characters, as a client's text in a brain
 *  line (libfabrika's processes/internal/processTable.ts). A schema wall, as `Name`'s 80 is. */
export const NOTE_MOST = 256;

const Note = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(NOTE_MOST));

/** An item's control state (0037). `since` is ms since 1970, from a timer's `at`. */
const ItemState = Schema.TaggedUnion({
  new: {},
  open: { since: Schema.Int },
  late: { since: Schema.Int },
  checked: { note: Schema.NullOr(Schema.String) },
});
type ItemState = typeof ItemState.Type;

const Item = Schema.Struct({ name: Name, state: ItemState });
type Item = typeof Item.Type;

const Model = Schema.Struct({ items: Schema.Array(Item) });
type Model = typeof Model.Type;

const Msg = Schema.Union([
  Schema.Struct({ type: Schema.Literal("add"), name: Name }),
  Schema.Struct({ type: Schema.Literal("rename"), name: Name, to: Name }),
  Schema.Struct({ type: Schema.Literal("remove"), name: Name }),
  Schema.Struct({ type: Schema.Literal("check"), name: Name, note: Schema.optionalKey(Note) }),
  Schema.Struct({ type: Schema.Literal("uncheck"), name: Name }),
  // Only the runner sends it, when the alarm `wake` asked for fires.
  Schema.Struct({ type: Schema.Literal("timer"), at: Schema.Int }),
]);
type Msg = typeof Msg.Type;

/** What the checklist hands on once every item is checked. */
export const Done = Schema.Struct({ items: Schema.Array(Name) });
export type Done = typeof Done.Type;

const fresh: ItemState = ItemState.cases.new.make({});

const each = (m: Model, name: string, f: (state: ItemState) => ItemState): Model => ({
  items: m.items.map((i) => (i.name === name ? { name, state: f(i.state) } : i)),
});

/** A timer stamps a new item with the referee's time, and makes an open one late once due. */
const tick = (state: ItemState, at: number): ItemState =>
  state._tag === "new"
    ? ItemState.cases.open.make({ since: at })
    : state._tag === "open" && at >= state.since + LATE
      ? ItemState.cases.late.make({ since: state.since })
      : state;

export const checklistMachine = Machine.make({
  model: Model,
  msg: Msg,
  cmds: [],
  init: (loaded) => [loaded ?? { items: [] }, []],
  update: {
    add: (m, msg) => [{ items: [...m.items, { name: msg.name, state: fresh }] }, []],
    rename: (m, msg) => [{ items: m.items.map((i) => (i.name === msg.name ? { ...i, name: msg.to } : i)) }, []],
    remove: (m, msg) => [{ items: m.items.filter((i) => i.name !== msg.name) }, []],
    check: (m, msg) => [
      each(m, msg.name, (s) => (s._tag === "checked" ? s : ItemState.cases.checked.make({ note: msg.note ?? null }))),
      [],
    ],
    uncheck: (m, msg) => [each(m, msg.name, (s) => (s._tag === "checked" ? fresh : s)), []],
    timer: (m, msg) => [{ items: m.items.map((i) => ({ name: i.name, state: tick(i.state, msg.at) })) }, []],
  },
});

const open = (i: Item) => i.state._tag !== "checked";

/** `taken` when the new name exists, `missing` when the named item does not. */
const refuse = (m: Model, msg: Msg): Refusal | null => {
  const has = (name: string) => m.items.some((i) => i.name === name);

  if (msg.type === "timer") {
    return null;
  }

  if (msg.type === "add") {
    return has(msg.name) ? { reason: "taken" } : null;
  }

  if (msg.type === "rename") {
    return !has(msg.name) ? { reason: "missing" } : has(msg.to) ? { reason: "taken" } : null;
  }

  return has(msg.name) ? null : { reason: "missing" };
};

/** 0 while an item has no time yet, so the alarm fires at once and stamps it; else when the oldest
 *  open item goes late; null when none waits. */
const wake = (m: Model): number | null => {
  if (m.items.some((i) => i.state._tag === "new")) {
    return 0;
  }

  const since = m.items.flatMap((i) => (i.state._tag === "open" ? [i.state.since] : []));
  return since.length === 0 ? null : Math.min(...since) + LATE;
};

/** A `Done` once there is an item and every one is checked, else null. */
export const finished = (m: Model): Done | null =>
  m.items.length > 0 && m.items.every((i) => i.state._tag === "checked")
    ? Done.make({ items: m.items.map((i) => i.name) })
    : null;

const shown = (i: Item) => ({
  name: i.name,
  state: i.state._tag,
  note: i.state._tag === "checked" ? i.state.note : null,
});

/** The view's type is its schema's, so the window's decoder and the read ports cannot drift. */
type View = typeof checklistView.Type;

export const checklist = Program.make({
  name: "fabrika/checklist",
  machine: checklistMachine,
  state: { v: 1, upgrades: [] },
  view: (m): View => ({ items: m.items.map(shown), left: m.items.filter(open).length }),
  refuse,
  inputs: {
    add: { description: "Add an item", personOnly: true },
    rename: { description: "Rename an item", personOnly: true },
    remove: { description: "Remove an item", personOnly: true },
    check: "Check the item called `name`, with an optional short `note`; a checked item keeps its first note",
    uncheck: "Uncheck the item called `name`",
    left: Input.cases.read.make({
      schema: Schema.Null,
      description: "How many items are left",
      answer: (view: View) => view.left,
    }),
    items: Input.cases.read.make({
      schema: Schema.Null,
      description: "Every item: its name, its state and its note",
      answer: (view: View) => view.items,
    }),
  },
  outputs: { done: Done },
  writes: {},
  wake,
});
