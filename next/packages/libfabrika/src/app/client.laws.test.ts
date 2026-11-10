// P14, next/ (Tier 1, ticket 286): the program client's rules, p1 and p3 and the counter folds, as
// properties on one tea machine (plan A5 and A7, decision 0046). Written before `app/client.ts`'s
// `clientMachineFor`, `app/window.ts` and `app/patch.ts#applyPatch` (docs/plan/ticket-115.md p1, p3;
// the plan's "Shared client data" and "Checked views"). The modules load by `import()` inside each
// test, so a missing one is a red test and not a file that cannot be collected.
//
// The shape these laws hold the modules to, from the plan's sketches (the build may add more):
// - `clientMachineFor(checks)` (app/client.ts, A7): a machine factory. It returns one tea machine
//   whose Model is `Client` and whose `init(null)` is the empty client: no pending letter, `written`
//   0, `seen` 0, no view. `checks` is `{decode?: (pid) => (view) => unknown}`, each program's own
//   decoder by pid, captured by the factory: never in the Model, a Msg or a Cmd's input.
// - `press {pid, m}`: reserves slot `n = written` as `{_tag: "dating", n, pid, m, seen, viewRev}` with
//   the view revision shown for `pid` (0 if none) and `seen`; `written` grows by one.
// - `dated {n, letter, sentAt}`: the slot `n` becomes `{_tag: "ready", ..., letter, sentAt}`. No slot,
//   or a slot already ready, changes nothing: a second answer cannot rewrite a letter.
// - `reply {letter, answer}`: `answer` is `Sent` (accepted or refused), or `{_tag: "unreachable"}` or
//   `{_tag: "unknown"}`. Only a matching accepted or refused answer removes that one letter.
// - `read {rev}`: raises `seen` to `rev`, never lowers it, and moves no letter.
// - `notice {pid, note}`: one view notification, checked with `checks.decode(pid)` (any JSON view when
//   there is none). It moves no letter. When the client wants a whole view it asks the machine's one
//   Cmd, `ask {pid}`, and nothing else; otherwise it asks nothing.
// - `outbox(c)` (app/client.ts, a read of the Model): the ready letters in slot order, each with the
//   letter id it first got.
// - `applyPatch(before, ops)`: an Effect `Result` of the next value; it never changes `before`.
// - `ClientRecord` and `failureRecord(error)` (app/window.ts): a record row holds ids, numbers and
//   fixed words only.
import { applyCell } from "@demlik/tea";
import { Machine } from "@demlik/tea/effect";
import { propertyTrace } from "@demlik/tea/pbt";
import { describe, expect, it } from "@effect/vitest";
import { Effect, Result, Schema } from "effect";
import * as fc from "fast-check";
import { diff } from "./patch.ts";

const SEED = 119120;
const LOAD = "./client.ts";
const WINDOW = "./window.ts";
const PATCH = "./patch.ts";
const RUNS = 300;
const SENT_AT = "2026-11-09T00:00:00.000Z";

type Letter = string;

type Pending = {
  readonly _tag: "dating" | "ready";
  readonly n: number;
  readonly pid: string;
  readonly m: unknown;
  readonly seen: number;
  readonly viewRev: number;
  readonly letter?: Letter;
  readonly sentAt?: string;
};

type Client = {
  readonly written: number;
  readonly seen: number;
  readonly pending: ReadonlyArray<Pending>;
  readonly views: Readonly<Record<string, { readonly rev: number; readonly view: unknown }>>;
};

type Answer = { readonly _tag: string; readonly [key: string]: unknown };

type Notice = { readonly type: "notice"; readonly pid: string; readonly note: unknown };

/** The client's Msgs these laws draw. */
type ClientMsg =
  | { readonly type: "press"; readonly pid: string; readonly m: unknown }
  | { readonly type: "dated"; readonly n: number; readonly letter: Letter; readonly sentAt: string }
  | { readonly type: "reply"; readonly letter: Letter; readonly answer: Answer }
  | { readonly type: "read"; readonly rev: number }
  | Notice;

type Cmd = { readonly type: string; readonly [key: string]: unknown };

type Step = {
  readonly prev: Client;
  readonly msg: ClientMsg;
  readonly next: Client;
  readonly cmds: ReadonlyArray<Cmd>;
};

type Update = (s: Client, m: ClientMsg) => readonly [Client, ReadonlyArray<Cmd>];

interface ClientMachine {
  readonly init: (loaded: Client | null, ctx: object) => readonly [Client, ReadonlyArray<Cmd>];
  readonly update: Readonly<Record<string, Update>>;
}

/** What a client checks a view with (A7): each program's own decoder, by pid. */
type Checks = { readonly decode?: (pid: string) => (view: unknown) => unknown };

/** What the machine laws run on: the real factory and its read, or a planted copy of either. */
interface MachineApi {
  readonly clientMachineFor: (checks: Checks) => ClientMachine;
  readonly outbox: (c: Client) => ReadonlyArray<Pending>;
}

interface WindowApi {
  readonly failureRecord: (error: unknown) => unknown;
  readonly ClientRecord: Schema.Top;
}

interface PatchApi {
  readonly applyPatch: (before: unknown, ops: ReadonlyArray<unknown>) => Result.Result<unknown, unknown>;
}

