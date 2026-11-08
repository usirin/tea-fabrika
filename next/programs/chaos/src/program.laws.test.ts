// P17b, next/. All machine laws start at the real init and step its real reducer.
import {applyCell} from "@demlik/tea";
import {propertyInvariant, propertyTerminates, propertyTrace} from "@demlik/tea/pbt";
import {describe, expect, expectTypeOf, it} from "@effect/vitest";
import {syncTest} from "@kampus/libfabrika/testing";
import {Effect, Result, Schema} from "effect";
import * as fc from "fast-check";
import {
	fixtureId,
	LAW,
	library,
	program,
	records,
	SEED,
	start,
	target,
	timing,
} from "./chaos.test-support.ts";

type Library = typeof import("@kampus/libfabrika");
type ChaosMachine = typeof import("./program.ts").chaosMachine;
type RawStart = typeof start extends fc.Arbitrary<infer A> ? A : never;
type Timing = typeof timing extends fc.Arbitrary<infer A> ? A : never;

const load = async () => ({
	...(await Effect.runPromise(library())),
	...(await Effect.runPromise(program())),
});

// The driver chooses outside events and answers. It never computes a schedule or state.
const sequence = (
	A: Library,
	machine: ChaosMachine,
	raw: RawStart,
	times: Timing,
	answer = true,
) => {
	const value = Schema.decodeUnknownSync(A.Start)(raw);
	const msgs: Array<
		typeof machine extends import("@demlik/tea").Machine<
			infer _S,
			infer M,
			infer _C,
			infer _U,
			infer _X
		>
			? M
			: never
	> = [];
	const [initial, initialCmds] = machine.init(null, {});
	let state = initial;
	let pending = [...initialCmds];
	const send = (msg: (typeof msgs)[number]) => {
		msgs.push(msg);
		const [next, cmds] = applyCell(machine, state, msg);
		state = next;
		pending = [...pending, ...cmds];
	};
	send({type: "start", value});
	for (let n = 0; n < raw.most + 3; n++) {
		for (const cmd of pending.splice(0)) {
			if (cmd.type === "now") send(A.now.ok(cmd, times.from));
			else if (cmd.type === "fire" && answer) send(A.fire.ok(cmd, A.Fired.cases.fired.make({})));
			else if (cmd.type === "check")
				send(A.inspect.ok(cmd, {checked: {letters: 0, doubled: 0, gaps: 0}, restarts: []}));
		}
		const at = A.ChaosState.wake(state);
		if (at !== null)
			send({
				type: "timer",
				id: Schema.decodeUnknownSync(A.Asked.fields.tick)(fixtureId("input", n + 1)),
				at: at + times.late[n % times.late.length]!,
			});
	}
	expect(pending).toHaveLength(0);
	return msgs;
};

