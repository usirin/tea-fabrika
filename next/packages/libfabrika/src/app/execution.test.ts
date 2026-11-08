// P12, next/. An Effect adapter must never put a Promise where P11 expects a checked Step.
// These use a production RPC client interface. The real Worker Loader is checked by stage-wire.
import {Outcome} from "@demlik/tea";
import {Cmd, Machine} from "@demlik/tea/effect";
import {describe, expect, it} from "@effect/vitest";
import {Effect, Exit, Schema} from "effect";
import * as fc from "fast-check";
import {stepper, type Step} from "./program.ts";
import {Saved} from "./state.ts";

const SEED = 119120;
const rejectedRpc = async (): Promise<never> => {
	throw new Error("private RPC body");
};
const Model = Schema.Struct({count: Schema.Int});
const Msg = Schema.Struct({type: Schema.Literal("inc")});
const work = Cmd.make("work", {
	input: Schema.Struct({n: Schema.Int}),
	ok: Schema.Int,
	err: ["disk"],
});
const machine = Machine.make({
	model: Model,
	msg: Msg,
	cmds: [work],
	init: (loaded) => [loaded ?? {count: 0}, []],
	update: {
		inc: (s) => [{count: s.count + 1}, []],
		work_ok: (s) => [s, []],
		work_err: (s) => [s, []],
	},
});
const declared = {
	name: "adapter-counter",
	machine,
	state: {v: 1, schema: Model, upgrades: []},
	msg: Msg,
	view: {data: Model, select: (s: typeof Model.Type) => s},
	refuse: (s: typeof Model.Type) => (s.count === 3 ? {why: "limit", now: 3, most: 3} : null),
	inputs: {},
	outputs: {},
	writes: {},
	wake: () => null,
};
type Execution = {
	init: (saved: unknown) => Effect.Effect<Step, unknown>;
	step: (model: unknown, msg: unknown) => Effect.Effect<Step, unknown>;
	fold: (model: unknown, msg: unknown) => Effect.Effect<Step, unknown>;
	upgrade: (saved: unknown) => Effect.Effect<unknown, unknown>;
	reply: (cmd: unknown, outcome: unknown) => Effect.Effect<unknown, unknown>;
};

describe("P12 Effect execution adapter", () => {
	it.effect("P11 handoff plant: treating an RPC Promise as a pure Step breaks checked parity", () =>
		Effect.gen(function* () {
			const {nodeExecution, workerExecution} = yield* Effect.promise(
				() => import("./execution.ts"),
			);
			const pure = stepper(declared);
			const node: Execution = nodeExecution(declared);
			// Independent pure implementation stays in P11. RPC introduces a genuine async boundary.
			const remote: Execution = workerExecution({
				init: async (saved: unknown) => pure.init(saved),
				step: async (model: unknown, msg: unknown) => pure.step(model, msg),
				fold: async (model: unknown, msg: unknown) => pure.fold(model, msg),
				upgrade: async (saved: unknown) => Saved.upgrade(saved, declared.state, "build-a"),
				reply: rejectedRpc,
			});
			for (const saved of [null, {count: 2}, {count: 3}]) {
				expect(yield* node.init(saved)).toEqual(pure.init(saved));
				expect(yield* remote.init(saved)).toEqual(pure.init(saved));
			}
			for (const n of fc.sample(fc.integer({min: 0, max: 6}), {seed: SEED, numRuns: 25})) {
				for (const msg of [{type: "inc"}, {type: "missing"}]) {
					expect(yield* node.step({count: n}, msg)).toEqual(pure.step({count: n}, msg));
					expect(yield* remote.step({count: n}, msg)).toEqual(pure.step({count: n}, msg));
					expect(yield* remote.fold({count: n}, msg)).toEqual(pure.fold({count: n}, msg));
				}
			}
		}),
	);
	it.effect(
		"P11 handoff plant: decode every RPC result; an invalid model or rejected RPC is ProgramDown",
		() =>
			Effect.gen(function* () {
				const {nodeExecution, workerExecution} = yield* Effect.promise(
					() => import("./execution.ts"),
				);
				const node: Execution = nodeExecution(declared);
				expect(Exit.isFailure(yield* Effect.exit(node.init({count: "bad"})))).toBe(true);
				for (const answer of [null, {model: {}}, {_tag: "stepped", model: 1}, "reject"]) {
					const rpc = answer === "reject" ? rejectedRpc : async () => answer;
					const remote: Execution = workerExecution({
						init: rpc,
						step: rpc,
						fold: rpc,
						upgrade: rpc,
						reply: rpc,
					});
					for (const action of [remote.init(null), remote.step({}, {}), remote.fold({}, {})]) {
						const result = yield* Effect.exit(action);
						expect(Exit.isFailure(result)).toBe(true);
						expect(JSON.stringify(result)).not.toContain("private RPC body");
					}
				}
			}),
	);
	it.effect(
		"P11 handoff plant: upgrades and typed Cmd replies must be checked inside execution",
		() =>
			Effect.gen(function* () {
				const {nodeExecution} = yield* Effect.promise(() => import("./execution.ts"));
				const upgraded = {
					...declared,
					state: {
						v: 2,
						schema: Model,
						upgrades: [
							{
								name: "rename",
								from: 1,
								run: (raw: unknown) => ({
									count: Schema.decodeUnknownSync(Schema.Struct({total: Schema.Int}))(raw).total,
								}),
							},
						],
					},
				};
				const node: Execution = nodeExecution(upgraded, "build-b");
				const saved = {v: 1, build: "build-a", after: 7, model: {total: 2}};
				expect(yield* node.upgrade(saved)).toEqual(Saved.upgrade(saved, upgraded.state, "build-b"));
				expect(saved).toEqual({v: 1, build: "build-a", after: 7, model: {total: 2}});
				const cmd = work({n: 2});
				expect(yield* node.reply(cmd, {...Outcome.ok(2), at: 42})).toEqual(work.ok(cmd, 2, 42));
				expect(
					Exit.isFailure(yield* Effect.exit(node.reply(cmd, {...Outcome.ok("bad"), at: 42}))),
				).toBe(true);
				expect(
					Exit.isFailure(yield* Effect.exit(node.upgrade({...saved, model: {total: "bad"}}))),
				).toBe(true);
			}),
	);
});
