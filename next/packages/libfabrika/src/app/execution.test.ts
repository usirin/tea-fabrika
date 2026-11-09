// P12, next/. An Effect adapter must never put a Promise where P11 expects a checked Step.
// These use a production RPC client interface. The real Worker Loader is checked by stage-wire.
import {Outcome} from "@demlik/tea";
import {Cmd, Machine} from "@demlik/tea/effect";
import {describe, expect, it} from "@effect/vitest";
import {Effect, Exit, Schema} from "effect";
import * as fc from "fast-check";
import {nodeExecution, workerExecution} from "./execution.ts";
import {stepper, Step} from "./program.ts";
import {Saved} from "./state.ts";

const SEED = 119120;
const noSavedModel: [number, null] = [0, null];
const savedModel: [number, {count: number}] = [2, {count: 2}];
const refusalBoundary: [number, {count: number}] = [3, {count: 3}];
const aboveRefusal: [number, null] = [6, null];
const nullReply: [fc.JsonValue, boolean, string] = [null, false, "bad"];
const missingModel: [fc.JsonValue, boolean, string] = [{model: {}}, false, "bad"];
const malformedModel: [fc.JsonValue, boolean, string] = [{_tag: "stepped", model: 1}, false, "bad"];
const rejectedReply: [fc.JsonValue, boolean, string] = ["reject", true, "bad"];
const upgradeAndReply: [number, number, number, string] = [2, 7, 42, "bad"];
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
	refuse: (s: typeof Model.Type) => (s.count === 3 ? {reason: "limit", now: 3, most: 3} : null),
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
	it("P11 handoff plant: treating an RPC Promise as a pure Step breaks checked parity", async () => {
		await fc.assert(
			fc.asyncProperty(
				fc.oneof(fc.integer({min: 0, max: 6}), fc.nat({max: 1_000_000})),
				fc.option(fc.record({count: fc.integer()}), {nil: null}),
				(n, saved) =>
					Effect.runPromise(
						Effect.gen(function* () {
							const pure = yield* Effect.fromResult(stepper(declared));
							const node: Execution = nodeExecution(declared);
							// Independent pure implementation stays in P11. RPC introduces a genuine async boundary.
							const remote: Execution = workerExecution({
								init: async (saved: unknown) => pure.init(saved),
								step: async (model: unknown, msg: unknown) => pure.step(model, msg),
								fold: async (model: unknown, msg: unknown) => pure.fold(model, msg),
								upgrade: async (saved: unknown) => Saved.upgrade(saved, declared.state, "build-a"),
								reply: rejectedRpc,
							});
							expect(yield* node.init(saved)).toEqual(pure.init(saved));
							expect(yield* remote.init(saved)).toEqual(pure.init(saved));
							for (const msg of [{type: "inc"}, {type: "missing"}]) {
								expect(yield* node.step({count: n}, msg)).toEqual(pure.step({count: n}, msg));
								expect(yield* remote.step({count: n}, msg)).toEqual(pure.step({count: n}, msg));
								expect(yield* remote.fold({count: n}, msg)).toEqual(pure.fold({count: n}, msg));
							}
						}),
					),
			),
			{seed: SEED, examples: [noSavedModel, savedModel, refusalBoundary, aboveRefusal]},
		);
	});
	it("P11 handoff plant: decode every RPC result; an invalid model or rejected RPC is ProgramDown", async () => {
		await fc.assert(
			fc.asyncProperty(
				fc.jsonValue().filter((raw) => !Schema.is(Step)(raw)),
				fc.boolean(),
				fc.string(),
				(answer, reject, bad) =>
					Effect.runPromise(
						Effect.gen(function* () {
							const node: Execution = nodeExecution(declared);
							expect(Exit.isFailure(yield* Effect.exit(node.init({count: bad})))).toBe(true);
							const rpc = reject ? rejectedRpc : async () => answer;
							const remote: Execution = workerExecution({
								init: rpc,
								step: rpc,
								fold: rpc,
								upgrade: rpc,
								reply: rpc,
							});
							for (const [action, reason] of [
								[remote.init(null), "load"],
								[remote.step({}, {}), "step"],
								[remote.fold({}, {}), "saved_letter"],
							] as const) {
								const result = yield* Effect.flip(action);
								expect(result).toMatchObject({_tag: "ProgramDown", reason});
								expect(JSON.stringify(result)).not.toContain("private RPC body");
							}
						}),
					),
			),
			{seed: SEED, examples: [nullReply, missingModel, malformedModel, rejectedReply]},
		);
	});
	it("P11 handoff plant: upgrades and typed Cmd replies must be checked inside execution", async () => {
		await fc.assert(
			fc.asyncProperty(fc.integer(), fc.nat(), fc.nat(), fc.string(), (n, after, at, bad) =>
				Effect.runPromise(
					Effect.gen(function* () {
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
											count: Schema.decodeUnknownSync(Schema.Struct({total: Schema.Int}))(raw)
												.total,
										}),
									},
								],
							},
						};
						const node: Execution = nodeExecution(upgraded, "build-b");
						const saved = {v: 1, build: "build-a", after, model: {total: n}};
						expect(yield* node.upgrade(saved)).toEqual(
							Saved.upgrade(saved, upgraded.state, "build-b"),
						);
						expect(saved).toEqual({v: 1, build: "build-a", after, model: {total: n}});
						const cmd = work({n});
						expect(yield* node.reply(cmd, {...Outcome.ok(n), at})).toEqual(work.ok(cmd, n, at));
						expect(
							Exit.isFailure(yield* Effect.exit(node.reply(cmd, {...Outcome.ok(bad), at}))),
						).toBe(true);
						expect(
							Exit.isFailure(yield* Effect.exit(node.upgrade({...saved, model: {total: bad}}))),
						).toBe(true);
					}),
				),
			),
			{seed: SEED, examples: [upgradeAndReply]},
		);
	});
});
