import {defineMachine} from "@demlik/tea";
import {Duration, Effect, Exit, Schema, Scope, Stream} from "effect";
import {describe, expect, it} from "vitest";
import {defineProgram} from "../program/program.ts";
import {input} from "../program/shape.ts";
import {cast, envelope, type HostEvent, Self, savedState, serve} from "./host.ts";
import {Ledger} from "./ledger.ts";
import {layerMemory} from "./memory.ts";
import {whereis} from "./observer.ts";

// The host on the in-memory ledger: two hosts serve one counter; the one that holds it goes away;
// the other takes over, replays, and the count is exact. The fault runs (kills, freezes, Docker)
// are experiments/98-tea-host-package.ts.

const Count = Schema.Struct({
	count: Schema.Number,
	cursor: Schema.Number,
	last: Schema.NullOr(Schema.String),
});
type Count = typeof Count.Type;
type Inc = {readonly type: "inc"; readonly id: string; readonly rev: number};

const counter = defineMachine({
	types: {model: {} as Count, msg: {} as Inc, ctx: undefined},
	cmds: [],
	init: (loaded) => [loaded ?? {count: 0, cursor: 0, last: null}, []],
	update: {
		inc: (s, m) =>
			m.rev <= s.cursor ? [s, []] : [{count: s.count + 1, cursor: m.rev, last: m.id}, []],
	},
});

const counterProgram = defineProgram({
	name: "counter",
	description: "Counts the messages in its inbox, once each.",
	inputs: {inbox: input(envelope(Schema.Struct({})), "One message.")},
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
				Stream.runForEach((e) => machine.dispatch({type: "inc", id: e.id, rev: e.rev})),
			);
		}).pipe(Effect.scoped),
});

const sleep = (ms: number) => Effect.sleep(Duration.millis(ms));
const countOf = Effect.map(savedState("counter:1", Count), (s) => s.state?.count ?? 0);
const until = (done: Effect.Effect<boolean, unknown, Ledger>, ms = 10_000) =>
	Effect.gen(function* () {
		const t0 = Date.now();
		while (!(yield* done) && Date.now() - t0 < ms) yield* sleep(20);
	});

describe("serve", () => {
	it("hands a counter from one host to another, and the count stays exact", async () => {
		const events: HostEvent[] = [];
		const out = await Effect.runPromise(
			Effect.gen(function* () {
				const ledger = yield* Ledger;
				yield* ledger.register("counter:1", "test");
				const hosts = ["a", "b"].map((h) => ({h, scope: Effect.runSync(Scope.make())}));
				for (const {h, scope} of hosts)
					yield* serve({
						name: "counter:1",
						holder: h,
						program: counterProgram,
						listen: (e) => events.push(e),
					}).pipe(Scope.provide(scope));
				for (let i = 0; i < 50; i++) yield* cast("counter:1", `m${i}`, {}, "sender");
				yield* until(Effect.map(countOf, (n) => n === 50));
				const first = yield* whereis("counter:1");
				const owner = hosts.find((x) => x.h === first.holder);
				if (owner !== undefined) yield* Scope.close(owner.scope, Exit.void);
				for (let i = 50; i < 100; i++) yield* cast("counter:1", `m${i}`, {}, "sender");
				yield* until(Effect.map(countOf, (n) => n === 100));
				const second = yield* whereis("counter:1");
				const n = yield* countOf;
				for (const {scope} of hosts) yield* Scope.close(scope, Exit.void);
				return {first, second, n};
			}).pipe(Effect.provide(layerMemory())),
		);
		expect(out.n).toBe(100);
		expect(out.first.registered).toBe(true);
		expect(out.second.holder).not.toBe(out.first.holder);
		expect(out.second.fence ?? 0).toBeGreaterThan(out.first.fence ?? 0);
		expect(events.filter((e) => e.ev === "tea_error")).toEqual([]);
		expect(events.filter((e) => e.ev === "program" && e.phase === "started").length).toBe(2);
	});

	it("waits on a name nobody registered, and writes nothing under it", async () => {
		const events: HostEvent[] = [];
		const rows = await Effect.runPromise(
			Effect.gen(function* () {
				const ledger = yield* Ledger;
				yield* serve({
					name: "nobody:1",
					holder: "a",
					program: counterProgram,
					listen: (e) => events.push(e),
				});
				const sent = yield* cast("nobody:1", "m1", {}, "sender");
				yield* sleep(300);
				return {sent, rows: yield* ledger.read(0, 100, "nobody:1")};
			}).pipe(Effect.scoped, Effect.provide(layerMemory())),
		);
		expect(rows.sent.how).toBe("unknown");
		expect(rows.rows).toEqual([]);
		expect(events.some((e) => e.ev === "claim" && e.answer === "unknown")).toBe(true);
	});

	it("refuses a store or an error sink from the program: the host gives both", () => {
		const refused = Effect.gen(function* () {
			const self = yield* Self;
			yield* self.run(
				counter,
				{schema: Count, cursor: (s) => s.cursor},
				{
					ctx: undefined,
					// @ts-expect-error The error sink is the host's to give.
					onError: () => {},
				},
			);
			yield* self.run(
				counter,
				{schema: Count, cursor: (s) => s.cursor},
				{
					ctx: undefined,
					// @ts-expect-error The journal is the host's to give.
					store: {},
				},
			);
		});
		expect(typeof refused).toBe("object");
	});
});
