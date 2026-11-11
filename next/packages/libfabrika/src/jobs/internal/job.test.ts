// P39 slice 1, L2 to L5 and L7 on the job machine itself (0037, 0046): its real `init` and its real
// update, one Msg at a time. Every law walks a decision tape (0093): each cell is read against the
// stage the fold has reached, so a retry repeats the saved request, a start names the real
// assignment or a near miss of it, and a finish answers a real start. The expected state is this
// file's own reading of the plan's states table, never the machine.
import { applyCell } from "@demlik/tea";
import { describe, expect, it } from "@effect/vitest";
import * as fc from "fast-check";
import { type Executor, type Request, Result, State } from "../Job.ts";
import {
  CAPABILITIES,
  changedRequest,
  choose,
  copied,
  fcExecutor,
  fcFingerprint,
  fcRequest,
  fcResult,
  fcTypeId,
} from "../JobsTest.ts";
import { job } from "./job.ts";

const RUNS = { seed: 119120, numRuns: 100 };

type Model = (typeof job)["model"]["Type"];
type Msg = (typeof job)["msg"]["Type"];
type Stage = "absent" | "requested" | "assigned" | "started" | "finished";

const init = (): Model => job.init(null, undefined)[0];
const step = (model: Model, msg: Msg): Model => applyCell(job, model, msg)[0];

/** What the fold knows, from its own Msgs only. */
type World = {
  stage: Stage;
  request?: Request;
  executor?: Executor;
  execution?: string;
  result?: Result;
};

const Cell = fc.record({
  move: fc.nat(),
  pick: fc.nat(),
  variant: fc.nat(),
  execution: fc.stringMatching(/^[a-z0-9]{1,12}$/),
  connection: fcTypeId("connection"),
  result: fcResult,
});
type Cell = typeof Cell extends fc.Arbitrary<infer A> ? A : never;

const Tape = fc.uniqueArray(fcFingerprint, { minLength: 3, maxLength: 3 }).chain((keys) =>
  fc.record({
    keys: fc.constant(keys),
    requests: fc.array(fcRequest(keys.slice(0, 2)), { minLength: 2, maxLength: 3 }),
    executors: fc.array(fcExecutor(keys), { minLength: 1, maxLength: 3 }),
    cells: fc.array(Cell, { minLength: 8, maxLength: 40, size: "max" }),
  }),
);
type Tape = typeof Tape extends fc.Arbitrary<infer A> ? A : never;

type Move =
  | "request_new"
  | "early"
  | "request_equal"
  | "request_changed"
  | "take_ok"
  | "take_again"
  | "take_other"
  | "take_lacking"
  | "out_of_order"
  | "start_ok"
  | "start_again"
  | "start_wrong"
  | "finish_ok"
  | "finish_equal"
  | "finish_other"
  | "finish_wrong";

const possible = (world: World, moves: ReadonlyArray<Move>): ReadonlyArray<Move> => {
  const s = world.stage;
  const owned = s === "assigned" || s === "started" || s === "finished";
  const can: Record<Move, boolean> = {
    request_new: s === "absent",
    early: s === "absent",
    request_equal: s !== "absent",
    request_changed: s !== "absent",
    take_ok: s === "requested",
    take_again: s === "assigned",
    take_other: s !== "absent",
    take_lacking: s === "requested",
    out_of_order: s === "requested",
    start_ok: s === "assigned",
    start_again: s === "started",
    start_wrong: owned,
    finish_ok: s === "started",
    finish_equal: s === "finished",
    finish_other: s === "finished",
    finish_wrong: owned,
  };
  return moves.filter((move) => can[move]);
};

