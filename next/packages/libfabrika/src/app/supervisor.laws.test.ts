// P34, next/. Pure rules own policy validation and saved-machine equivalence.
// Proposed test contract: supervisor is a tea machine; context supplies policy/process/build/at.
// threw -> ending/exit, exited -> down, due -> starting/start, started -> live.
// A pending action belongs in the saved model, even after its Cmd has been emitted.
import {existsSync} from "node:fs";
import {applyCell, type Machine} from "@demlik/tea";
import {describe, expect, it} from "@effect/vitest";
import {Schema} from "effect";
import * as fc from "fast-check";
import {A, B} from "../coordination/process.test-support.ts";
import {Supervision} from "../coordination/recovery.ts";
import {syncTest} from "../testing.ts";

const SEED = 119120;
const policy = {
	maxDeliveries: 3,
	intensity: 5,
	periodMs: 5000,
	backoff: {minMs: 100, maxMs: 800, resetAfterMs: 5000},
};
type Policy = typeof policy;
type Msg = {readonly type: string; readonly [key: string]: unknown};
type Model = {
	readonly recovery: {readonly _tag: string; readonly until?: number};
	readonly pending: unknown;
	readonly [key: string]: unknown;
};
type Ctx = {policy: Policy; process: string; name: string; build: string; at: number};
type Supervisor = {
	readonly Policy: Schema.Codec<Policy>;
	readonly supervisor: Machine<Model, Msg, Msg, never, Ctx>;
};
const modulePath = "./supervisor.ts";
const subject = async (): Promise<Supervisor> => {
	expect(
		existsSync(new URL(modulePath, import.meta.url)),
		"P34 has no supervision machine yet",
	).toBe(true);
	return await import(modulePath);
};
const ctx: Ctx = {policy, process: A, name: "counter:1", build: "build-a", at: 0};
const thrown = (seq: number, at: number, process = A): Msg => ({
	type: "threw",
	at,
	failure: {_tag: "fresh", process, letter: "poison", build: "build-a", seq, error: "TypeError"},
});