const patching = async (): Promise<PatchApi> => (await import(PATCH)) as PatchApi;

const windowing = async (): Promise<WindowApi> => {
  const api = (await import(WINDOW)) as Partial<WindowApi>;
  expect(api.failureRecord, "app/window.ts exports failureRecord").toBeTypeOf("function");
  expect(api.ClientRecord, "app/window.ts exports ClientRecord").toBeDefined();
  return api as WindowApi;
};

const machine = async (): Promise<MachineApi> => {
  const api = (await import(LOAD)) as Partial<MachineApi>;
  expect(api.clientMachineFor, "app/client.ts exports the factory clientMachineFor").toBeTypeOf("function");
  expect(api.outbox, "app/client.ts keeps outbox, a read of the Model").toBeTypeOf("function");
  return api as MachineApi;
};

/** The real factory with one Msg's step of every machine it makes rewired: a plant's one break. */
const rewired = (api: MachineApi, type: ClientMsg["type"], wrap: (real: Update) => Update): MachineApi => ({
  ...api,
  clientMachineFor: (checks) => {
    const made = api.clientMachineFor(checks);
    const real = made.update[type];
    expect(real, `clientMachineFor's machine has a ${type} step`).toBeTypeOf("function");
    return { ...made, update: { ...made.update, [type]: wrap(real as Update) } };
  },
});

/** The real machine with one Msg's step post-processed: a plant's one break. */
const planted = (
  api: MachineApi,
  type: ClientMsg["type"],
  change: (out: readonly [Client, ReadonlyArray<Cmd>], s: Client, m: ClientMsg) => Client,
): MachineApi =>
  rewired(api, type, (real) => (s, m) => {
    const out = real(s, m);
    return [change(out, s, m), out[1]];
  });

/**
 * Folds one fixed list of Msgs through the machine with tea's own runner, from its real `init`
 * (or a saved `loaded` Model), and hands back the steps and the final Model. A step that throws
 * fails the run, so a law that folds junk proves it never throws.
 */
const stepped = (
  m: ClientMachine,
  list: ReadonlyArray<ClientMsg>,
  loaded?: Client,
): { readonly steps: ReadonlyArray<Step>; readonly final: Client } => {
  let out: { steps: ReadonlyArray<Step>; final: Client } | undefined;
  propertyTrace(
    m as never,
    {} as never,
    fc.constant(list) as never,
    ((steps: ReadonlyArray<Step>, final: Client) => {
      out = { steps, final };
      return null;
    }) as never,
    {
      numRuns: 1,
      failOnUndeclaredCmd: true,
      ...(loaded === undefined ? {} : { loaded: loaded as never }),
    },
  );

  if (out === undefined) {
    throw new Error("the fold of a fixed list never ran");
  }

  return out;
};

const notice = (pid: string, note: unknown): Notice => ({ type: "notice", pid, note });

/** Whether a notice step asked for a whole view. It asks nothing, or the one Cmd `ask {pid}` for its
 *  own pid and nothing more: the decoder never rides in a Cmd. */
const asks = (step: Step | undefined): boolean => {
  expect(step, "the fold reached this step").toBeDefined();
  const { msg, cmds } = step as Step;

  if (cmds.length === 0) {
    return false;
  }

  expect(cmds, "a notice asks at most one whole view, for its own pid").toEqual([
    { type: "ask", pid: (msg as Notice).pid },
  ]);
  return true;
};

// --- p1: a letter is never lost -----------------------------------------------------------------

const PIDS = ["process_a", "process_b"] as const;

type Op =
  | { readonly op: "press"; readonly pid: string; readonly m: { type: string } }
  | { readonly op: "dated"; readonly slot: number; readonly dup: boolean }
  | { readonly op: "reply"; readonly nth: number; readonly kind: string }
  | { readonly op: "read"; readonly rev: number }
  | { readonly op: "notice"; readonly pid: string; readonly note: unknown };

/** View notes for p1: wholes, patches at any revision, and junk. None of them may move a letter. */
const p1Notes = fc.oneof(
  fc.record({
    type: fc.constant("whole"),
    rev: fc.nat(9),
    view: fc.record({ count: fc.integer({ min: -5, max: 5 }) }),
  }),
  fc.record({
    type: fc.constant("patch"),
    base: fc.nat(9),
    rev: fc.nat(10),
    patch: fc.constant([{ op: "replace", path: "/count", value: 1 }]),
  }),
  fc.jsonValue(),
);

/** Blind events: the same presses, dating answers and replies as before A5, plus reads and (A7)
 *  view notices. The lists grew by ten so the old events keep their reach. */
const ops = fc.array(
  fc.oneof(
    {
      weight: 4,
      arbitrary: fc.record({
        op: fc.constant("press" as const),
        pid: fc.constantFrom(...PIDS),
        m: fc.record({ type: fc.constantFrom("inc", "dec", "reset") }),
      }),
    },
    {
      weight: 4,
      arbitrary: fc.record({
        op: fc.constant("dated" as const),
        slot: fc.nat(12),
        dup: fc.boolean(),
      }),
    },
    {
      weight: 5,
      arbitrary: fc.record({
        op: fc.constant("reply" as const),
        nth: fc.nat(12),
        kind: fc.constantFrom("accepted", "refused", "unreachable", "unknown"),
      }),
    },
    {
      weight: 2,
      arbitrary: fc.record({ op: fc.constant("read" as const), rev: fc.nat(40) }),
    },
    {
      weight: 2,
      arbitrary: fc.record({
        op: fc.constant("notice" as const),
        pid: fc.constantFrom(...PIDS),
        note: p1Notes,
      }),
    },
  ) as fc.Arbitrary<Op>,
  { minLength: 1, maxLength: 70 },
);

