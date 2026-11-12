// T705, next/: the span sink's held and failed flags become one tea machine (0037, 0046). Written
// before the machine. Each law walks the real machine from its real `init` (0093): a move is picked
// from the Model folded so far, so a shrunk walk picks its moves again. The expected answer is a
// history of what was offered, what committed and what flush saw, never the machine's own table.
import { applyCell } from "@demlik/tea";
import { describe, expect, expectTypeOf, it } from "@effect/vitest";
import { Arbitrary, Schema } from "effect";
import { Chain, Measurements, SpanRow } from "../Trace.ts";
import { machine } from "./sink.ts";

const SEED = 119120; // the shared seed (AGENTS.md), so a red run repeats
const HOUR = 3_600_000;

type Model = typeof machine.model.Type;
type Msg = typeof machine.msg.Type;
type Ended = Extract<Msg, { readonly type: "commit_failed" }>["more"][number];

/** The plan's payload, field for field, from the row schemas it keeps. */
const Payload = Schema.Struct({
  health: Measurements,
  chain: Chain,
  row: SpanRow,
  content: Schema.NullOr(Schema.String),
});

/** Compiled, never meant to hold at run time: each `@ts-expect-error` is a Model tsc must refuse. */
const contracts = (span: Ended, checked: number) => {
  expectTypeOf<typeof Payload.Type>().toEqualTypeOf<Ended>();
  expectTypeOf<Model["_tag"]>().toEqualTypeOf<"clean" | "failed" | "holding" | "reported">();
  const holding: Model = { _tag: "holding", checked, spans: [span] };
  const reported: Model = { _tag: "reported", checked, spans: [span, span] };
  const clean: Model = { _tag: "clean", checked };
  const failed: Model = { _tag: "failed", checked };
  // @ts-expect-error holding carries at least one span
  const emptyHolding: Model = { _tag: "holding", checked, spans: [] };
  // @ts-expect-error reported carries at least one span
  const emptyReported: Model = { _tag: "reported", checked, spans: [] };
  // @ts-expect-error clean carries no spans
  const heldClean: Model = { _tag: "clean", checked, spans: [span] };
  // @ts-expect-error failed carries no spans
  const heldFailed: Model = { _tag: "failed", checked, spans: [span] };
  // @ts-expect-error no failed flag beside the case to contradict it
  const flagged: Model = { _tag: "clean", checked, failed: true };
  return [holding, reported, clean, failed, emptyHolding, emptyReported, heldClean, heldFailed, flagged];
};

const Nat = Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 1000 }));

/** One raw draw. What it means is read against the Model the walk has reached. */
const Draw = Schema.Struct({ pick: Nat, size: Nat, hour: Nat, sized: Schema.Boolean });

const Walk = Arbitrary.all({
  pool: Arbitrary.array(Arbitrary.schema(Payload), { minLength: 1, maxLength: 5 }),
  draws: Arbitrary.array(Arbitrary.schema(Draw), { minLength: 1, maxLength: 60 }),
});

type Draw = typeof Draw.Type;
type Move = "commit_failed" | "committed" | "flush_checked";

const spansIn = (model: Model): ReadonlyArray<Ended> =>
  model._tag === "holding" || model._tag === "reported" ? model.spans : [];

/** Moves possible from here, weighted so held spans meet blocked flushes before and after recovery,
 *  and a pending failure meets both a success and a flush. */
const movesFrom = (model: Model): ReadonlyArray<Move> => {
  if (spansIn(model).length > 0) {
    return ["flush_checked", "committed", "flush_checked", "commit_failed", "committed"];
  }

  if (model._tag === "failed") {
    return ["committed", "flush_checked", "commit_failed"];
  }

  return ["commit_failed", "commit_failed", "committed", "flush_checked"];
};

/** An hour the same as, earlier than or later than the Model's `checked`. */
const hourFrom = (model: Model, draw: Draw): number => {
  const base = Number.isFinite(model.checked) ? model.checked : HOUR * (100 + draw.hour);
  const by = HOUR * (1 + (draw.hour % 4));
  return [base - by, base, base + by][draw.hour % 3] ?? base;
};

