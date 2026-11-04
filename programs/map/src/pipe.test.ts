import {
	Ledger,
	listed,
	memoryStorage,
	offer,
	pipe,
	Shell,
	start,
	streams,
	writerText,
} from "@kampus/fabrika-old";
import {memoryService} from "@kampus/fabrika-old/memory";
import {type Fact, nameOf} from "@kampus/pipeline/tickets/ticket";
import {ticket} from "@tea-fabrika/ticket";
import {Author, type One, pullRequestsOf, tracker} from "@tea-fabrika/tracker";
import {OWNER, SEVEN} from "@tea-fabrika/tracker/seven";
import {Deferred, Effect, Fiber, Layer, Option, type Scope, Stream} from "effect";
import {TestClock} from "effect/testing";
import {expect, it} from "vitest";
import {map} from "./index.ts";

// Today's version. All ticket contents, identities, run ids, times and costs in these
// fixtures are made up. SEVEN has seven facts ending in an unanswered approval.
// No home, network, provider or live agent is used. Only the memory ledger's row
// timestamps use its own clock; no assertion depends on them. Program clocks and
// polling use Effect's TestClock, with no wall-clock sleeps.

const THREE: readonly Fact[] = [
	{type: "filed", title: "Made-up documentation correction", body: ""},
];
const NINE: readonly Fact[] = [
	{type: "filed", title: "Made-up running ticket", body: ""},
	{
		type: "started",
		run: "made-up-nine-plan",
		stage: "plan",
		task: null,
		log: null,
		trace: "99999999999999999999999999999999",
	},
];

const facts = (number: number): readonly Fact[] => {
	switch (number) {
		case 7:
			return SEVEN.map((entry) => entry.fact);
		case 3:
			return THREE;
		case 9:
			return NINE;
		default:
			throw new Error(`no fixture for ticket ${number}`);
	}
};

const append = (
	ledger: Ledger["Service"],
	number: number,
	id: string,
	fact: Fact,
	writer = "user:owner",
) => ledger.send(streams(nameOf(number)).inbox, id, {kind: fact.type, writer, data: fact});

const seed = (ledger: Ledger["Service"]) =>
	Effect.gen(function* () {
		for (const number of [7, 3, 9]) yield* ledger.register(nameOf(number), "user:owner");
		for (const entry of SEVEN)
			yield* append(ledger, 7, `fixture/${entry.pos}`, entry.fact, writerText(entry.by));
		for (const [index, fact] of THREE.entries()) yield* append(ledger, 3, `fixture/${index}`, fact);
		for (const [index, fact] of NINE.entries())
			yield* append(ledger, 9, `fixture/${index}`, fact, index === 0 ? "user:owner" : "agent:lane");
	});

const services = (ledger: Ledger["Service"]) =>
	Layer.mergeAll(Layer.succeed(Ledger, ledger), Layer.succeed(Author, OWNER), pullRequestsOf([]));

const go = <A, E>(effect: Effect.Effect<A, E, Scope.Scope>) =>
	Effect.runPromise(effect.pipe(Effect.scoped, Effect.provide(TestClock.layer())));

/** Hold real ledger replies at the service boundary, without changing the reducer. */
const holdReads = (ledger: Ledger["Service"]) =>
	Effect.gen(function* () {
		const entered = yield* Deferred.make<void>();
		const released = yield* Deferred.make<void>();
		const held: Ledger["Service"] = {
			...ledger,
			read: (...args: Parameters<Ledger["Service"]["read"]>) =>
				Effect.gen(function* () {
					const rows = yield* ledger.read(...args);
					yield* Deferred.succeed(entered, undefined);
					yield* Deferred.await(released);
					return rows;
				}),
		};
		return {
			ledger: held,
			entered: Deferred.await(entered),
			release: Deferred.succeed(released, undefined),
		};
	});

const openMap = (ledger: Ledger["Service"], initial: number | undefined) =>
	Effect.gen(function* () {
		const started = yield* start(
			map,
			{ticket: initial},
			{},
			{id: "map:pipe-test", storage: memoryStorage()},
		).pipe(Effect.provide(services(ledger)));
		expect(started.kind).toBe("running");
		if (started.kind !== "running") throw new Error(JSON.stringify(started));
		const ended = yield* Effect.forkChild(started.run.ended);
		const until = (accept: (view: One) => boolean) =>
			started.run.machines.tickets.changes.pipe(
				Stream.filter((state) => state !== null),
				Stream.map((state) => map.view.of(state)),
				Stream.filter(accept),
				Stream.runHead,
				Effect.map(Option.getOrThrow),
			);
		return {started, run: started.run, close: started.close, ended, until};
	});

