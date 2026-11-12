// T703, next/. The connection's busy state and saved waits are one tea machine (0037, 0046).
// Each walk folds generated choices through the real init and update. Every choice is read against
// the state the fold has reached, so it picks a current wait, a completed one or a reused id (0093).
// The reference is the attachment edit the driver made before this machine: what it saved is what
// the machine must now hold.
import { applyCellChecked } from "@demlik/tea";
import { describe, expect, it } from "@effect/vitest";
import { Schema } from "effect";
import * as fc from "fast-check";
import { expectTypeOf } from "vitest";
import { Attached, Wait } from "../Wire.ts";
import { connection } from "./connection.ts";

const SEED = 119120;
const RUNS = 100;
const MAX_WAITS = 64;
const MAX_BYTES = 16_384;

type Model = ReturnType<typeof connection.init>[0];
type Saved = typeof Attached.Type;
type W = typeof Wait.Type;

type Msg =
  | { readonly type: "observed"; readonly attached: Saved }
  | { readonly type: "started" }
  | { readonly type: "finished" }
  | { readonly type: "waited"; readonly wait: W }
  | { readonly type: "answered"; readonly wait: W };

const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).length;
const same = (a: W, b: W) => a.id === b.id && a.stream === b.stream && a.after === b.after;

/** The named state an attachment stands for: busy lives only in the tag. */
const expected = (saved: Saved | null): unknown => {
  if (saved === null) {
    return { _tag: "unloaded" };
  }

  if (saved._tag !== "online") {
    return { _tag: saved._tag, attached: saved };
  }

  const { client, identity, version, watching, waits, busy } = saved;
  return { _tag: busy ? "busy" : "idle", client, identity, version, watching, waits };
};

/** The attachment a loaded state saves, read from the Model alone. */
const projected = (model: Exclude<Model, { readonly _tag: "unloaded" }>): Saved => {
  if (model._tag === "new" || model._tag === "waiting") {
    return model.attached;
  }

  return Attached.cases.online.make({
    client: model.client,
    identity: model.identity,
    version: model.version,
    waits: model.waits,
    watching: model.watching,
    busy: model._tag === "busy",
  });
};

/** Everything an online state carries except its tag and waits; `null` before hello. */
const metadata = (model: Model) => {
  if (model._tag !== "idle" && model._tag !== "busy") {
    return model._tag === "unloaded" ? null : model.attached;
  }

  const { client, identity, version, watching } = model;
  return { client, identity, version, watching };
};

const held = (model: Model): ReadonlyArray<W> => (model._tag === "idle" || model._tag === "busy" ? model.waits : []);

/** What the driver saved before this machine, for one Msg. `null` is an attachment never read. */
const reference = (saved: Saved | null, msg: Msg): Saved | null => {
  if (msg.type === "observed") {
    return msg.attached;
  }

  if (saved === null || saved._tag !== "online") {
    return saved;
  }

  if (msg.type === "started") {
    return saved.busy ? saved : { ...saved, busy: true };
  }

  if (msg.type === "finished") {
    return saved.busy ? { ...saved, busy: false } : saved;
  }

  const wait = msg.wait;

  if (msg.type === "waited") {
    const next = { ...saved, waits: [...saved.waits, wait] };
    return saved.waits.some((w) => w.id === wait.id) || next.waits.length > MAX_WAITS || bytes(next) > MAX_BYTES
      ? saved
      : next;
  }

  return saved.waits.some((w) => same(w, wait))
    ? { ...saved, waits: saved.waits.filter((w) => w.id !== wait.id) }
    : saved;
};

// Payloads: string and numeric ids, several streams, multibyte text that JSON writes as it is.
// fast-check, not a Schema arbitrary: the walk aims text at the encoded limit and draws ids from
// the folded state, which Wait's and Attached's own arbitraries cannot do.
const units = ["a", "Z", "7", "é", "ß", "€", "流", "😀", "𝄞"];
const text = fc.array(fc.constantFrom(...units), { maxLength: 6 }).map((s) => s.join(""));
const id = fc.oneof(text, fc.integer({ min: -3, max: 80 }));
const streams = ["events", "counter:1/inbox", "ünï/流", "😀"];
const stream = fc.constantFrom(...streams);
const after = fc.nat({ max: 12 });
const identity = fc.record({ key: text, person: text, as: fc.constantFrom("window" as const, "agent" as const) });
const wait = fc.record({ id, stream, after }).map((w) => Wait.make(w));