describe("P34 policy and saved supervision laws", () => {
	it("p80 plant, clamp invalid policy: rejected settings leave the caller's bytes alone", async () => {
		const s = await subject();
		for (const invalid of [
			{...policy, maxDeliveries: 0},
			{...policy, maxDeliveries: 33},
			{...policy, maxDeliveries: 1.5},
			{...policy, intensity: 2},
			{...policy, periodMs: 0},
			{...policy, backoff: {...policy.backoff, minMs: 801}},
			{...policy, backoff: {...policy.backoff, minMs: 0}},
			{...policy, backoff: {...policy.backoff, resetAfterMs: 0}},
			{...policy, periodMs: 100},
		]) {
			const bytes = JSON.stringify(invalid);
			expect(() => Schema.decodeUnknownSync(s.Policy)(invalid)).toThrow();
			expect(JSON.stringify(invalid)).toBe(bytes);
		}
		expect(Schema.decodeUnknownSync(s.Policy)(policy)).toEqual(policy);
	});

	it("p80 plant, unreachable brake: every generated accepted policy can exhaust its window", async () => {
		const s = await subject();
		fc.assert(
			fc.property(
				fc.integer({min: 1, max: 32}),
				fc.integer({min: 1, max: 12}),
				(deliveries, extra) => {
					const intensity = deliveries + extra;
					const candidate = {
						...policy,
						maxDeliveries: deliveries,
						intensity,
						periodMs: intensity * 800 + 1,
					};
					const accepted = Schema.decodeUnknownSync(s.Policy)(candidate);
					let [model] = s.supervisor.init(null, {...ctx, policy: accepted});
					let at = 0;
					for (let n = 1; n <= intensity + 1; n++) {
						[model] = applyCell(s.supervisor, model, {
							...thrown(n, at),
							failure: {
								_tag: "fresh",
								process: A,
								letter: `letter-${n}`,
								build: "build-a",
								seq: n,
								error: "TypeError",
							},
						});
						[model] = applyCell(s.supervisor, model, {type: "exited", at});
						const until = model.recovery.until;
						expect(until).toBeTypeOf("number");
						if (n === intensity + 1) expect(until).toBeGreaterThan(accepted.periodMs);
						else {
							at = until!;
							[model] = applyCell(s.supervisor, model, {type: "due", at});
							[model] = applyCell(s.supervisor, model, {type: "started", process: B, at});
						}
					}
				},
			),
			{seed: SEED, numRuns: 32},
		);
	});

	it("p80 plant, reset streak while down: waits double to the cap across replacement IDs", async () => {
		const s = await subject();
		let [model] = s.supervisor.init(null, ctx);
		let at = 0;
		for (const [n, wait] of [100, 200, 400, 800, 800].entries()) {
			[model] = applyCell(s.supervisor, model, thrown(n + 1, at, n === 0 ? A : B));
			expect(model.recovery._tag).toBe("ending");
			[model] = applyCell(s.supervisor, model, {type: "exited", at});
			expect(model.recovery).toMatchObject({_tag: "down", until: at + wait});
			at += wait;
			[model] = applyCell(s.supervisor, model, {type: "due", at});
			[model] = applyCell(s.supervisor, model, {type: "started", process: B, at});
		}
	});

	it("p80 plant, early restart or duplicate start: deadline gates one saved action", async () => {
		const s = await subject();
		let [model] = s.supervisor.init(null, ctx);
		[model] = applyCell(s.supervisor, model, thrown(1, 0));
		[model] = applyCell(s.supervisor, model, {type: "exited", at: 0});
		const [early, earlyCmds] = applyCell(s.supervisor, model, {type: "due", at: 99});
		expect(early).toEqual(model);
		expect(earlyCmds).toEqual([]);
		const [due, cmds] = applyCell(s.supervisor, model, {type: "due", at: 100});
		expect(due.recovery._tag).toBe("starting");
		expect(cmds.filter((cmd) => cmd.type === "start")).toHaveLength(1);
		expect(due.pending).toBeDefined();
		expect(due.pending).not.toBeNull();
		const [, duplicate] = applyCell(s.supervisor, due, {type: "due", at: 100});
		expect(duplicate).toEqual([]);
	});

	it("S2 p88 plant, omit pending Cmds: every saved cut resumes the same recovery", async () => {
		const s = await subject();
		const msgs: Msg[] = [
			thrown(1, 0),
			{type: "exited", at: 0},
			{type: "due", at: 99},
			{type: "due", at: 100},
			{type: "due", at: 100},
			{type: "started", process: B, at: 100},
			thrown(2, 101, B),
			{type: "exited", at: 101},
			{type: "due", at: 301},
		];
		syncTest(s.supervisor, ctx, {
			msgs,
			seed: SEED,
			encode: (model) => model,
			decode: (raw) => {
				if (!Schema.is(Supervision)(raw)) throw new Error("invalid saved supervision");
				return raw;
			},
			equals: (a, b) => JSON.stringify(a) === JSON.stringify(b),
		});
		let [model] = s.supervisor.init(null, ctx);
		let pending = 0;
		for (const msg of msgs) {
			[model] = applyCell(s.supervisor, model, msg);
			if (model.pending !== null && model.pending !== undefined) pending++;
		}
		expect(pending).toBeGreaterThan(0);
	});

	it("p80 plant, healthy reset never happens: a full healthy interval resets backoff only while live", async () => {
		const s = await subject();
		let [model] = s.supervisor.init(null, ctx);
		for (const msg of [
			thrown(1, 0),
			{type: "exited", at: 0},
			{type: "due", at: 100},
			{type: "started", process: B, at: 100},
			{type: "healthy", at: 5100},
		]) {
			[model] = applyCell(s.supervisor, model, msg);
		}
		[model] = applyCell(s.supervisor, model, thrown(2, 5101, B));
		[model] = applyCell(s.supervisor, model, {type: "exited", at: 5101});
		expect(model.recovery).toMatchObject({_tag: "down", until: 5201});
	});
});