/** The state the oracle expects, built from the world through the schema's own constructors. */
const expected = (world: World) => {
  const { request, executor, execution, result } = world;

  if (world.stage === "absent" || request === undefined) {
    return State.cases.absent.make({});
  }

  if (world.stage === "requested" || executor === undefined || execution === undefined) {
    return State.cases.requested.make({ request });
  }

  const assignment = { execution, executor };

  if (world.stage === "assigned") {
    return State.cases.assigned.make({ request, assignment });
  }

  if (world.stage === "started" || result === undefined) {
    return State.cases.started.make({ request, assignment });
  }

  return State.cases.finished.make({ request, assignment, result });
};

/** An executor that may take the request: its target key, holding every capability it needs. */
const able = (request: Request, cell: Cell, base: Executor): Executor => ({
  ...base,
  key: request.target,
  connection: cell.connection,
  has: [...new Set([...base.has, ...request.needs])],
});

const near = (execution: string, variant: number): string =>
  choose([`${execution}x`, execution.slice(0, -1) || "e", `other-${execution}`], variant);

type Expect = { readonly answer: "accepted" | "repeated" | "refused"; readonly reason?: string };

/** One move as its Msg, what the world becomes, and the answer the oracle expects. */
const play = (world: World, tape: Tape, cell: Cell, move: Move): readonly [Msg, World, Expect] => {
  const request = world.request ?? choose(tape.requests, cell.pick);
  const base = choose(tape.executors, cell.pick);
  const refuse = (reason: string): Expect => ({ answer: "refused", reason });
  const same: Expect = { answer: "repeated" };
  const execution = world.execution ?? cell.execution;

  switch (move) {
    case "request_new":
      return [{ type: "request", request: copied(request) }, { stage: "requested", request }, { answer: "accepted" }];
    case "early": {
      const msgs: ReadonlyArray<Msg> = [
        { type: "take", executor: able(request, cell, base), execution: cell.execution },
        { type: "start", execution: cell.execution },
        { type: "finish", execution: cell.execution, result: cell.result },
      ];
      return [choose(msgs, cell.variant), world, refuse("not_found")];
    }
    case "request_equal":
      return [{ type: "request", request: copied(request) }, world, same];
    case "request_changed": {
      const changed = changedRequest(request, cell.variant, choose(tape.requests, cell.variant + 1));
      return [{ type: "request", request: changed }, world, refuse("conflict")];
    }
    case "take_ok": {
      const executor = able(request, cell, base);
      const next = { ...world, stage: "assigned" as const, executor, execution: cell.execution };
      return [{ type: "take", executor: copied(executor), execution: cell.execution }, next, { answer: "accepted" }];
    }
    case "take_again": {
      // The take reply was lost: the same key on a new connection proposes a new identity, and keeps the first.
      const executor = able(request, cell, base);
      return [{ type: "take", executor, execution: near(execution, cell.variant) }, world, same];
    }
    case "take_other": {
      const key = choose(
        tape.keys.filter((k) => k !== request.target),
        cell.variant,
      );
      const executor = { ...able(request, cell, base), key, has: [...CAPABILITIES] };
      return [{ type: "take", executor, execution: cell.execution }, world, refuse("not_target")];
    }
    case "take_lacking": {
      const missing = choose(request.needs, cell.variant);
      const executor = { ...able(request, cell, base), has: CAPABILITIES.filter((c) => c !== missing) };
      return [{ type: "take", executor, execution: cell.execution }, world, refuse("lacks_capability")];
    }
    case "out_of_order": {
      const msgs: ReadonlyArray<Msg> = [
        { type: "start", execution: cell.execution },
        { type: "finish", execution: cell.execution, result: cell.result },
      ];
      return [choose(msgs, cell.variant), world, refuse("wrong_state")];
    }
    case "start_ok":
      return [{ type: "start", execution: `${execution}` }, { ...world, stage: "started" }, { answer: "accepted" }];
    case "start_again":
      return [{ type: "start", execution: `${execution}` }, world, same];
    case "start_wrong":
      return [{ type: "start", execution: near(execution, cell.variant) }, world, refuse("wrong_execution")];
    case "finish_ok": {
      const next = { ...world, stage: "finished" as const, result: cell.result };
      return [{ type: "finish", execution, result: copied(cell.result) }, next, { answer: "accepted" }];
    }
    case "finish_equal":
      return [{ type: "finish", execution, result: copied(world.result ?? cell.result) }, world, same];
    case "finish_other": {
      const other =
        JSON.stringify(cell.result) === JSON.stringify(world.result)
          ? Result.cases.exited.make({ code: 1, version: `${JSON.stringify(cell.result)}-other` })
          : cell.result;
      return [{ type: "finish", execution, result: other }, world, refuse("conflict")];
    }
    case "finish_wrong":
      return [
        { type: "finish", execution: near(execution, cell.variant), result: cell.result },
        world,
        refuse("wrong_execution"),
      ];
  }
};