const answerFor = (kind: string): Answer =>
  kind === "accepted"
    ? { _tag: "accepted", rev: 1, pos: 1 }
    : kind === "refused"
      ? { _tag: "refused", reason: "bad_msg" }
      : { _tag: kind };

/**
 * Turns blind events into the client's Msgs with an independent model, not the machine: a dating
 * answer carries a fresh letter id for its slot every time (so a second answer would rewrite, if
 * the machine let it), and a reply names the `nth` letter the model has out, or one never sent.
 */
const toMsgs = (list: ReadonlyArray<Op>): ReadonlyArray<ClientMsg> => {
  const model: Array<{ n: number; letter: Letter | null }> = [];
  let written = 0;
  return list.map((o, i): ClientMsg => {
    if (o.op === "press") {
      model.push({ n: written++, letter: null });
      return { type: "press", pid: o.pid, m: o.m };
    }

    if (o.op === "read") {
      return { type: "read", rev: o.rev };
    }

    if (o.op === "notice") {
      return notice(o.pid, o.note);
    }

    if (o.op === "dated") {
      const letter = `letter_${i}_${o.slot}`;
      const slot = model.find((x) => x.n === o.slot);

      if (slot !== undefined && slot.letter === null) {
        slot.letter = letter;
      }

      return { type: "dated", n: o.slot, letter, sentAt: SENT_AT };
    }

    const live = model.filter((x) => x.letter !== null);
    const hit = live.length === 0 ? undefined : live[o.nth % live.length];

    if (hit !== undefined && (o.kind === "accepted" || o.kind === "refused")) {
      model.splice(model.indexOf(hit), 1);
    }

    return { type: "reply", letter: hit?.letter ?? "letter_never_sent", answer: answerFor(o.kind) };
  });
};

const msgs = ops.map(toMsgs);

/** The p1 law over one run's steps, against an independent model of slots by number. */
const lettersKept = (api: MachineApi, steps: ReadonlyArray<Step>): string | null => {
  const model: Array<{ n: number; letter: Letter | null; pid: string; m: unknown }> = [];
  const first = new Map<number, Letter>();
  let presses = 0;
  let seen = 0;

  for (const { prev, msg, next } of steps) {
    if (msg.type === "press") {
      const n = presses++;
      model.push({ n, letter: null, pid: msg.pid, m: msg.m });
      // A press keeps what this client showed and had read when it was made.
      const slot = next.pending.find((p) => p.n === n);
      const want = { viewRev: prev.views[msg.pid]?.rev ?? 0, seen: prev.seen };

      if (slot?.viewRev !== want.viewRev || slot.seen !== want.seen) {
        return `press: slot ${n} captured ${JSON.stringify(slot)}, it showed ${JSON.stringify(want)}`;
      }
    } else if (msg.type === "notice") {
      // A view notice moves no letter: the model stays as it was.
    } else if (msg.type === "dated") {
      const slot = model.find((x) => x.n === msg.n);

      if (slot !== undefined && slot.letter === null) {
        slot.letter = msg.letter;
        first.set(slot.n, msg.letter);
      }
    } else if (msg.type === "read") {
      seen = Math.max(seen, msg.rev);
    } else if (msg.answer._tag === "accepted" || msg.answer._tag === "refused") {
      const at = model.findIndex((x) => x.letter === msg.letter);

      if (at >= 0) {
        model.splice(at, 1);
      }
    }

    // After every step: the pending slots are the model's, in slot order, nothing lost.
    const got = {
      n: next.pending.map((p) => p.n),
      pid: next.pending.map((p) => p.pid),
      m: next.pending.map((p) => p.m),
      letter: next.pending.map((p) => p.letter ?? null),
      written: next.written,
      seen: next.seen,
      outbox: api.outbox(next).map((p) => p.letter),
    };
    const want = {
      n: model.map((x) => x.n),
      pid: model.map((x) => x.pid),
      m: model.map((x) => x.m),
      letter: model.map((x) => x.letter),
      // Written counts presses, and a read never moves a letter.
      written: presses,
      seen,
      // A dated letter keeps its first id: a resend twice is the same letters.
      outbox: model.filter((x) => x.letter !== null).map((x) => x.letter),
    };

    if (JSON.stringify(got) !== JSON.stringify(want)) {
      return `${msg.type}: the client holds ${JSON.stringify(got)}, the model ${JSON.stringify(want)}`;
    }

    for (const p of next.pending) {
      if (p.letter !== undefined && p.letter !== first.get(p.n)) {
        return `${msg.type}: slot ${p.n} has letter ${p.letter}, first dated as ${first.get(p.n)}`;
      }
    }

    const once = JSON.stringify(api.outbox(next));
    const twice = JSON.stringify(api.outbox(next));

    if (once !== twice) {
      return "the outbox reads differently twice on one Model";
    }
  }

  return null;
};