/** Real tracker and ticket programs, wired with the public pipe API. */
const openPipe = (
	ledger: Ledger["Service"],
	mapLedger: Ledger["Service"],
	initial: number | undefined,
) =>
	Effect.gen(function* () {
		const target = yield* openMap(mapLedger, initial);
		const middle = yield* pipe(
			{
				program: ticket,
				flags: {ticket: undefined},
				keeping: {id: "ticket:pipe-test", storage: memoryStorage()},
			},
			"ticket",
			target.started,
			"ticket",
		).pipe(Effect.provide(services(ledger)));
		expect(middle.kind).toBe("running");
		if (middle.kind !== "running") throw new Error(JSON.stringify(middle));
		const source = yield* pipe(
			{
				program: tracker,
				flags: {},
				keeping: {id: "tracker:pipe-test", storage: memoryStorage()},
			},
			"ticket",
			middle,
			"ticket",
		).pipe(Effect.provide(services(ledger)));
		expect(source.kind).toBe("running");
		if (source.kind !== "running") throw new Error(JSON.stringify(source));
		const pick = (number: number) => offer(source.run, "query", {ticket: number});
		const endUpstream = Effect.gen(function* () {
			yield* offer(source.run, "quit", null);
			expect((yield* source.run.ended).kind).toBe("ended");
			yield* offer(middle.run, "quit", null);
			expect((yield* middle.run.ended).kind).toBe("ended");
		});
		return {target, pick, endUpstream};
	});

const shows = (view: One, number: number, added: readonly Fact[] = []) => {
	expect(view.ready).toBe(true);
	expect(view.number).toBe(number);
	expect(view.ticket?.number).toBe(number);
	expect(view.ticket?.timeline.map((entry) => entry.fact)).toEqual([...facts(number), ...added]);
};

it("p1: the shell feeds ticket numbers through tracker | ticket | map", () => {
	const layer = services(memoryService());
	const programs = Shell.programList([
		listed(tracker, layer),
		listed(ticket, layer),
		listed(map, layer),
	]);
	const text = "tracker | ticket | map";
	const parsed = Shell.parse(text);
	expect(parsed.kind).toBe("parsed");
	if (parsed.kind !== "parsed" || parsed.statements[0]?.kind !== "run")
		throw new Error("expected a parsed pipeline");
	const checked = Shell.check(parsed.statements[0].pipeline, programs, text);
	expect(checked.kind).toBe("line");
	if (checked.kind !== "line") throw new Error(JSON.stringify(checked));
	expect(checked.line.stages.map((stage) => stage.wire)).toEqual([
		{output: "ticket", input: "ticket"},
		{output: "ticket", input: "ticket"},
		null,
	]);
	expect(checked.line.stages.at(-1)?.fed).toBe("ticket");
	expect(Shell.fedBy(map, programs)).toEqual(["ticket"]);
});

it("p2: map without a flag stays running and unselected across ledger loading", async () => {
	await go(
		Effect.gen(function* () {
			const ledger = memoryService();
			yield* seed(ledger);
			const held = yield* holdReads(ledger);
			const session = yield* openMap(held.ledger, undefined);
			yield* held.entered;
			const before = yield* session.until((view) => !view.ready);
			expect(before.number).toBeNull();
			expect(before.ticket).toBeNull();
			expect(session.ended.pollUnsafe()).toBeUndefined();
			yield* held.release;
			const loaded = yield* session.until((view) => view.ready);
			expect(loaded.number).toBeNull();
			expect(loaded.ticket).toBeNull();
			yield* TestClock.adjust("1 minute");
			const later = yield* session.until((view) => view.now > loaded.now);
			expect(later.number).toBeNull();
			expect(later.ticket).toBeNull();
			expect(session.ended.pollUnsafe()).toBeUndefined();
			yield* offer(session.run, "quit", null);
			expect((yield* Fiber.join(session.ended)).kind).toBe("ended");
		}),
	);
});

it("p3: the latest ticket wins before and after ledger replies, including repeats and flag replacement", async () => {
	await go(
		Effect.gen(function* () {
			for (const initial of [undefined, 3]) {
				yield* Effect.gen(function* () {
					const ledger = memoryService();
					yield* seed(ledger);
					const held = yield* holdReads(ledger);
					const line = yield* openPipe(ledger, held.ledger, initial);
					const session = line.target;
					yield* held.entered;
					const first = yield* session.until((view) => view.number === (initial ?? null));
					expect(first.ready).toBe(false);
					const early = initial === undefined ? [7, 7, 3, 9] : [9, 7];
					for (const number of early) {
						expect(yield* line.pick(number)).toBe("queued");
						const selected = yield* session.until((view) => view.number === number);
						expect(selected.ready).toBe(false);
					}
					yield* held.release;
					shows(yield* session.until((view) => view.ready), early.at(-1)!);
					for (const number of [7, 3, 9, 7]) {
						expect(yield* line.pick(number)).toBe("queued");
						shows(yield* session.until((view) => view.number === number), number);
						// Upstream programs coalesce repeats. Also deliver a duplicate directly
						// so map's own ticket handler is exercised with repeated input.
						expect(yield* offer(session.run, "ticket", number)).toBe("queued");
						const before = yield* session.until((view) => view.number === number);
						yield* TestClock.adjust("1 minute");
						shows(yield* session.until((view) => view.now > before.now), number);
					}
					yield* line.endUpstream;
					yield* offer(session.run, "quit", null);
					expect((yield* Fiber.join(session.ended)).kind).toBe("ended");
				}).pipe(Effect.scoped);
			}
		}),
	);
});

