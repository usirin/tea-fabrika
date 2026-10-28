import {ear, memoryStorage, start, tell} from "@kampus/fabrika";
import * as Program from "@kampus/fabrika/spike/serve";
import {Effect, Layer, Stream} from "effect";
import {describe, expect, it} from "vitest";
import {CriteriaRecord} from "../../criteria/record.ts";
import {CodeHost, CodeHostWrites} from "../../services.ts";
import type {PrFacts} from "./facts.ts";
import {type Answer, type Forget, type Shipped, shipProgram} from "./program.ts";
import {ON_TIP, provenAt, TICKET} from "./scripted.ts";
import {spikeShip} from "./spike-serve.ts";

// Experiment 164: ship on one mailbox (./spike-serve.ts), beside ship today
// (./program.ts). A lean copy of ./program.test.ts's fake world: every pull
// request is clear, and one may be held in the merge queue for good.

const url = (n: number) => `https://github.com/example/repo/pull/${n}`;

const clear: PrFacts = {
	head: "abc1234",
	state: "open",
	ours: true,
	ticket: {id: TICKET, link: "closes_it"},
	approval: "not_needed",
	reviews: [{kind: "review-code", verdict: "passed"}],
	checks: "green",
	mergeable: "clean",
	comments: [],
	main: ON_TIP,
};

/** Every pull request is clear; the ones in `held` stay in the merge queue for good. */
const world = (held: ReadonlySet<string> = new Set()) => {
	const broke = Effect.fail({_tag: "unknown" as const});
	const host = Layer.succeed(CodeHost, {
		pullRequests: () => Effect.succeed([]),
		prFacts: () => Effect.succeed(clear),
		change: () => broke,
		checksSettled: () => Stream.fromEffect(Effect.void),
		leftQueue: (pr) =>
			Stream.fromEffect(
				(held.has(pr) ? Effect.never : Effect.void).pipe(
					Effect.as({reading: "landed" as const, commit: `merged-${pr.slice(-1)}`}),
				),
			),
	});
	const writes = Layer.succeed(CodeHostWrites, {
		enqueue: () => Effect.succeed("queued" as const),
		merge: () => broke,
		rerunChecks: () => Effect.succeed([{run: 11, attempt: 1}]),
	});
	const record = Layer.succeed(CriteriaRecord, {
		read: () => Effect.sync(() => provenAt("abc1234")),
		judged: () => Effect.void,
	});
	return Layer.mergeAll(host, writes, record);
};

const kept = () => ({id: "ship:spike", storage: memoryStorage()});

describe("ship on one mailbox", () => {
	it("two pull requests, then an ask, told before ship reads: shipped in the order told; today the ask can go second", async () => {
		const told = [url(1), url(2)];
		const ask = {id: "lane-3/ship", pr: url(3)};
		const today = await Effect.runPromise(
			Effect.gen(function* () {
				const outcomes = ear<Shipped>();
				const started = yield* start(
					shipProgram,
					{mode: "write"},
					{outcome: outcomes.hear},
					kept(),
				);
				if (started.kind !== "running") return yield* Effect.die("did not start");
				for (const pr of told) yield* tell(started.run, "pr", pr);
				yield* tell(started.run, "ask", ask);
				return (yield* outcomes.upTo(3)).map((o) => o.pr);
			}).pipe(Effect.scoped, Effect.provide(world())),
		);
		const spike = await Effect.runPromise(
			Effect.gen(function* () {
				const outcomes = ear<Shipped>();
				const started = yield* Program.start(
					spikeShip,
					{mode: "write"},
					{outcome: outcomes.hear},
					kept(),
				);
				if (started.kind !== "running") return yield* Effect.die("did not start");
				for (const pr of told) yield* Program.tell(started.run, "pr", pr);
				yield* Program.tell(started.run, "ask", ask);
				return (yield* outcomes.upTo(3)).map((o) => o.pr);
			}).pipe(Effect.scoped, Effect.provide(world())),
		);
		expect(spike).toEqual([url(1), url(2), url(3)]);
		expect(today).toEqual([url(1), url(3), url(2)]);
	});

	it("a forget, in order and not forked, is said while another pull request sits in the merge queue", async () => {
		const ask = {id: "lane-1/ship", pr: url(1)};
		const seen = await Effect.runPromise(
			Effect.gen(function* () {
				const answers = ear<Answer>();
				const forgot = ear<Forget>();
				const outcomes = ear<Shipped>();
				const started = yield* Program.start(
					spikeShip,
					{mode: "write"},
					{answer: answers.hear, forgot: forgot.hear, outcome: outcomes.hear},
					kept(),
				);
				if (started.kind !== "running") return yield* Effect.die("did not start");
				yield* Program.tell(started.run, "ask", ask);
				yield* answers.upTo(1);
				// Held in the merge queue for good: the queue's worker never gets past it.
				yield* Program.tell(started.run, "pr", url(7));
				yield* started.run.machines.ship.changes.pipe(
					Stream.filter((s) => s?.phase === "queued"),
					Stream.take(1),
					Stream.runDrain,
				);
				yield* Program.tell(started.run, "forget", {id: ask.id});
				const said = yield* forgot.upTo(1);
				return {
					said,
					outcomes: outcomes.values.map((o) => o.pr),
					ship: started.run.machines.ship.state()?.phase,
				};
			}).pipe(Effect.scoped, Effect.provide(world(new Set([url(7)])))),
		);
		expect(seen).toEqual({said: [{id: "lane-1/ship"}], outcomes: [url(1)], ship: "queued"});
	});

	it("when `pr` closes, what was told before it still ships, and the run ends", async () => {
		const seen = await Effect.runPromise(
			Effect.gen(function* () {
				const outcomes = ear<Shipped>();
				const started = yield* Program.start(
					spikeShip,
					{mode: "write"},
					{outcome: outcomes.hear},
					kept(),
				);
				if (started.kind !== "running") return yield* Effect.die("did not start");
				yield* Program.tell(started.run, "pr", url(1));
				yield* Program.tell(started.run, "ask", {id: "lane-2/ship", pr: url(2)});
				started.close("pr");
				return {ended: yield* started.run.ended, outcomes: outcomes.values.map((o) => o.pr)};
			}).pipe(Effect.scoped, Effect.provide(world())),
		);
		const today = await Effect.runPromise(
			Effect.gen(function* () {
				const outcomes = ear<Shipped>();
				const started = yield* start(
					shipProgram,
					{mode: "write"},
					{outcome: outcomes.hear},
					kept(),
				);
				if (started.kind !== "running") return yield* Effect.die("did not start");
				yield* tell(started.run, "pr", url(1));
				yield* tell(started.run, "ask", {id: "lane-2/ship", pr: url(2)});
				started.close("pr");
				return {ended: yield* started.run.ended, outcomes: outcomes.values.map((o) => o.pr)};
			}).pipe(Effect.scoped, Effect.provide(world())),
		);
		expect(seen).toEqual({ended: {kind: "ended", unread: {}}, outcomes: [url(1), url(2)]});
		// Today's merge read the ask too, in this timing: the close lost nothing on either shape.
		expect(today).toEqual(seen);
	});
});