/** p1 is not about the decoder: its machine checks no view beyond JSON. */
const P1_CHECKS: Checks = {};

const p1 = (api: MachineApi) =>
  propertyTrace(
    api.clientMachineFor(P1_CHECKS) as never,
    {} as never,
    msgs as never,
    ((steps: ReadonlyArray<Step>) => lettersKept(api, steps)) as never,
    { seed: SEED, numRuns: RUNS },
  );

describe("p1: a letter is never lost (clientMachineFor)", () => {
  it("only a matching terminal answer removes a letter; written grows per press; ids never repeat", async () => {
    const api = await machine();
    const [empty] = api.clientMachineFor(P1_CHECKS).init(null, {});
    expect(empty).toEqual({ written: 0, seen: 0, pending: [], views: {} });
    p1(api);
  });

  it("good thing: the runs leave a ready letter, settle one, keep a dating slot, and every drawn Msg acts", async () => {
    const api = await machine();
    let ready = 0,
      settled = 0,
      dating = 0;
    const run = propertyTrace(
      api.clientMachineFor(P1_CHECKS) as never,
      {} as never,
      msgs as never,
      ((steps: ReadonlyArray<Step>, final: Client) => {
        for (const { prev, msg, next } of steps) {
          if (msg.type === "reply" && next.pending.length < prev.pending.length) {
            settled++;
          }
        }

        ready += final.pending.filter((p) => p._tag === "ready").length;
        dating += final.pending.filter((p) => p._tag === "dating").length;
        return null;
      }) as never,
      { seed: SEED, numRuns: RUNS },
    );
    expect({ ready: ready > 0, settled: settled > 0, dating: dating > 0 }).toEqual({
      ready: true,
      settled: true,
      dating: true,
    });

    for (const type of ["press", "dated", "reply", "read", "notice"]) {
      expect(run.msgCounts.get(type)?.acted ?? 0, `${type} acted`).toBeGreaterThan(0);
    }
  });

  // Plant (p1): clear the queue on any reply; allocate a new letter on resend. Each plant wraps the
  // real machine's step (or its read) with one break, and the law above must fail on it.
  it("plant: a client that clears the queue on any reply is caught", async () => {
    const api = await machine();
    expect(() => p1(planted(api, "reply", ([c]) => ({ ...c, pending: [] })))).toThrow();
  });
  it("plant: a client that gives a resent letter a new id is caught", async () => {
    const api = await machine();
    expect(() =>
      p1(
        planted(api, "dated", ([c]) => ({
          ...c,
          pending: c.pending.map((p) => (p.letter === undefined ? p : { ...p, letter: `${p.letter}!` })),
        })),
      ),
    ).toThrow();
    expect(() =>
      p1({ ...api, outbox: (c) => api.outbox(c).map((p) => ({ ...p, letter: `${p.letter}-again` })) }),
    ).toThrow();
  });
  it("plant: a read that moves a letter or lowers what was read is caught", async () => {
    const api = await machine();
    expect(() =>
      p1(planted(api, "read", ([c], _s, m) => ({ ...c, seen: m.type === "read" ? m.rev : c.seen }))),
    ).toThrow();
    expect(() => p1(planted(api, "read", ([c]) => ({ ...c, pending: c.pending.slice(1) })))).toThrow();
  });
  it("plant: a notice that moves a letter is caught", async () => {
    const api = await machine();
    expect(() => p1(planted(api, "notice", ([c]) => ({ ...c, pending: c.pending.slice(1) })))).toThrow();
  });
  it("plant: a press that does not keep the view revision it showed is caught", async () => {
    const api = await machine();
    expect(() =>
      p1(
        planted(api, "press", ([c]) => ({
          ...c,
          pending: c.pending.map((p) => (p.n === c.written - 1 ? { ...p, viewRev: 0 } : p)),
        })),
      ),
    ).toThrow();
  });
});

// --- p3: views move forward by one ------------------------------------------------------------

// `__proto__` is the one key a view may not carry: it is a pointer the patch refuses.
const json: fc.Arbitrary<unknown> = fc
  .jsonValue({ maxDepth: 3 })
  .filter((v) => !JSON.stringify(v).includes("__proto__"));

const objects = fc.dictionary(fc.string({ maxLength: 6 }), json, { maxKeys: 5 });
const A = "process_a";
const B = "process_b";

const isJson = (u: unknown): boolean => {
  try {
    return JSON.stringify(u) !== undefined;
  } catch {
    return false;
  }
};

/** A program's view decoder that takes any JSON object and refuses everything else, the way a
 *  view schema refuses: by its own Schema error. */
const objectView = Schema.decodeUnknownSync(Schema.Record(Schema.String, Schema.Json));

/** A decoder with a bug: it throws a plain error on everything. */
const throwing = (): unknown => {
  throw new Error("not a view");
};

/** Checks that accept every object view these laws draw: none, the identity, and a schema's own. */
const accepting: fc.Arbitrary<Checks> = fc.constantFrom<Checks>(
  {},
  { decode: () => (view) => view },
  { decode: () => objectView },
);

/** Every kind of checks: ones that accept, one that refuses by its schema, one that throws, and
 *  one that tells two pids apart. */
