import {Deferred, Effect, Fiber, Layer, Stream} from "effect";
import {describe, expect, it} from "vitest";
import {listing, type RunOf, readFlags, start, tell} from "../../program/program.ts";
import {CodeHost, CodeHostWrites} from "../../services.ts";
import type {ShipFacts} from "./facts.ts";
import {launch, type Parts} from "./launch.ts";
import type {Look} from "./look.ts";
import {type Shipped, shipProgram} from "./program.ts";

// The ship program, started from code the way a parent would start it: fake
// services as Layers, pull requests told on its input while it runs, and an
// outcome heard on the output for each one. The stand-in parent here is a few
// lines; `operate` is the real one, and is not wired to this yet.
//
// The ship machine takes one pull request per run (it ends at `over`), so the
// program starts a fresh one for each pull request it is told, one after
// another, inside one program run that keeps going until it is stopped.

const url = (n: number) => `https://github.com/example/repo/pull/${n}`;

/** A pull request with nothing in its way. */
const clear: ShipFacts = {
	head: "abc1234",
	state: "open",
	ours: true,
	ticket: "closes_it",
	approval: "not_needed",
	reviews: "passed",
	reviewKinds: [],
	checks: "green",
	mergeable: "clean",
	comments: [],
};

/** How the fake world answers for one pull request. */
interface World {
	/** The facts every read gets. `fails`: the read breaks. */
	readonly facts: ShipFacts | "fails";
	readonly enqueue?: "queued" | "conflicts" | "fails";
}

/** Fake `CodeHost` and `CodeHostWrites` over a table of pull requests. `writes`: each write, in order. */
function fake(worlds: ReadonlyMap<string, World>) {
	const writes: string[] = [];
	const reads: string[] = [];
	const world = (pr: string): World => {
		const found = worlds.get(pr);
		if (found === undefined) throw new Error(`no world for ${pr}`);
		return found;
	};
	const broke = Effect.fail({_tag: "unknown" as const});
	const host = Layer.succeed(CodeHost, {
		prFacts: (pr) => {
			reads.push(pr);
			const {facts} = world(pr);
			return facts === "fails" ? broke : Effect.succeed(facts);
		},
		change: () => broke,
		// The checks settle at once; the facts read after say how they went.
		checksSettled: () => Stream.make(undefined),
		leftQueue: (pr) => Stream.make({reading: "landed" as const, commit: `merged-${pr.slice(-1)}`}),
	});
	const hostWrites = Layer.succeed(CodeHostWrites, {
		enqueue: (pr, head) => {
			writes.push(`enqueue ${pr} ${head}`);
			const answer = world(pr).enqueue ?? "queued";
			return answer === "fails" ? broke : Effect.succeed(answer);
		},
		rerunChecks: (pr, head) => {
			writes.push(`rerun ${pr} ${head}`);
			return Effect.succeed([{run: 11, attempt: 1}]);
		},
	});
	return {host, hostWrites, writes, reads, both: Layer.mergeAll(host, hostWrites)};
}

const WORLDS: ReadonlyMap<string, World> = new Map([
	[url(1), {facts: clear}],
	[url(2), {facts: {...clear, checks: "red"}}],
	[url(3), {facts: {...clear, approval: "missing"}}],
	[url(4), {facts: clear, enqueue: "fails"}],
	[url(5), {facts: "fails"}],
	[url(6), {facts: {...clear, ticket: "part_of_it"}}],
]);

type ShipRun = RunOf<typeof shipProgram>;

/** Wait until `run` has sent `n` outcomes, counting the ones before. */
const outcomes = (run: ShipRun, n: number) =>
	Effect.gen(function* () {
		const heard: Shipped[] = [];
		const enough = yield* Deferred.make<readonly Shipped[]>();
		const off = run.listen("outcome", (shipped) => {
			heard.push(shipped);
			if (heard.length === n) Deferred.doneUnsafe(enough, Effect.succeed([...heard]));
		});
		const got = yield* Deferred.await(enough);
		off();
		return got;
	});