const hello = fc.record({
  versions: fc.array(fc.integer({ min: 1, max: 4 }), { maxLength: 3 }),
  has: fc.array(text, { maxLength: 3 }),
  ping: text,
  key: text,
  tab: text,
  nonce: text,
  platform: fc.constantFrom("browser" as const, "electron" as const, "headless" as const),
  os: fc.constantFrom("macos" as const, "windows" as const, "linux" as const, "unknown" as const),
  sentAt: text,
  signed: text,
});

const observation = fc.oneof(
  fc.record({ client: text, nonce: text }).map((a) => Attached.cases.new.make(a)),
  fc.record({ client: text, key: text, hello, nonce: text }).map((a) => Attached.cases.waiting.make(a)),
  fc
    .record({
      client: text,
      identity,
      version: fc.integer({ min: 0, max: 9 }),
      waits: fc.uniqueArray(wait, { maxLength: 6, selector: (w) => w.id }),
      watching: fc.boolean(),
      busy: fc.boolean(),
    })
    .map((a) => Attached.cases.online.make(a)),
);

/** One raw choice. The walk turns it into a Msg only after reading the folded state. */
const Choice = fc.record({
  move: fc.nat({ max: 99 }),
  pick: fc.nat(),
  wait,
  observation,
  shift: fc.integer({ min: -2, max: 2 }),
  unit: fc.constantFrom(...units),
});
type Choice = typeof Choice extends fc.Arbitrary<infer A> ? A : never;

/** Walk state: the reference attachment and every wait that was once saved. */
type Fold = { readonly saved: Saved | null; readonly completed: ReadonlyArray<W> };

const online = (fold: Fold) => (fold.saved?._tag === "online" ? fold.saved : null);
const at = <A>(list: ReadonlyArray<A>, pick: number) => list[pick % list.length]!;

/** A stream of exactly `size` UTF-8 bytes, built from `unit` and ASCII padding. */
const sized = (size: number, unit: string) => {
  const width = new TextEncoder().encode(unit).length;
  const count = Math.max(0, Math.floor(size / width) - 1);
  const head = unit.repeat(count);
  return head + "x".repeat(Math.max(0, size - count * width));
};

/** A wait whose candidate attachment lands `shift` bytes off the encoded limit. */
const boundary = (saved: Saved & { readonly _tag: "online" }, choice: Choice): W => {
  const probe = Wait.make({ id: choice.wait.id, stream: "", after: choice.wait.after });
  const space = MAX_BYTES - bytes({ ...saved, waits: [...saved.waits, probe] });
  return Wait.make({ ...probe, stream: sized(Math.max(0, space + choice.shift), choice.unit) });
};

/** Read the fold, then pick a Msg that is possible there, stale or refused. */
const next = (fold: Fold, choice: Choice): Msg => {
  const saved = online(fold);
  const { move, pick } = choice;
  const fresh = Wait.make({ ...choice.wait, id: `${fold.completed.length}:${pick % 1000}`, stream: "s" });

  if (saved !== null && saved.waits.length >= 6 && move >= 3) {
    // A crowded connection mostly keeps adding, so walks reach the 64-wait limit.
    return { type: "waited", wait: fresh };
  }

  if (move < 8 || (fold.saved === null && move < 50)) {
    return { type: "observed", attached: choice.observation };
  }

  if (fold.saved === null) {
    // Nothing read yet: every other Msg is stale.
    return at<Msg>(
      [
        { type: "started" },
        { type: "finished" },
        { type: "waited", wait: choice.wait },
        { type: "answered", wait: choice.wait },
      ],
      move,
    );
  }

  if (move < 22) {
    return { type: move % 2 === 0 ? "started" : "finished" };
  }

  if (move < 34 && saved !== null && saved.waits.length > 0) {
    // A wait the driver still holds.
    return { type: "answered", wait: at(saved.waits, pick) };
  }

  if (move < 40 && fold.completed.length > 0) {
    // A late reply for a wait that may already be answered.
    return { type: "answered", wait: at(fold.completed, pick) };
  }

  if (move < 46 && saved !== null && saved.waits.length > 0) {
    // A reused id on another stream or revision.
    const old = at(saved.waits, pick);
    const other = choice.wait.stream === old.stream && choice.wait.after === old.after;
    return {
      type: move % 2 === 0 ? "answered" : "waited",
      wait: { ...choice.wait, id: old.id, after: other ? old.after + 1 : choice.wait.after },
    };
  }

  if (move < 56 && saved !== null) {
    return { type: "waited", wait: boundary(saved, choice) };
  }

  if (move < 62 && saved !== null && saved.waits.length > 0) {
    // A duplicate of a saved wait.
    return { type: "waited", wait: at(saved.waits, pick) };
  }

  if (move < 66) {
    return { type: "answered", wait: choice.wait };
  }

  return { type: "waited", wait: fresh };
};