const anyChecks: fc.Arbitrary<Checks> = fc.oneof(
  accepting,
  fc.constantFrom<Checks>(
    { decode: () => Schema.decodeUnknownSync(Schema.Struct({ count: Schema.Int })) },
    { decode: () => throwing },
    { decode: (pid) => (pid === A ? throwing : (view) => view) },
  ),
);

/** One law per rule, each a function of the machine factory under test, so a plant can run the
 *  same check. Each folds `notice` Msgs through the machine from its real init (A7). */
const viewLaws: Readonly<Record<string, (api: MachineApi) => void>> = {
  "forward by one": (api) =>
    fc.assert(
      fc.property(
        objects,
        objects,
        fc.integer({ min: 1, max: 1000 }),
        fc.integer({ min: 2, max: 9 }),
        accepting,
        (a, b, rev, gap, checks) => {
          const { steps } = stepped(api.clientMachineFor(checks), [
            notice(A, { type: "whole", rev, view: a }),
            notice(A, { type: "patch", base: rev, rev: rev + 1, patch: diff(a, b) }),
            // Older and equal revisions do nothing and ask for nothing.
            notice(A, { type: "patch", base: rev - 1, rev, patch: diff(b, a) }),
            // A gap leaves the view and asks for a whole.
            notice(A, { type: "patch", base: rev + gap, rev: rev + gap + 1, patch: diff(b, a) }),
            // A whole copy always replaces, a lower revision included (data was reset).
            notice(A, { type: "whole", rev: 1, view: a }),
          ]);
          const [first, next, old, hole, reset] = steps;
          expect(first?.next.views[A]).toEqual({ rev, view: a });
          expect(asks(first)).toBe(false);
          expect(next?.next.views[A]).toEqual({ rev: rev + 1, view: b });
          expect(asks(next)).toBe(false);
          expect(old?.next.views).toEqual(next?.next.views);
          expect(asks(old)).toBe(false);
          expect(hole?.next.views).toEqual(next?.next.views);
          expect(asks(hole)).toBe(true);
          expect(reset?.next.views[A]).toEqual({ rev: 1, view: a });
          expect(asks(reset)).toBe(false);
        },
      ),
      { seed: SEED, numRuns: RUNS },
    ),
  "real diffs reach their target": (api) =>
    fc.assert(
      fc.property(fc.array(objects, { minLength: 2, maxLength: 8 }), accepting, (views, checks) => {
        const { steps, final } = stepped(api.clientMachineFor(checks), [
          notice(A, { type: "whole", rev: 7, view: views[0] }),
          ...views
            .slice(1)
            .map((view, i) => notice(A, { type: "patch", base: 7 + i, rev: 8 + i, patch: diff(views[i], view) })),
        ]);
        expect(final.views[A]).toEqual({ rev: 6 + views.length, view: views.at(-1) });
        // A real diff at the shown revision never asks for a whole.
        expect(steps.map(asks)).toEqual(steps.map(() => false));
      }),
      { seed: SEED, numRuns: RUNS },
    ),
  "junk never throws and changes nothing, with any decoder": (api) =>
    fc.assert(
      fc.property(json, fc.jsonValue(), objects, anyChecks, (junk, other, good, checks) => {
        const isNote = (u: unknown): boolean =>
          typeof u === "object" &&
          u !== null &&
          ((u as { type?: unknown }).type === "whole" || (u as { type?: unknown }).type === "patch");
        const bad = [
          { type: "patch", base: 3, rev: 4, patch: "junk" },
          { type: "patch", base: 3, rev: 4, patch: 7 },
          { type: "patch", base: 3, rev: 4, patch: [{ op: "add", path: "/__proto__/x", value: 1 }] },
          { type: "patch", base: 3, rev: 4, patch: [{ op: "add", path: "no-slash", value: 1 }] },
        ];
        const { steps } = stepped(api.clientMachineFor(checks), [
          notice(A, { type: "whole", rev: 3, view: good }),
          ...[junk, other, ...bad].map((note) => notice(A, note)),
        ]);

        expect(steps).toHaveLength(7);

        for (const [i, step] of steps.entries()) {
          if (i === 0) {
            continue;
          }

          expect(step.next.views).toEqual(step.prev.views);

          // Junk that is no view note does nothing and asks nothing. A bad patch at the shown
          // revision (steps 3 to 6) asks for a whole.
          if (i >= 3) {
            expect(asks(step)).toBe(true);
          } else if (!isNote((step.msg as Notice).note)) {
            expect(asks(step)).toBe(false);
          }
        }

        expect(({} as { x?: unknown }).x).toBeUndefined();
      }),
      { seed: SEED, numRuns: RUNS },
    ),
  // A7: the decoder is the program's own, looked up by the notice's pid. One that refuses by its
  // schema and one that throws are refusals alike; the other pid's decoder accepts.
  "a candidate the decoder refuses is never installed, and only its own pid's decoder decides": (api) =>
    fc.assert(
      fc.property(
        objects,
        fc.string(),
        fc.constantFrom(A, B),
        fc.constantFrom("refuses", "throws"),
        (good, text, pid, how) => {
          const other = pid === A ? B : A;
          // "refuses" takes the object view and refuses the string; "throws" refuses both.
          const refuser = how === "refuses" ? objectView : throwing;
          const checks: Checks = { decode: (p) => (p === pid ? refuser : (view) => view) };
          const patch = {
            type: "patch",
            base: 3,
            rev: 4,
            patch: [{ op: "replace", path: "", value: text }],
          };
          const { steps } = stepped(api.clientMachineFor(checks), [
            notice(pid, { type: "whole", rev: 3, view: good }),
            notice(other, { type: "whole", rev: 3, view: good }),
            notice(pid, patch),
            notice(other, patch),
          ]);
          const [whole, otherWhole, refused, otherPatch] = steps;

          if (how === "refuses") {
            expect(whole?.next.views[pid]).toEqual({ rev: 3, view: good });
            expect(asks(whole)).toBe(false);
          } else {
            // A refused whole is never installed either, and asks for a whole again.
            expect(whole?.next.views[pid]).toBeUndefined();
            expect(asks(whole)).toBe(true);
          }

          expect(otherWhole?.next.views[other]).toEqual({ rev: 3, view: good });
          expect(refused?.next.views).toEqual(refused?.prev.views);
          expect(asks(refused)).toBe(true);
          expect(otherPatch?.next.views[other]).toEqual({ rev: 4, view: text });
          expect(asks(otherPatch)).toBe(false);
        },
      ),
      { seed: SEED, numRuns: RUNS },
    ),
  "the old view is never mutated, untouched views keep their reference": (api) =>
    fc.assert(
      fc.property(objects, objects, accepting, (a, b, checks) => {
        const frozen = structuredClone(a);
        const { steps } = stepped(api.clientMachineFor(checks), [
          notice(A, { type: "whole", rev: 1, view: a }),
          notice(B, { type: "whole", rev: 1, view: { k: 1 } }),
          notice(A, { type: "patch", base: 1, rev: 2, patch: diff(a, b) }),
        ]);
        const patched = steps[2];
        expect(a).toEqual(frozen);
        expect(patched?.prev.views[A]?.view).toEqual(frozen);
        expect(patched?.next.views[B]).toBe(patched?.prev.views[B]);
      }),
      { seed: SEED, numRuns: RUNS },
    ),
};

