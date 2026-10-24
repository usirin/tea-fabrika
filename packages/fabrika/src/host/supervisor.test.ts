import {defineMachine} from "@demlik/tea";
import {Duration, Effect, Schema, Stream} from "effect";
import {describe, expect, it} from "vitest";
import {defineProgram} from "../program/program.ts";
import {input} from "../program/shape.ts";
import {cast, envelope, type HostEvent, Self, savedState, serve} from "./host.ts";
import {Ledger, type Row, streams} from "./ledger.ts";
import {layerMemory} from "./memory.ts";
import {type SupervisorSpec, SupervisorState, supervisor} from "./supervisor.ts";

// The supervisor on the in-memory ledger, one host per name: a planted crash is started again, a
// poison message is set aside after three crashes and the count goes on, and with the ledger's
// dead letters off the same poison runs the supervisor past its intensity and the tree goes down.
// The fault runs (three hosts, kills, freezes) are experiments/99-monitors-supervisor.ts.

const Count = Schema.Struct({count: Schema.Number, cursor: Schema.Number});
type Inc = {readonly type: "inc"; readonly rev: number; readonly poison: boolean};

const counter = defineMachine({
	types: {model: {} as typeof Count.Type, msg: {} as Inc, ctx: undefined},
	cmds: [],
	init: (loaded) => [loaded ?? {count: 0, cursor: 0}, []],
	update: {
		inc: (s, m) => {
			if (m.rev <= s.cursor) return [s, []];
			// The planted bug: a pure reducer that throws on one message, every time it sees it.
			if (m.poison) throw new Error("poison");
			return [{count: s.count + 1, cursor: m.rev}, []];
		},
	},
});

const Body = Schema.Struct({
	poison: Schema.optional(Schema.Boolean),
	crashAfter: Schema.optional(Schema.Boolean),
});

const child = defineProgram({
	name: "crashy",
	description: "Counts its inbox; crashes after a crashAfter message, and on a poison one.",
	inputs: {inbox: input(envelope(Body), "One message.")},
	outputs: {},
	main: ({inputs}) =>
		Effect.gen(function* () {
			const self = yield* Self;
			const handle = yield* self.run(
				counter,
				{schema: Count, cursor: (s) => s.cursor},
				{ctx: undefined},
			);
			const machine = yield* handle.ready;
			yield* inputs.inbox.pipe(
				Stream.runForEach((e) =>
					machine
						.dispatch({type: "inc", rev: e.rev, poison: e.body.poison === true})
						.pipe(
							Effect.andThen(
								e.body.crashAfter === true ? Effect.die("planted defect") : Effect.void,
							),
						),
				),
			);
		}).pipe(Effect.scoped),
});

const sleep = (ms: number) => Effect.sleep(Duration.millis(ms));
const until = (done: Effect.Effect<boolean, unknown, Ledger>, ms = 15_000) =>
	Effect.gen(function* () {
		const t0 = Date.now();
		while (!(yield* done) && Date.now() - t0 < ms) yield* sleep(20);
	});
const countOf = (name: string) => Effect.map(savedState(name, Count), (s) => s.state?.count ?? 0);
const kinds = (rows: readonly Row[], kind: string) => rows.filter((r) => r.kind === kind);

const tree = (spec: SupervisorSpec, events: HostEvent[]) =>
	Effect.gen(function* () {
		const ledger = yield* Ledger;
		yield* ledger.register("sup:1", "test");
		const sup = supervisor("sup:1", spec);
		if (!sup.ok) return yield* Effect.die(sup.why);
		yield* serve({
			name: "sup:1",
			holder: "h-sup",
			program: sup.program,
			listen: (e) => events.push(e),
		});
		for (const c of spec.children)
			yield* serve({
				name: c.name,
				holder: `h-${c.name}`,
				program: child,
				listen: (e) => events.push(e),
			});
		for (const c of spec.children)
			yield* until(Effect.map(ledger.lease(c.name), (l) => l !== null));
	});

const SPEC: SupervisorSpec = {
	strategy: "one_for_one",
	intensity: 5,
	periodMs: 5000,
	children: [
		{name: "c:1", restart: "permanent"},
		{name: "c:2", restart: "permanent"},
	],
};