/** Fold one walk through the machine, checking each step against the reference. */
const walk = (
  choices: ReadonlyArray<Choice>,
  each: (step: {
    readonly before: Model;
    readonly after: Model;
    readonly msg: Msg;
    readonly from: Saved | null;
    readonly to: Saved | null;
    readonly fold: Fold;
  }) => void = () => {},
) => {
  let [model] = connection.init(null, {});
  expect(model).toEqual({ _tag: "unloaded" });
  let fold: Fold = { saved: null, completed: [] };

  for (const choice of choices) {
    const msg = next(fold, choice);
    const to = reference(fold.saved, msg);
    const [after, cmds] = applyCellChecked(connection, model, msg);
    expect(cmds).toEqual([]);
    expect(after).toEqual(expected(to));

    if (to === fold.saved && msg.type !== "observed") {
      // A refused or stale Msg hands back the same Model, so the driver saves and answers nothing.
      expect(after).toBe(model);
    }

    each({ before: model, after, msg, from: fold.saved, to, fold });
    const kept = to?._tag === "online" ? to.waits : [];
    const gone = fold.saved?._tag === "online" ? fold.saved.waits.filter((w) => !kept.includes(w)) : [];
    fold = { saved: to, completed: [...fold.completed, ...gone, ...(msg.type === "waited" ? [msg.wait] : [])] };
    model = after;
  }

  return model;
};

const Walk = fc.array(Choice, { minLength: 1, maxLength: 160, size: "max" });
const options = { seed: SEED, numRuns: RUNS };