const FORWARD = "forward by one";
const JUNK = "junk never throws and changes nothing, with any decoder";

const REFUSED = "a candidate the decoder refuses is never installed, and only its own pid's decoder decides";

const MUTATED = "the old view is never mutated, untouched views keep their reference";

const law = (name: string, api: MachineApi): void => {
  const run = viewLaws[name];
  expect(run, `a view law named ${name}`).toBeTypeOf("function");
  (run as (api: MachineApi) => void)(api);
};

/** The note a Msg carries when it is a notice of an object, else an empty one. */
const carried = (m: ClientMsg): { type?: unknown; base?: unknown; rev?: unknown } =>
  m.type === "notice" && typeof m.note === "object" && m.note !== null ? m.note : {};

describe("p3: views move forward by one (clientMachineFor)", () => {
  for (const name of Object.keys(viewLaws)) {
    it(name, async () => law(name, await machine()));
  }

  // Plants (p3): apply across a gap; install a string count; mutate the old view. Each rewires the
  // real machine's `notice` step, or the factory's checks, with one break.
  it("plant: applying across a gap is caught", async () => {
    const broken = rewired(await machine(), "notice", (real) => (s, m) => {
      const n = carried(m);
      const at = m.type === "notice" ? (s.views[m.pid]?.rev ?? 0) : 0;
      return m.type === "notice" && n.type === "patch"
        ? real(s, { ...m, note: { ...n, base: at, rev: at + 1 } })
        : real(s, m);
    });
    expect(() => law(FORWARD, broken)).toThrow();
  });
  it("plant: a gap that asks for no whole view, or asks for another pid, is caught", async () => {
    const api = await machine();
    const silent = rewired(api, "notice", (real) => (s, m) => [real(s, m)[0], []]);
    expect(() => law(FORWARD, silent)).toThrow();
    const elsewhere = rewired(api, "notice", (real) => (s, m) => {
      const [next, cmds] = real(s, m);
      return [next, cmds.map((c) => ({ ...c, pid: "process_z" }))];
    });
    expect(() => law(FORWARD, elsewhere)).toThrow();
  });
  it("plant: installing a candidate the decoder refused is caught", async () => {
    const api = await machine();
    // The factory drops the program's decoder and checks only that a view is JSON.
    const broken: MachineApi = { ...api, clientMachineFor: () => api.clientMachineFor({}) };
    expect(() => law(REFUSED, broken)).toThrow();
  });
  it("plant: a decoder looked up by another pid is caught", async () => {
    const api = await machine();
    const broken: MachineApi = {
      ...api,
      clientMachineFor: (checks) =>
        api.clientMachineFor(
          checks.decode === undefined
            ? {}
            : { decode: () => (checks.decode as (pid: string) => (v: unknown) => unknown)(A) },
        ),
    };
    expect(() => law(REFUSED, broken)).toThrow();
  });
  it("plant: mutating the old view is caught", async () => {
    const broken = rewired(await machine(), "notice", (real) => (s, m) => {
      const out = real(s, m);
      const cur = m.type === "notice" ? s.views[m.pid]?.view : undefined;

      if (typeof cur === "object" && cur !== null) {
        Object.assign(cur, { leak: 1 });
      }

      return out;
    });
    expect(() => law(MUTATED, broken)).toThrow();
  });
  it("plant: a throwing client on junk is caught", async () => {
    const broken = rewired(await machine(), "notice", (real) => (s, m) => {
      const note = m.type === "notice" ? m.note : null;

      if (note === null || typeof note !== "object" || Array.isArray(note)) {
        throw new Error("boom");
      }

      return real(s, m);
    });
    expect(() => law(JUNK, broken)).toThrow();
  });
});