it("p4: closing ticket input preserves waiting or the last selection and later ledger updates", async () => {
	await go(
		Effect.gen(function* () {
			// No input values: close before the first read, both with and without a flag.
			for (const initial of [undefined, 3]) {
				yield* Effect.gen(function* () {
					const ledger = memoryService();
					yield* seed(ledger);
					const held = yield* holdReads(ledger);
					const session = yield* openMap(held.ledger, initial);
					yield* held.entered;
					session.close("ticket");
					yield* held.release;
					const loaded = yield* session.until((view) => view.ready);
					expect(loaded.number).toBe(initial ?? null);
					if (initial === undefined) expect(loaded.ticket).toBeNull();
					else shows(loaded, initial);
					yield* TestClock.adjust("1 minute");
					const later = yield* session.until((view) => view.now > loaded.now);
					expect(later.number).toBe(initial ?? null);
					if (initial === undefined) expect(later.ticket).toBeNull();
					else shows(later, initial);
					expect(session.ended.pollUnsafe()).toBeUndefined();
					yield* offer(session.run, "quit", null);
					expect((yield* Fiber.join(session.ended)).kind).toBe("ended");
				}).pipe(Effect.scoped);
			}

			const ledger = memoryService();
			yield* seed(ledger);
			const line = yield* openPipe(ledger, ledger, undefined);
			const session = line.target;
			yield* session.until((view) => view.ready);
			for (const number of [7, 3, 9, 7]) {
				yield* line.pick(number);
				shows(yield* session.until((view) => view.number === number), number);
			}
			// Ending the real writer closes map's ticket input through pipe's lifecycle.
			yield* line.endUpstream;
			expect(yield* offer(session.run, "ticket", 3)).toBe("closed");
			const added: Fact = {type: "commented", body: "Made-up fact after upstream closure."};
			yield* append(ledger, 7, "after-upstream", added);
			// Give the existing ledger poll its turns using only the test clock.
			yield* TestClock.adjust("1 minute");
			const updated = yield* session.until(
				(view) =>
					view.ticket?.timeline.some(
						(entry) => entry.fact.type === "commented" && entry.fact.body === added.body,
					) === true,
			);
			shows(updated, 7, [added]);
			expect(session.ended.pollUnsafe()).toBeUndefined();
			yield* offer(session.run, "quit", null);
			expect((yield* Fiber.join(session.ended)).kind).toBe("ended");
		}),
	);
});

it("p5: map --ticket 7 exposes ticket 7 and all its ledger facts", async () => {
	await go(
		Effect.gen(function* () {
			const ledger = memoryService();
			yield* seed(ledger);
			const session = yield* openMap(ledger, 7);
			shows(yield* session.until((view) => view.ready && view.number === 7), 7);
			yield* offer(session.run, "quit", null);
			yield* Fiber.join(session.ended);
		}),
	);
});

it("p6: explicit quit ends a map started with --ticket 7", async () => {
	await go(
		Effect.gen(function* () {
			const ledger = memoryService();
			yield* seed(ledger);
			const session = yield* openMap(ledger, 7);
			yield* session.until((view) => view.ready && view.number === 7);
			expect(session.ended.pollUnsafe()).toBeUndefined();
			expect(yield* offer(session.run, "quit", null)).toBe("queued");
			expect((yield* Fiber.join(session.ended)).kind).toBe("ended");
		}),
	);
});

it("p7: closing quit ends map while ticket input remains open", async () => {
	await go(
		Effect.gen(function* () {
			const ledger = memoryService();
			yield* seed(ledger);
			const session = yield* openMap(ledger, 7);
			yield* session.until((view) => view.ready && view.number === 7);
			// Prove the data input exists and is open; never close it in this test.
			expect(yield* offer(session.run, "ticket", 7)).toBe("queued");
			session.close("quit");
			expect((yield* Fiber.join(session.ended)).kind).toBe("ended");
		}),
	);
});