/** Start the ship program in write mode on the fake world, and hand its run to `body`. */
const writing = <A, E>(
	world: ReturnType<typeof fake>,
	body: (run: ShipRun) => Effect.Effect<A, E>,
) =>
	Effect.runPromise(
		Effect.gen(function* () {
			const started = yield* start(shipProgram, {mode: "write"});
			if (started.kind !== "running") return yield* Effect.die(`did not start: ${started.why}`);
			return yield* body(started.run);
		}).pipe(Effect.scoped, Effect.provide(world.both)),
	);

describe("a parent starts the ship program and feeds it pull requests", () => {
	it("six pull requests told over time, in two batches, to one run: each outcome is heard in order, and the run keeps going until it is stopped", async () => {
		const world = fake(WORLDS);
		const seen = await writing(world, (run) =>
			Effect.gen(function* () {
				const firstWords = [url(1), url(2), url(3)].map((pr) => tell(run, "pr", pr));
				yield* outcomes(run, 3);
				const writesBetween = [...world.writes];
				const laterWords = [url(4), url(5), url(6)].map((pr) => tell(run, "pr", pr));
				const all = yield* outcomes(run, 6);
				const last = run.machines.ship.state();
				const ended = yield* run.stop;
				return {firstWords, writesBetween, laterWords, all, last, ended};
			}),
		);

		expect(seen.firstWords).toEqual(["queued", "queued", "queued"]);
		expect(seen.laterWords).toEqual(["queued", "queued", "queued"]);
		expect(seen.all.map((o) => [o.pr, o.name])).toEqual([
			[url(1), "done"],
			[url(2), "send:builder:checks_red"],
			[url(3), "ask:owner:approval"],
			[url(4), "stuck:enqueue_failed"],
			[url(5), "stuck:read_failed"],
			[url(6), "done:part"],
		]);
		expect(seen.all[0]?.outcome).toEqual({
			kind: "done",
			part: false,
			commit: "merged-1",
			cleanup: "done",
		});
		// The first batch was done before the second was told.
		expect(seen.writesBetween).toEqual([`enqueue ${url(1)} abc1234`, `rerun ${url(2)} abc1234`]);
		// The writes, in order: red checks run again once for #2, and an enqueue each for the three that passed the gate.
		expect(world.writes).toEqual([
			`enqueue ${url(1)} abc1234`,
			`rerun ${url(2)} abc1234`,
			`enqueue ${url(4)} abc1234`,
			`enqueue ${url(6)} abc1234`,
		]);
		// #2 was read twice: once before the re-run, once after its checks settled again.
		expect(world.reads.filter((pr) => pr === url(2))).toHaveLength(2);
		// The handle shows the newest run of the machine: #6's, at its end.
		expect(seen.last).toMatchObject({phase: "over", pr: url(6)});
		expect(seen.ended).toEqual({kind: "stopped"});
	});

	it("the same pull requests told twice, to two runs, give the same outcomes", async () => {
		const once = () =>
			writing(fake(WORLDS), (run) =>
				Effect.gen(function* () {
					for (let n = 1; n <= 6; n++) tell(run, "pr", url(n));
					return (yield* outcomes(run, 6)).map((o) => o.name);
				}),
			);
		expect(await once()).toEqual(await once());
	});

	it("the machine's state shows on the handle by name, with each change, from idle to over", async () => {
		const phases = await writing(fake(WORLDS), (run) =>
			Effect.gen(function* () {
				const first = yield* Deferred.make<void>();
				const watching = yield* run.machines.ship.changes.pipe(
					Stream.tap(() => Deferred.succeed(first, undefined)),
					Stream.filter((state) => state !== null),
					Stream.map((state) => state.phase),
					Stream.runCollect,
					Effect.forkChild,
				);
				yield* Deferred.await(first);
				const before = run.machines.ship.state();
				tell(run, "pr", url(1));
				yield* outcomes(run, 1);
				yield* run.stop;
				return {before, phases: [...(yield* Fiber.join(watching))]};
			}),
		);
		// No pull request yet, so no run of the machine yet.
		expect(phases.before).toBeNull();
		expect(phases.phases[0]).toBe("idle");
		expect(phases.phases).toContain("reading");
		expect(phases.phases).toContain("enqueueing");
		expect(phases.phases.at(-1)).toBe("over");
	});

	it("tell answers bad_shape for a url that is not a pull request's, at once, and nothing is read", async () => {
		const world = fake(WORLDS);
		const words = await writing(world, (run) =>
			Effect.succeed([
				tell(run, "pr", "https://github.com/example/repo/issues/9"),
				run.tell("prs", [url(1)]),
			]),
		);
		expect(words).toEqual(["bad_shape", "no_cell"]);
		expect(world.reads).toEqual([]);
		expect(world.writes).toEqual([]);
	});

	it("from a host's JSON: a mode it does not have is a bad_shape flag", () => {
		expect(readFlags(shipProgram, {mode: "merge"})).toMatchObject({
			kind: "bad_shape",
			name: "mode",
		});
		expect(readFlags(shipProgram, {mode: "read"})).toEqual({
			kind: "given",
			flags: {mode: "read"},
		});
	});
});