/** The next Msg, from the folded Model: retries come from its held spans as well as new ones. */
const choose = (model: Model, draw: Draw, pool: ReadonlyArray<Ended>): Msg => {
  const moves = movesFrom(model);
  const move = moves[draw.pick % moves.length] ?? "flush_checked";

  if (move === "committed") {
    return { type: "committed", hour: hourFrom(model, draw), sized: draw.sized };
  }

  if (move === "flush_checked") {
    return { type: "flush_checked" };
  }

  const offered = [...spansIn(model), ...pool];
  const more = Array.from(
    { length: draw.size % 4 },
    (_, n) => offered[(draw.pick + n * 7 + draw.size) % offered.length]!,
  );
  return { type: "commit_failed", more };
};

/** What happened, kept apart from the machine: what failed since the last commit, whether a
 *  failure came after the last flush, and the newest hour a sized commit reached. */
type History = {
  readonly held: ReadonlyArray<Ended>;
  readonly unreported: boolean;
  readonly checked: number;
};

const remember = (history: History, msg: Msg): History => {
  if (msg.type === "commit_failed") {
    return { ...history, held: [...history.held, ...msg.more], unreported: true };
  }

  if (msg.type === "committed") {
    const newer = msg.sized && msg.hour > history.checked;
    return { ...history, held: [], checked: newer ? msg.hour : history.checked };
  }

  return { ...history, unreported: false };
};

type Visit = {
  readonly before: Model;
  readonly msg: Msg;
  readonly after: Model;
  readonly was: History;
  readonly now: History;
};

/** Folds the draws through the real machine, each Msg picked from the Model reached so far. */
const walk = (pool: ReadonlyArray<Ended>, draws: ReadonlyArray<Draw>): ReadonlyArray<Visit> => {
  const [start, boot] = machine.init(null, {});
  expect(boot).toEqual([]);
  expect(start).toEqual({ _tag: "clean", checked: Number.NEGATIVE_INFINITY });
  let model: Model = start;
  let history: History = { held: [], unreported: false, checked: Number.NEGATIVE_INFINITY };
  const visits: Array<Visit> = [];

  for (const draw of draws) {
    const msg = choose(model, draw, pool);
    const [after, cmds] = applyCell(machine, model, msg);
    expect(cmds, "the sink's machine starts no Cmd").toEqual([]);
    const now = remember(history, msg);
    visits.push({ before: model, msg, after, was: history, now });
    model = after;
    history = now;
  }

  return visits;
};

const props = { arbitrary: { seed: SEED, runs: 100 } };

describe("T705, the span sink's machine", () => {
  it.prop(
    "held spans keep their payloads and order across failures; only a commit clears them",
    { walk: Walk },
    ({ walk: { pool, draws } }) => {
      expect(contracts(pool[0]!, 0)).toHaveLength(9);

      for (const { msg, after, now } of walk(pool, draws)) {
        expect(spansIn(after), `held after ${msg.type}`).toEqual(now.held);
      }
    },
    props,
  );

  it.prop(
    "every failure is reported by a flush, held spans block every flush, and a commit keeps an " + "unreported failure",
    { walk: Walk },
    ({ walk: { pool, draws } }) => {
      for (const { before, msg, after, was, now } of walk(pool, draws)) {
        if (msg.type === "flush_checked") {
          const fails = was.held.length > 0 || was.unreported;
          expect(before._tag !== "clean", "the flush fails from the case it captured").toBe(fails);
          expect(spansIn(before).length, "the flush reports the held count").toBe(was.held.length);
        }

        const pending = now.held.length > 0 || now.unreported;
        expect(after._tag === "clean", `clean after ${msg.type}`).toBe(!pending);
        expect(after._tag === "failed", `failed after ${msg.type}`).toBe(now.held.length === 0 && now.unreported);
        expect(after._tag === "reported", `reported after ${msg.type}`).toBe(now.held.length > 0 && !now.unreported);
      }
    },
    props,
  );

  it.prop(
    "checked advances only after a sized commit to a newer hour",
    { walk: Walk },
    ({ walk: { pool, draws } }) => {
      for (const { msg, after, now } of walk(pool, draws)) {
        expect(after.checked, `checked after ${JSON.stringify({ ...msg, more: [] })}`).toBe(now.checked);
      }
    },
    props,
  );
});