describe("T703 connection machine laws", () => {
  it("type: busy comes only from the state tag, and unauthenticated states hold no waits", () => {
    fc.assert(
      fc.property(fc.constant(null), () => {
        expectTypeOf<Model["_tag"]>().toEqualTypeOf<"unloaded" | "new" | "waiting" | "idle" | "busy">();
        expectTypeOf<Extract<Model, { readonly busy: unknown }>>().toBeNever();
        type Unauthenticated = Extract<Model, { readonly _tag: "unloaded" | "new" | "waiting" }>;
        expectTypeOf<Extract<Unauthenticated, { readonly waits: unknown }>>().toBeNever();
        expectTypeOf<Extract<Model, { readonly _tag: "new" }>["attached"]>().toEqualTypeOf<
          typeof Attached.cases.new.Type
        >();
        expectTypeOf<Extract<Model, { readonly _tag: "waiting" }>["attached"]>().toEqualTypeOf<
          typeof Attached.cases.waiting.Type
        >();
        expectTypeOf<Extract<Model, { readonly _tag: "idle" }>>().not.toHaveProperty("attached");
        expectTypeOf<Extract<Model, { readonly _tag: "busy" }>>().not.toHaveProperty("attached");
        expectTypeOf<Extract<Model, { readonly _tag: "idle" }>["waits"]>().toEqualTypeOf<ReadonlyArray<W>>();
      }),
      { seed: SEED, numRuns: 1 },
    );
  });

  it("every Msg keeps the transition table, the metadata and the unrelated waits", () => {
    const seen = new Set<string>();
    fc.assert(
      fc.property(Walk, (choices) => {
        walk(choices, ({ before, after, msg }) => {
          seen.add(`${before._tag}:${msg.type}:${after === before ? "same" : after._tag}`);
          // Only `observed` may replace the metadata, and a Msg about one wait leaves the others alone.
          const moved = msg.type === "observed" ? before : after;
          expect(metadata(moved)).toEqual(metadata(before));
          const wait = "wait" in msg ? msg.wait : undefined;
          const unrelated = (w: W) => wait === undefined || w.id !== wait.id;
          expect(held(moved).filter(unrelated)).toEqual(held(before).filter(unrelated));
        });
      }),
      options,
    );

    // Every row of the plan's table, reached by some walk.
    for (const row of [
      "unloaded:observed:new",
      "unloaded:started:same",
      "new:observed:waiting",
      "waiting:observed:idle",
      "idle:observed:busy",
      "idle:started:busy",
      "busy:started:same",
      "busy:finished:idle",
      "idle:finished:same",
      "idle:waited:idle",
      "busy:waited:busy",
      "idle:waited:same",
      "busy:answered:busy",
      "idle:answered:same",
      "new:waited:same",
      "waiting:answered:same",
      "new:finished:same",
    ]) {
      expect(seen, row).toContain(row);
    }
  });

  it("wait admission keeps the duplicate id, 64-wait and encoded-byte limits", () => {
    const sides = new Set<string>();
    fc.assert(
      fc.property(Walk, (choices) => {
        walk(choices, ({ before, after, msg, from }) => {
          if (msg.type !== "waited" || from?._tag !== "online") {
            return;
          }

          const candidate = { ...from, waits: [...from.waits, msg.wait] };
          const accepted = after !== before;
          const size = bytes(candidate);
          const duplicate = from.waits.some((w) => w.id === msg.wait.id);
          expect(accepted).toBe(!duplicate && candidate.waits.length <= MAX_WAITS && size <= MAX_BYTES);

          if (!duplicate && candidate.waits.length <= MAX_WAITS) {
            sides.add(`bytes:${size <= MAX_BYTES}`);

            if (Math.abs(size - MAX_BYTES) <= 1) {
              sides.add(`edge:${size - MAX_BYTES}`);
            }

            if (msg.wait.stream.length !== new TextEncoder().encode(msg.wait.stream).length) {
              sides.add(`multibyte:${size <= MAX_BYTES}`);
            }
          }

          if (!duplicate && size <= MAX_BYTES) {
            sides.add(`count:${candidate.waits.length <= MAX_WAITS}`);
          }

          if (duplicate) {
            sides.add(`duplicate:${typeof msg.wait.id}`);
          }
        });
      }),
      options,
    );

    for (const side of [
      "bytes:true",
      "bytes:false",
      "edge:-1",
      "edge:0",
      "edge:1",
      "multibyte:true",
      "multibyte:false",
      "count:true",
      "count:false",
      "duplicate:string",
      "duplicate:number",
    ]) {
      expect(sides, side).toContain(side);
    }
  });

  it("a reply removes only a currently matching wait, and never answers twice", () => {
    const seen = new Set<string>();
    fc.assert(
      fc.property(Walk, (choices) => {
        walk(choices, ({ before, after, msg, from, fold }) => {
          if (msg.type !== "answered" || from?._tag !== "online") {
            return;
          }

          const matching = from.waits.some((w) => same(w, msg.wait));
          const answered = after !== before;
          expect(answered).toBe(matching);
          const left = held(after);
          expect(left.some((w) => w.id === msg.wait.id)).toBe(
            !matching && from.waits.some((w) => w.id === msg.wait.id),
          );

          if (answered) {
            // The same reply again finds nothing left to answer.
            const [again] = applyCellChecked(connection, after, msg);
            expect(again).toBe(after);
          }

          const reused = from.waits.some((w) => w.id === msg.wait.id) && !matching;
          const late = fold.completed.some((w) => same(w, msg.wait)) && !matching;
          seen.add(matching ? "matching" : reused ? "reused" : late ? "late" : "absent");
          seen.add(`id:${typeof msg.wait.id}:${answered}`);
        });
      }),
      options,
    );

    for (const side of [
      "matching",
      "reused",
      "late",
      "absent",
      "id:string:true",
      "id:number:true",
      "id:string:false",
    ]) {
      expect(seen, side).toContain(side);
    }
  });

  it("saving and restoring keeps every loaded state and the rest of the walk", () => {
    const restored = new Set<string>();
    fc.assert(
      fc.property(Walk, fc.nat(), (choices, point) => {
        const cut = point % (choices.length + 1);
        const model = walk(choices.slice(0, cut));

        if (model._tag === "unloaded") {
          return;
        }

        // The attachment is the durable copy: JSON out, decoded back, observed by a fresh machine.
        const saved = Schema.decodeUnknownSync(Attached)(JSON.parse(JSON.stringify(projected(model))));
        const [fresh] = connection.init(null, {});
        const [back] = applyCellChecked(connection, fresh, { type: "observed", attached: saved });
        expect(back).toEqual(model);
        restored.add(model._tag);
        let left = back;
        let right = model;
        let fold: Fold = { saved, completed: [] };

        for (const choice of choices.slice(cut)) {
          const msg = next(fold, choice);
          [left] = applyCellChecked(connection, left, msg);
          [right] = applyCellChecked(connection, right, msg);
          expect(left).toEqual(right);
          fold = { saved: reference(fold.saved, msg), completed: fold.completed };
        }
      }),
      options,
    );

    for (const tag of ["new", "waiting", "idle", "busy"]) {
      expect(restored, tag).toContain(tag);
    }
  });
});
