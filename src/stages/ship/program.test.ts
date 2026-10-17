import {Effect, Layer, Stream} from "effect";
import {describe, expect, it} from "vitest";
import {listing, readInputs, start} from "../../program/program.ts";
import {CodeHost, CodeHostWrites} from "../../services.ts";
import type {ShipFacts} from "./facts.ts";
import {launch, type Parts} from "./launch.ts";
import type {Look} from "./look.ts";
import {type Shipped, shipProgram} from "./program.ts";

// The ship program, started from code the way a parent would start it: fake
// services as Layers, a list of pull requests in, and an outcome heard on the
// output for each one. The stand-in parent here is a few lines; `operate` is
// the real one, and is not wired to this yet.
//
// The ship machine takes one pull request per run (it ends at `over`), so the
// program runs it once per pull request, one after another, inside one
// program run.

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
	return {host, hostWrites, writes, reads};
}

const WORLDS: ReadonlyMap<string, World> = new Map([
	[url(1), {facts: clear}],
	[url(2), {facts: {...clear, checks: "red"}}],
	[url(3), {facts: {...clear, approval: "missing"}}],
	[url(4), {facts: clear, enqueue: "fails"}],
	[url(5), {facts: "fails"}],
	[url(6), {facts: {...clear, ticket: "part_of_it"}}],
]);
const PRS = [url(1), url(2), url(3), url(4), url(5), url(6)] as const;

describe("a parent starts the ship program from code", () => {
	it("six pull requests in one program run: each outcome is heard on the output, in order", async () => {
		const world = fake(WORLDS);
		const heard: Shipped[] = [];

		const started = await Effect.runPromise(
			start(shipProgram, {prs: PRS, mode: "write"}, {outcome: (o) => heard.push(o)}).pipe(
				Effect.provide(Layer.mergeAll(world.host, world.hostWrites)),
			),
		);

		expect(started).toEqual({kind: "ran"});
		expect(heard.map((o) => [o.pr, o.name])).toEqual([
			[url(1), "done"],
			[url(2), "send:builder:checks_red"],
			[url(3), "ask:owner:approval"],
			[url(4), "stuck:enqueue_failed"],
			[url(5), "stuck:read_failed"],
			[url(6), "done:part"],
		]);
		expect(heard[0]?.outcome).toEqual({
			kind: "done",
			part: false,
			commit: "merged-1",
			cleanup: "done",
		});
		// The writes, in order: red checks run again once for #2, and an enqueue each for the three that passed the gate.
		expect(world.writes).toEqual([
			`enqueue ${url(1)} abc1234`,
			`rerun ${url(2)} abc1234`,
			`enqueue ${url(4)} abc1234`,
			`enqueue ${url(6)} abc1234`,
		]);
		// #2 was read twice: once before the re-run, once after its checks settled again.
		expect(world.reads.filter((pr) => pr === url(2))).toHaveLength(2);
	});

	it("the same program run twice gives the same outcomes", async () => {
		const once = async () => {
			const world = fake(WORLDS);
			const names: string[] = [];
			await Effect.runPromise(
				start(shipProgram, {prs: PRS, mode: "write"}, {outcome: (o) => names.push(o.name)}).pipe(
					Effect.provide(Layer.mergeAll(world.host, world.hostWrites)),
				),
			);
			return names;
		};
		expect(await once()).toEqual(await once());
	});

	it("read mode over three pull requests: what each would do is heard, and nothing is written", async () => {
		const world = fake(WORLDS);
		const found: Look[] = [];
		const parts: Parts = {
			reads: () => world.host,
			writes: () => {
				throw new Error("read mode made the write side");
			},
		};

		const started = await Effect.runPromise(
			launch({prs: [url(1), url(2), url(3)], mode: "read", own: ["a"], reviewers: ["a"]}, parts, {
				found: (f) => found.push(f),
			}),
		);

		expect(started).toEqual({kind: "ran"});
		expect(found.map((f) => [f.name, f.wouldSend?.type ?? null])).toEqual([
			[null, "ship_enqueue"],
			[null, "ship_rerun_checks"],
			["ask:owner:approval", null],
		]);
		expect(world.writes).toEqual([]);
	});

	it("a pull request url that is not one answers bad_shape, and nothing is read", async () => {
		const world = fake(WORLDS);
		const started = await Effect.runPromise(
			start(shipProgram, {
				prs: [url(1), "https://github.com/example/repo/issues/9"],
				mode: "write",
			}).pipe(Effect.provide(Layer.mergeAll(world.host, world.hostWrites))),
		);

		expect(started).toMatchObject({kind: "bad_shape", input: "prs"});
		expect(world.reads).toEqual([]);
		expect(world.writes).toEqual([]);
	});

	it("from a host's JSON: an empty list, or a mode it does not have, is bad_shape too", () => {
		expect(readInputs(shipProgram, {prs: [], mode: "read"})).toMatchObject({
			kind: "bad_shape",
			input: "prs",
		});
		expect(readInputs(shipProgram, {prs: [url(1)], mode: "merge"})).toMatchObject({
			kind: "bad_shape",
			input: "mode",
		});
		expect(readInputs(shipProgram, {prs: [url(1)], mode: "read"})).toMatchObject({
			kind: "given",
		});
	});
});

describe("the ship program's listing", () => {
	it("names the program and each input and output, with a description and a JSON Schema", () => {
		const shown = listing(shipProgram);

		expect(shown.name).toBe("ship");
		expect(shown.description).toMatch(/merge queue/);
		expect(shown.inputs.map((i) => i.name)).toEqual(["prs", "mode"]);
		expect(shown.outputs.map((o) => o.name)).toEqual(["found", "outcome"]);
		// The url's pattern is not in it: Effect 4.0.0 leaves patterns out of JSON Schema. Its description says the form.
		const pr = {type: "string", description: "https://github.com/<owner>/<repo>/pull/<number>"};
		expect(shown.inputs[0]?.schema).toEqual({
			type: "array",
			prefixItems: [pr],
			items: pr,
			minItems: 1,
		});
		expect(shown.inputs[1]?.schema).toEqual({type: "string", enum: ["read", "write"]});
		expect(shown.outputs[1]?.schema).toMatchObject({
			type: "object",
			required: ["pr", "outcome", "name"],
			additionalProperties: false,
		});
		for (const one of [...shown.inputs, ...shown.outputs]) {
			expect(one.description.length).toBeGreaterThan(10);
			expect(one.schema).toBeDefined();
		}
	});
});