const law = (name: string, moves: ReadonlyArray<Move>, required: ReadonlyArray<Move>) =>
  it(name, () => {
    const done = new Set<Move>();
    fc.assert(
      fc.property(Tape, (tape) => {
        let model = init();
        let world: World = { stage: "absent" };
        const accepted: Array<Msg> = [];
        expect(model.state, "a job starts absent").toEqual(State.cases.absent.make({}));

        for (const cell of tape.cells) {
          const options = possible(world, moves);

          if (options.length === 0) {
            continue;
          }

          const move = choose(options, cell.move);
          const [msg, next, answer] = play(world, tape, cell, move);
          const before = model.state;
          model = step(model, msg);
          done.add(move);

          expect(model.answer._tag, `${move}: the answer`).toBe(answer.answer);

          if (answer.reason !== undefined) {
            expect(model.answer, `${move}: the refusal's reason`).toMatchObject({ reason: answer.reason });
          }

          if (answer.answer === "accepted") {
            accepted.push(msg);
          } else {
            expect(model.state, `${move}: a repeat or a refusal changes nothing`).toEqual(before);
          }

          world = next;
          expect(model.state, `${move}: the state the plan's table gives`).toEqual(expected(world));
          // L7 on every prefix: folding only the committed events from a fresh init is the same job.
          const replayed = accepted.reduce(step, init());
          expect(replayed.state, `${move}: the committed events fold back to the same job`).toEqual(model.state);
        }
      }),
      RUNS,
    );
    // An empty flow cannot pass: every move the law is about ran at least once.
    expect([...done].sort()).toEqual(expect.arrayContaining([...required].sort()));
  });

const LIFE: ReadonlyArray<Move> = ["request_new", "take_ok", "start_ok", "finish_ok"];

describe("P39 slice 1: the job machine", () => {
  law(
    "L2: an equal request repeats; changed bytes under the same id are refused and the first request stays",
    [...LIFE, "request_equal", "request_changed"],
    ["request_new", "request_equal", "request_changed"],
  );
  law(
    "L3: only the target key holding every need takes a request, and one execution identity wins",
    [...LIFE, "early", "take_again", "take_other", "take_lacking"],
    ["take_ok", "take_again", "take_other", "take_lacking", "early"],
  );
  law(
    "L4: a start or a finish needs the saved execution identity, in its order",
    [...LIFE, "start_again", "start_wrong", "finish_wrong", "out_of_order", "early"],
    ["start_ok", "start_again", "start_wrong", "finish_wrong", "out_of_order"],
  );
  law(
    "L5: an equal terminal retry repeats; a conflicting result never replaces the first",
    [...LIFE, "finish_equal", "finish_other", "finish_wrong", "start_wrong"],
    ["finish_ok", "finish_equal", "finish_other"],
  );
  law(
    "L7: folding the committed events from init gives the same job as the whole walk",
    [
      ...LIFE,
      "request_equal",
      "request_changed",
      "take_again",
      "take_other",
      "take_lacking",
      "start_again",
      "start_wrong",
      "finish_equal",
      "finish_other",
    ],
    ["request_new", "take_ok", "start_ok", "finish_ok", "take_again", "finish_equal"],
  );
});