describe("applyPatch: checked, pure, and refused when malformed", () => {
  it("applies real diffs, arrays and escaped tokens included, and returns a new value", async () => {
    const { applyPatch } = await patching();
    fc.assert(
      fc.property(json, json, (a, b) => {
        const frozen = structuredClone(a);
        const out = applyPatch(a, diff(a, b));
        expect(Result.isSuccess(out)).toBe(true);

        if (Result.isSuccess(out)) {
          expect(out.success).toEqual(b);
        }

        expect(a).toEqual(frozen);
      }),
      { seed: SEED, numRuns: RUNS },
    );
  });
  it("refuses malformed pointers and unsafe keys, never throws", async () => {
    const { applyPatch } = await patching();
    const bad = fc.oneof(
      fc.constantFrom("x", "a/b", "/__proto__/x", "/constructor/prototype/x", "/a/~2", "/a/~"),
      fc.string({ maxLength: 5 }).filter((s) => s !== "" && !s.startsWith("/")),
    );
    fc.assert(
      fc.property(objects, bad, fc.constantFrom("add", "remove", "replace"), json, (view, path, op, value) => {
        const out = applyPatch(view, [{ op, path, value }]);
        expect(Result.isFailure(out)).toBe(true);
        expect({}.constructor === Object && !("x" in {})).toBe(true);
      }),
      { seed: SEED, numRuns: RUNS },
    );
  });
  it("an operation outside add, remove and replace is refused", async () => {
    const { applyPatch } = await patching();
    fc.assert(
      fc.property(objects, fc.constantFrom("move", "copy", "test", "", "ADD"), (view, op) => {
        expect(Result.isFailure(applyPatch(view, [{ op, path: "/a", from: "/b", value: 1 }]))).toBe(true);
      }),
      { seed: SEED, numRuns: 50 },
    );
  });
});

// --- the counter's shape: an independent fold -------------------------------------------------

// libfabrika may not import a program (layers.test.ts), so the machine below is the counter's own
// schema and arithmetic as `programs/counter/src/program.ts` has them. The real counter runs the
// same fold in the browser, in `e2e/first-window.test.ts`.
const CounterMsg = Schema.Union([
  Schema.Struct({ type: Schema.Literal("inc") }),
  Schema.Struct({ type: Schema.Literal("dec") }),
  Schema.Struct({ type: Schema.Literal("reset") }),
]);

const CounterModel = Schema.Struct({ count: Schema.Int });

const counterMachine = Machine.make({
  model: CounterModel,
  msg: CounterMsg,
  cmds: [],
  init: (loaded) => [loaded ?? { count: 0 }, []],
  update: {
    inc: (s) => [{ count: s.count + 1 }, []],
    dec: (s) => [{ count: s.count - 1 }, []],
    reset: () => [{ count: 0 }, []],
  },
});

/** The independent fold: the count after `msgs` is what arithmetic says, reset to zero included. */
const counted = (msgs: ReadonlyArray<{ type: string }>): number =>
  msgs.reduce((n, m) => (m.type === "inc" ? n + 1 : m.type === "dec" ? n - 1 : 0), 0);

/** The counter's checks: its view decoder is the counter's own model schema, for every pid. */
const counterChecks: Checks = { decode: () => Schema.decodeUnknownSync(CounterModel) };

