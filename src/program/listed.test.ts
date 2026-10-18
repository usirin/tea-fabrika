import {Context, Effect, Layer, Schema, Stream} from "effect";
import {describe, expect, it} from "vitest";
import {type Entry, listed} from "./listed.ts";
import {defineProgram} from "./program.ts";
import {flag, input, output} from "./shape.ts";
import {memoryStorage} from "./storage.ts";

// A host that is not tsh: no line, no grammar, no job table. It keeps packed
// programs by name, the way a desktop keeps its program rows, and starts,
// pipes and calls them through their entries alone. Nothing here comes from
// src/tsh/. If this host works, packing a program is a program concern.

/** Where `count` starts counting: a service the host never sees. */
class Base extends Context.Service<Base, {readonly from: number}>()("test/Base") {}
/** What `label` puts before each number: a second service, another program's. */
class Prefix extends Context.Service<Prefix, {readonly text: string}>()("test/Prefix") {}

const count = defineProgram({
	name: "count",
	description: "Sends `n` numbers, from where its Base says, one at a time, and ends.",
	flags: {n: flag(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)), "How many numbers.")},
	inputs: {},
	outputs: {n: output(Schema.Int, "Each number, in order.")},
	main: ({flags, send}) =>
		Effect.gen(function* () {
			const {from} = yield* Base;
			for (let i = 0; i < flags.n; i++) yield* send("n", from + i);
		}),
});

const label = defineProgram({
	name: "label",
	description:
		"Says each number it is told with its Prefix before it, and ends when its input closes.",
	inputs: {n: input(Schema.Int, "A number.")},
	outputs: {text: output(Schema.String, "The number, labelled.")},
	main: ({inputs, send}) =>
		Effect.gen(function* () {
			const {text} = yield* Prefix;
			yield* inputs.n.pipe(Stream.runForEach((n) => send("text", `${text}${n}`)));
		}),
});

/** A packed program whose services count how often they were built. */
const packed = () => {
	const builds = {base: 0, prefix: 0};
	const entries: ReadonlyMap<string, Entry> = new Map([
		[
			"count",
			listed(
				count,
				Layer.effect(
					Base,
					Effect.sync(() => {
						builds.base += 1;
						return {from: 10};
					}),
				),
			),
		],
		[
			"label",
			listed(
				label,
				Layer.effect(
					Prefix,
					Effect.sync(() => {
						builds.prefix += 1;
						return {text: "#"};
					}),
				),
			),
		],
	]);
	return {builds, entries};
};

/** The second host: by name, flags as raw values (a JSON file, a config, a click). */
const host = (entries: ReadonlyMap<string, Entry>) => {
	const of = (name: string) => {
		const entry = entries.get(name);
		if (entry === undefined) throw new Error(`no program ${name}`);
		return entry;
	};
	const keeping = (id: string) => ({id, storage: memoryStorage()});
	/** `from --flags | to`, and every value `to` says. */
	const piped = (from: string, fromFlags: Record<string, unknown>, to: string, id: string) =>
		Effect.gen(function* () {
			const heard: unknown[] = [];
			const sink = yield* of(to).start(
				{},
				{text: (value: unknown) => heard.push(value)},
				keeping(`${id}:to`),
			);
			if (sink.kind !== "running") return {kind: "refused" as const, why: sink.why};
			const source = yield* of(from).pipe(fromFlags, {}, keeping(`${id}:from`), "n", sink, "n");
			if (source.kind !== "running") return {kind: "refused" as const, why: source.kind};
			const ended = yield* sink.run.ended;
			return {kind: ended.kind, heard};
		}).pipe(Effect.scoped);
	const called = (name: string, told: Record<string, readonly unknown[]>, id: string) =>
		Effect.scoped(
			of(name).call({}, {told, listeners: {}, keeping: keeping(id), stopOn: Effect.never}),
		);
	return {of, piped, called, keeping};
};

describe("listed: a host that is not tsh", () => {
	it("starts, pipes and calls packed programs by name, three runs in a row, each with its own services", async () => {
		const {builds, entries} = packed();
		const {piped, called} = host(entries);
		const runs = await Effect.runPromise(
			Effect.forEach([1, 2, 3], (i) => piped("count", {n: 5}, "label", `pipe-${i}`), {
				concurrency: 1,
			}),
		);
		for (const run of runs)
			expect(run).toEqual({kind: "ended", heard: ["#10", "#11", "#12", "#13", "#14"]});
		// Made fresh for each run, inside the run's scope: three pipes, three of each.
		expect(builds).toEqual({base: 3, prefix: 3});

		const answer = await Effect.runPromise(called("label", {n: [1, 2, 3, 4]}, "call-1"));
		expect(answer.kind === "called" && answer.heard).toEqual([
			{name: "text", value: "#1"},
			{name: "text", value: "#2"},
			{name: "text", value: "#3"},
			{name: "text", value: "#4"},
		]);
		expect(builds.prefix).toBe(4);
	});

	it("refuses raw flags that do not fit before main runs: start checks them again, whatever the host says", async () => {
		const {builds, entries} = packed();
		const {of, keeping} = host(entries);
		const started = await Effect.runPromise(
			Effect.scoped(of("count").start({n: "five"}, {}, keeping("bad"))),
		);
		expect(started.kind).toBe("bad_shape");
		// A cost, not a leak: the services are built before start checks, and let go with the scope.
		expect(builds.base).toBe(1);
	});

	it("refuses a pipe whose sides do not fit, before the source starts", async () => {
		const {entries} = packed();
		const {of, keeping} = host(entries);
		const answer = await Effect.runPromise(
			Effect.gen(function* () {
				const sink = yield* of("label").start({}, {}, keeping("sink"));
				if (sink.kind !== "running") return sink.kind;
				return (yield* of("count").pipe({n: 1}, {}, keeping("src"), "missing", sink, "n")).kind;
			}).pipe(Effect.scoped),
		);
		expect(answer).toBe("does_not_fit");
	});

	it("builds a run's services fresh even when the host starts it inside a build that already made them", async () => {
		// The host's own boot is a Layer, and a run starts while it is built: the fiber carries
		// the boot's memo map. Effect's Layer.build forks the memo map it finds, so a layer the
		// boot already built would be handed to the run instead of a new one.
		let built = 0;
		const base = Layer.effect(
			Base,
			Effect.sync(() => {
				built += 1;
				return {from: 100};
			}),
		);
		const {entries} = packed();
		const {piped} = host(new Map([...entries, ["count", listed(count, base)]]));
		const boot = Layer.effectDiscard(
			Effect.gen(function* () {
				yield* Base;
				const run = yield* piped("count", {n: 2}, "label", "in-boot");
				expect(run).toEqual({kind: "ended", heard: ["#100", "#101"]});
			}),
		).pipe(Layer.provideMerge(base));
		await Effect.runPromise(Effect.scoped(Layer.build(boot)));
		// One for the boot, one for the run started inside it.
		expect(built).toBe(2);
	});
});