describe("P17b schedule and machine laws", () => {
	it("p34 plant, outside entropy: a seed and target give the same bounded fault list", async () => {
		const A = await load();
		fc.assert(
			fc.property(start, timing, (raw, times) => {
				const value = Schema.decodeUnknownSync(A.Start)(raw);
				const input = {...value, from: times.from};
				const first = A.planFaults(input);
				expect(Result.isSuccess(first)).toBe(true);
				expect(A.planFaults(input)).toEqual(first);
				if (Result.isFailure(first)) return;
				expect(first.success).toHaveLength(value.most);
				for (const [n, row] of first.success.entries()) {
					expect(Schema.is(A.Fault)(row.fault)).toBe(true);
					expect(row.at).toBeGreaterThanOrEqual(times.from);
					if (n > 0) expect(row.at - first.success[n - 1]!.at).toBeGreaterThanOrEqual(value.gap);
				}
				const msgs = sequence(A, A.chaosMachine, raw, times);
				propertyTrace(
					A.chaosMachine,
					{},
					fc.constant(msgs),
					(steps) => {
						const actual = steps.flatMap((s) =>
							s.cmds.filter((c) => c.type === "fire").map((c) => c.fault),
						);
						return JSON.stringify(actual) === JSON.stringify(first.success.map((f) => f.fault));
					},
					{seed: SEED, numRuns: 1},
				);
			}),
			LAW,
		);
	});

	it("plant, widened types: Start, Target and wake keep their declared types", async () => {
		const A = await load();
		type Start = typeof A.Start.Type;
		expectTypeOf<Start["seed"]>().toEqualTypeOf<number>();
		expectTypeOf<Start["most"]>().toEqualTypeOf<number>();
		expectTypeOf<Start["gap"]>().toEqualTypeOf<number>();
		expectTypeOf<Start["id"]>().not.toEqualTypeOf<string>();
		expectTypeOf<Start["id"]>().toMatchTypeOf<string>();
		expectTypeOf<Start["target"]["program"]>().toEqualTypeOf<"counter" | "notes">();
		expectTypeOf(A.ChaosState.wake).returns.toEqualTypeOf<number | null>();
		fc.assert(
			fc.property(start, (raw) => expect(Schema.is(A.Start)(raw)).toBe(true)),
			LAW,
		);
	});

	it("plant, unchecked bounds: typed decoders refuse bad seeds, caps, gaps and targets", async () => {
		const A = await load();
		const invalid = fc.oneof(
			fc.integer({max: 0}),
			fc.double({noNaN: false}).filter((n) => !Number.isSafeInteger(n)),
		);
		fc.assert(
			fc.property(start, invalid, fc.constantFrom("seed", "most", "gap"), (raw, bad, field) => {
				expect(Result.isFailure(Schema.decodeUnknownResult(A.Start)({...raw, [field]: bad}))).toBe(
					true,
				);
			}),
			LAW,
		);
		fc.assert(
			fc.property(start, fc.integer({min: 1, max: 100}), (raw, extra) => {
				expect(
					Result.isFailure(Schema.decodeUnknownResult(A.Start)({...raw, seed: 0xffffffff + extra})),
				).toBe(true);
				expect(
					A.planFaults({...Schema.decodeUnknownSync(A.Start)(raw), [field]: bad, from: 0}),
				).toMatchObject({_tag: "Failure", failure: {why: field === "most" ? "limit" : field}});
				const input = {
					...Schema.decodeUnknownSync(A.Start)(raw),
					most: Math.max(2, raw.most),
					from: Number.MAX_SAFE_INTEGER,
				};
				expect(A.planFaults(input)).toMatchObject({_tag: "Failure", failure: {why: "overflow"}});
			}),
			LAW,
		);
		fc.assert(
			fc.property(target, fc.constantFrom("chaos", "arbitrary", ""), (raw, name) => {
				expect(
					Result.isFailure(Schema.decodeUnknownResult(A.Target)({...raw, program: name})),
				).toBe(true);
			}),
			LAW,
		);
	});

	it("p34 plant, accept self: chaos refuses its own registered name or process", async () => {
		const A = await load();
		fc.assert(
			fc.property(start, fc.boolean(), (raw, byName) => {
				const [model] = A.chaosMachine.init(null, {});
				const own = {
					...raw.target,
					...(byName ? {name: "chaos:1"} : {process: fixtureId("process", 1)}),
				};
				const decoded = Schema.decodeUnknownResult(A.Start)({...raw, target: own});
				const refused =
					Result.isFailure(decoded) ||
					A.ChaosState.refuse(model, {type: "start", value: decoded.success}) !== null;
				expect(refused).toBe(true);
			}),
			LAW,
		);
	});

	it("p34 plant, burst on a late timer: every fire obeys the cap and actual-time gap", async () => {
		const A = await load();
		const lists = fc
			.tuple(start, timing)
			.map(([raw, times]) => sequence(A, A.chaosMachine, raw, times));
		propertyTrace(
			A.chaosMachine,
			{},
			lists,
			(steps) => {
				const begin = steps.find((s) => s.msg.type === "start")!.msg;
				if (begin.type !== "start") return false;
				const fires = steps.filter((s) => s.cmds.some((c) => c.type === "fire"));
				if (fires.length !== begin.value.most)
					return "the experiment must reach, and never exceed, its cap";
				for (let i = 0; i < fires.length; i++) {
					const hit = fires[i]!;
					const timer = hit.msg;
					if (timer.type !== "timer") return "only a saved timer can fire";
					const asked = records(A.Asked, hit.next);
					if (!asked.some((a) => a.tick === timer.id && a.n === i + 1))
						return "Asked must precede fire";
					const previous = fires[i - 1]?.msg;
					if (previous?.type === "timer" && timer.at - previous.at < begin.value.gap)
						return "late callbacks burst";
					if (hit.cmds.filter((c) => c.type === "fire").length !== 1)
						return "one timer consumed several faults";
				}
				return steps.flatMap((s) => s.cmds.filter((c) => c.type === "check")).length === 1;
			},
			LAW,
		);
	});

	it("p34 plant, ignore stop in one phase: stop cancels wake and every later source of fire", async () => {
		const A = await load();
		const lists = fc.tuple(start, timing, fc.nat()).map(([raw, times, cut]) => {
			const msgs = sequence(A, A.chaosMachine, raw, times);
			const at = 1 + (cut % msgs.length);
			return [...msgs.slice(0, at), {type: "stop" as const}, ...msgs.slice(at), ...msgs.slice(at)];
		});
		propertyTrace(
			A.chaosMachine,
			{},
			lists,
			(steps) => {
				const stop = steps.findIndex((s) => s.msg.type === "stop");
				return steps
					.slice(stop)
					.every((s) => A.ChaosState.wake(s.next) === null && s.cmds.length === 0);
			},
			LAW,
		);
	});

	it("p34 plant, wait after the last fault: answered bounded work terminates", async () => {
		const A = await load();
		const lists = fc
			.tuple(start, timing)
			.map(([raw, times]) => sequence(A, A.chaosMachine, raw, times));
		propertyTerminates(
			A.chaosMachine,
			{},
			lists,
			(model) => model.phase._tag === "done" && A.ChaosState.wake(model) === null,
			LAW,
		);
	});

	it("S2 plant, lose random state or deadline: every saved cut keeps later models and Cmds", async () => {
		const A = await load();
		fc.assert(
			fc.property(start, timing, fc.nat(), (raw, times, cut) => {
				const msgs = sequence(A, A.chaosMachine, raw, times);
				const options = {
					msgs,
					encode: Schema.encodeSync(A.chaos.state.schema),
					decode: Schema.decodeUnknownSync(A.chaos.state.schema),
					equals: (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b),
					seed: SEED,
				};
				syncTest(A.chaosMachine, {}, options);
				syncTest(A.chaosMachine, {}, {...options, msgs: msgs.slice(0, cut % (msgs.length + 1))});
			}),
			LAW,
		);
	});

	it("plant, settle another tick: duplicates and unrelated answers never change recorded outcomes", async () => {
		const A = await load();
		const lists = fc.tuple(start, timing).map(([raw, times]) => {
			const msgs = sequence(A, A.chaosMachine, raw, times);
			return msgs.flatMap((m) =>
				m.type === "fire_ok"
					? [
							m,
							m,
							{
								...m,
								cmd: {
									...m.cmd,
									tick: Schema.decodeUnknownSync(A.Asked.fields.tick)(fixtureId("input", 1000)),
								},
							},
						]
					: [m],
			);
		});
		propertyInvariant(
			A.chaosMachine,
			{},
			lists,
			({prev, msg, next}) => {
				if (msg.type !== "fire_ok") return true;
				const before = records(A.Did, prev);
				const after = records(A.Did, next);
				const asked = records(A.Asked, prev);
				if (
					!asked.some((a) => a.tick === msg.cmd.tick) ||
					before.some((d) => d.tick === msg.cmd.tick)
				)
					return JSON.stringify(before) === JSON.stringify(after);
				return after.some((d) => d.tick === msg.cmd.tick);
			},
			LAW,
		);
	});
});