describe("the counter's typed views and resends agree with an independent fold (clientMachineFor)", () => {
  it.effect.prop(
    "each distinct letter moves the shown count once, however many times it is resent, and the cache is not the truth",
    {
      msgs: Schema.Array(CounterMsg).check(Schema.isMaxLength(25)),
      resends: Schema.Array(Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 24 }))).check(
        Schema.isMaxLength(30),
      ),
    },
    ({ msgs, resends }) =>
      Effect.promise(async () => {
        const api = await machine();
        const client = api.clientMachineFor(counterChecks);
        // The "brain": the real counter machine, stepping each distinct letter once, saving letters.
        let [model] = counterMachine.init(null, {});
        let rev = 0;
        const saved: Array<{ type: string }> = [];
        const seenLetters = new Set<string>();
        // The client shows the first whole view, takes every press, and dates every slot.
        const dated = stepped(client, [
          notice(A, { type: "whole", rev, view: { count: model.count } }),
          ...msgs.map((m): ClientMsg => ({ type: "press", pid: A, m })),
          ...msgs.map((_, n): ClientMsg => ({
            type: "dated",
            n,
            letter: `letter_${n}`,
            sentAt: SENT_AT,
          })),
        ]).final;
        const notes: Array<ClientMsg> = [];

        for (const n of [...msgs.keys(), ...resends.filter((r) => r < msgs.length)]) {
          const letter = api.outbox(dated).find((p) => p.n === n)?.letter;

          if (letter === undefined || seenLetters.has(letter)) {
            continue;
          } // a resend: placed once already

          seenLetters.add(letter);
          const m = msgs[n];

          if (m === undefined) {
            continue;
          }

          const [next] = applyCell(counterMachine, model, m as never);
          const patch = diff({ count: model.count }, { count: next.count });
          model = next;
          saved.push(m);
          rev++;
          notes.push(notice(A, { type: "patch", base: rev - 1, rev, patch }));
        }

        // The brain's view notices reach the client as `notice` Msgs; none of them asks again.
        const shown = stepped(client, notes, dated);
        expect(shown.steps.map((s) => s.cmds)).toEqual(shown.steps.map(() => []));
        const c = shown.final;
        expect(c.views[A]?.view).toEqual({ count: counted(saved) });
        expect(c.views[A]?.view).toEqual({
          count: counted(msgs.filter((_, n) => seenLetters.has(`letter_${n}`))),
        });
        // Discarding the view cache loses no saved count: a client loaded with its letters and no
        // views, sent a whole view from the saved letters, shows the same count.
        const restored = stepped(client, [notice(A, { type: "whole", rev, view: { count: counted(saved) } })], {
          ...c,
          views: {},
        }).final;
        expect(restored.views[A]?.view).toEqual(c.views[A]?.view);
      }),
    { arbitrary: { seed: SEED, runs: 150 } },
  );
  it("a patch that makes a string count is never installed, and asks for a whole view", async () => {
    const api = await machine();
    fc.assert(
      fc.property(
        fc.integer({ min: -1000, max: 1000 }),
        fc.integer({ min: 1, max: 1000 }),
        fc.oneof(fc.integer().map(String), fc.string()),
        (count, rev, text) => {
          const { steps } = stepped(api.clientMachineFor(counterChecks), [
            notice(A, { type: "whole", rev, view: { count } }),
            notice(A, {
              type: "patch",
              base: rev,
              rev: rev + 1,
              patch: [{ op: "replace", path: "/count", value: text }],
            }),
          ]);
          const out = steps[1];
          expect(out?.next.views[A]).toEqual({ rev, view: { count } });
          expect(asks(out)).toBe(true);
        },
      ),
      // The round 4 law was this one case, the plan's plant "pass string count": kept so the
      // property is no narrower than it.
      { seed: SEED, numRuns: RUNS, examples: [[1, 1, "2"]] },
    );
  });
});

// --- [secrets]: what the client records ---------------------------------------------------------

const SECRET_FORMS = (s: string): ReadonlyArray<string> => [
  s,
  btoa(s),
  btoa(s).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, ""),
  encodeURIComponent(s),
  encodeURIComponent(encodeURIComponent(s)),
  Array.from(new TextEncoder().encode(s), (b) => b.toString(16).padStart(2, "0")).join(""),
  JSON.stringify(s).slice(1, -1),
];

const sentinel = fc.stringMatching(/^[A-Za-z0-9+/=_ -]{12,32}$/).map((s) => `KEY-${s}`);

describe("[secrets] client records carry ids, numbers and fixed words only", () => {
  const failures = fc.record({
    secret: sentinel,
    shape: fc.constantFrom("error", "cause", "tagged", "object", "string", "nested"),
    name: fc.constantFrom("KeyError", "DataError", "NotAllowedError", "TypeError"),
  });
  const make = ({ secret, shape, name }: { secret: string; shape: string; name: string }): unknown => {
    const error = Object.assign(new Error(`${name}: ${secret}`), {
      name,
      stack: `at ${secret}`,
      secret,
    });
    return shape === "cause"
      ? new Error("outer", { cause: error })
      : shape === "tagged"
        ? { _tag: name, key: secret, message: secret }
        : shape === "object"
          ? { message: secret, key: secret, url: `/client/${encodeURIComponent(secret)}/tab` }
          : shape === "string"
            ? secret
            : shape === "nested"
              ? { reason: { inner: [error] } }
              : error;
  };
  it("a failure's record keeps none of the secret in any form, and decodes as a ClientRecord", async () => {
    const api = await windowing();
    fc.assert(
      fc.property(failures, (f) => {
        const row = api.failureRecord(make(f));
        Schema.decodeUnknownSync(api.ClientRecord as Schema.Decoder<unknown>)(row);
        const text = JSON.stringify(row);

        for (const form of SECRET_FORMS(f.secret)) {
          expect(text).not.toContain(form);
        }
      }),
      { seed: SEED, numRuns: RUNS },
    );
  });
  // Plant: a record that copies the failure's message leaks the sentinel, and the check sees it.
  it("plant: a record that copies the message is caught", async () => {
    const api = await windowing();
    const leaky = (e: unknown) => ({
      ...(api.failureRecord(e) as object),
      reason: String((e as { message?: unknown })?.message ?? e),
    });
    const caught = (f: { secret: string; shape: string; name: string }) =>
      SECRET_FORMS(f.secret).some((form) => JSON.stringify(leaky(make(f))).includes(form));
    fc.assert(
      fc.property(
        failures.filter((f) => f.shape === "error" || f.shape === "object" || f.shape === "string"),
        (f) => caught(f) === true,
      ),
      { seed: SEED, numRuns: 50 },
    );
    expect(isJson({})).toBe(true);
  });
});