describe("supervisor", () => {
	it("starts a crashed child again, and its count stays exact", async () => {
		const events: HostEvent[] = [];
		const out = await Effect.runPromise(
			Effect.gen(function* () {
				const ledger = yield* Ledger;
				yield* tree(SPEC, events);
				for (let i = 0; i < 5; i++) yield* cast("c:1", `m${i}`, {}, "sender");
				yield* cast("c:1", "boom", {crashAfter: true}, "sender");
				for (let i = 5; i < 10; i++) yield* cast("c:1", `m${i}`, {}, "sender");
				yield* until(Effect.map(countOf("c:1"), (n) => n === 11));
				const sup = yield* savedState("sup:1", SupervisorState);
				return {
					n: yield* countOf("c:1"),
					c1: yield* ledger.readStream("c:1"),
					sup: sup.state,
				};
			}).pipe(Effect.scoped, Effect.provide(layerMemory())),
		);
		expect(out.n).toBe(11);
		expect(kinds(out.c1, "exited").length).toBe(1);
		expect(kinds(out.c1, "restarted").length).toBe(1);
		expect(out.sup?.restarted).toBe(1);
		expect(out.sup?.phase).toBe("running");
		expect(events.filter((e) => e.ev === "tea_error" && e.phase !== "reduce")).toEqual([]);
	});

	it("sets a poison message aside after three crashes, and the count goes on without it", async () => {
		const events: HostEvent[] = [];
		const out = await Effect.runPromise(
			Effect.gen(function* () {
				const ledger = yield* Ledger;
				yield* tree(SPEC, events);
				for (let i = 0; i < 3; i++) yield* cast("c:1", `m${i}`, {}, "sender");
				yield* cast("c:1", "poison", {poison: true}, "sender");
				for (let i = 3; i < 6; i++) yield* cast("c:1", `m${i}`, {}, "sender");
				yield* until(Effect.map(countOf("c:1"), (n) => n === 6));
				return {
					n: yield* countOf("c:1"),
					c1: yield* ledger.readStream("c:1"),
					dead: yield* ledger.readStream(streams("c:1").dead),
					sup: (yield* savedState("sup:1", SupervisorState)).state,
				};
			}).pipe(Effect.scoped, Effect.provide(layerMemory())),
		);
		expect(out.n).toBe(6);
		expect(kinds(out.c1, "exited").length).toBe(3);
		expect(out.dead.length).toBe(1);
		expect(out.sup?.restarted).toBe(3);
		expect(out.sup?.phase).toBe("running");
	});

	it("with dead letters off, the poison runs it past its intensity and the tree goes down", async () => {
		const events: HostEvent[] = [];
		const spec: SupervisorSpec = {...SPEC, intensity: 3, maxDeliveries: null};
		const out = await Effect.runPromise(
			Effect.gen(function* () {
				const ledger = yield* Ledger;
				yield* tree(spec, events);
				yield* cast("c:1", "poison", {poison: true}, "sender");
				yield* until(Effect.map(ledger.processInfo("sup:1"), (p) => p !== null && p.down !== 0));
				yield* sleep(200);
				return {
					sup: yield* ledger.processInfo("sup:1"),
					c1: yield* ledger.processInfo("c:1"),
					c2: yield* ledger.processInfo("c:2"),
					supRows: yield* ledger.readStream("sup:1"),
					c2Rows: yield* ledger.readStream("c:2"),
					state: (yield* savedState("sup:1", SupervisorState)).state,
				};
			}).pipe(Effect.scoped, Effect.provide(layerMemory({maxDeliveries: null}))),
		);
		expect(out.state?.phase).toBe("shutdown");
		expect(out.state?.restarted).toBe(3);
		expect(out.sup?.down).not.toBe(0);
		expect(out.c1?.down).not.toBe(0);
		expect(out.c2?.down).not.toBe(0);
		const supExit = kinds(out.supRows, "exited")[0];
		expect(supExit?.data).toContain("shutdown");
		// c:2 never crashed: it went down over its link, with its supervisor's reason.
		expect(kinds(out.c2Rows, "exited")[0]?.data).toContain("shutdown");
	});

	it("refuses a spec that one poison message would bring down, and other specs that cannot work", () => {
		expect(supervisor("s", {...SPEC, intensity: 1}).ok).toBe(false);
		expect(supervisor("s", {...SPEC, intensity: 1, maxDeliveries: null}).ok).toBe(true);
		expect(supervisor("s", {...SPEC, periodMs: 0}).ok).toBe(false);
		expect(
			supervisor("s", {
				...SPEC,
				children: [SPEC.children[0], SPEC.children[0]].flatMap((c) => (c ? [c] : [])),
			}).ok,
		).toBe(false);
		expect(supervisor("c:1", SPEC).ok).toBe(false);
	});
});