describe("the launcher, the way run.ts uses it", () => {
	const reading = (world: ReturnType<typeof fake>): Parts => ({
		reads: () => world.host,
		writes: () => {
			throw new Error("read mode made the write side");
		},
	});
	const who = {own: ["a"], reviewers: ["a"]} as const;

	it("read mode over three pull requests: what each would do is heard, and nothing is written", async () => {
		const world = fake(WORLDS);
		const found: Look[] = [];

		const launched = await Effect.runPromise(
			launch({prs: [url(1), url(2), url(3)], mode: "read", ...who}, reading(world), {
				found: (f) => found.push(f),
			}),
		);

		expect(launched).toEqual({kind: "ran"});
		expect(found.map((f) => [f.name, f.wouldSend?.type ?? null])).toEqual([
			[null, "ship_enqueue"],
			[null, "ship_rerun_checks"],
			["ask:owner:approval", null],
		]);
		expect(world.writes).toEqual([]);
	});

	it("a url that is not a pull request's answers bad_shape before anything runs: no service made, nothing read", async () => {
		const world = fake(WORLDS);
		const made: string[] = [];
		const parts: Parts = {
			reads: () => {
				made.push("reads");
				return world.host;
			},
			writes: () => {
				made.push("writes");
				return world.hostWrites;
			},
		};
		const launched = await Effect.runPromise(
			launch(
				{prs: [url(1), "https://github.com/example/repo/issues/9"], mode: "write", ...who},
				parts,
				{},
			),
		);

		expect(launched).toMatchObject({kind: "bad_shape", name: "pr"});
		expect(made).toEqual([]);
		expect(world.reads).toEqual([]);
	});
});

describe("the ship program's listing", () => {
	it("names the program, its flag, input, outputs and machine, each with a description and a JSON Schema", () => {
		const shown = listing(shipProgram);

		expect(shown.name).toBe("ship");
		expect(shown.description).toMatch(/merge queue/);
		expect(shown.flags.map((f) => f.name)).toEqual(["mode"]);
		expect(shown.inputs.map((i) => i.name)).toEqual(["pr"]);
		expect(shown.outputs.map((o) => o.name)).toEqual(["found", "outcome"]);
		expect(shown.machines).toEqual(["ship"]);
		// The url's pattern is not in it: Effect 4.0.0 leaves patterns out of JSON Schema. Its description says the form.
		expect(shown.inputs[0]?.schema).toEqual({
			type: "string",
			description: "https://github.com/<owner>/<repo>/pull/<number>",
		});
		expect(shown.flags[0]?.schema).toEqual({type: "string", enum: ["read", "write"]});
		expect(shown.outputs[1]?.schema).toMatchObject({
			type: "object",
			required: ["pr", "outcome", "name"],
			additionalProperties: false,
		});
		for (const one of [...shown.flags, ...shown.inputs, ...shown.outputs]) {
			expect(one.description.length).toBeGreaterThan(10);
			expect(one.schema).toBeDefined();
		}
	});
});
