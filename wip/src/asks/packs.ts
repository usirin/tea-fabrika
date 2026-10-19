import {createRequire} from "node:module";
import {pathToFileURL} from "node:url";
import {
	type AnyProgram,
	type AnyRun,
	type Listeners,
	type Running,
	start,
} from "@tea-fabrika/tea-program";
import {fit} from "@tea-fabrika/tea-program/shape";
import type {Storage} from "@tea-fabrika/tea-program/storage";
import {Effect, type FileSystem, type Layer, type Path, Queue, type Scope} from "effect";

// Add-on packs, wired to a core program by the host, from names in config
// (docs/direction/packs-are-programs.md). The core program never sees this:
// it sends on its outputs and is told on its inputs, as always.
//
//   packs = ["@acme/owner-desk", "@acme/ask-log"]    # tsh.toml: the one line
//
//   const packs = yield* loadPacks(config.packs, folder);
//   const wired = yield* startWithPacks({program: asksProgram, flags: {}}, packs, config.pack, storage);
//
// A pack says which of the core's outputs it hears (`listens`: core output to
// pack input) and which of its own outputs the core takes (`answers`: pack
// output to core input). Both are checked by shape before anything starts.
// Every pack listening on one output hears every value; any pack may answer.
//
// The wiring is a loop, core to pack and back, which `pipe` cannot make: a
// pipe starts its upstream, and here each side is the other's upstream. So
// the host starts the packs first, then the core with a listener per output
// that tells each pack, and a queue that carries each pack's answers into the
// core once it runs. Elm's ports are the same loop, wired by the runtime.
//
// Node edge: a pack is found from the config's folder with Node's module
// resolution (`createRequire`) and loaded with `import()`. Effect has no
// module loader; this file is the one place that uses it.

/** The platform services every pack may ask for: the host provides them. */
export type Platform = FileSystem.FileSystem | Path.Path;

/** What a pack package exports as its default. */
export interface Pack {
	readonly program: AnyProgram;
	/** For each output of the core this pack hears: the pack's input it is told on. */
	readonly listens: Readonly<Record<string, string>>;
	/** For each output of the pack the core takes: the core's input it is told on. */
	readonly answers: Readonly<Record<string, string>>;
	/**
	 * The services the pack's program needs, made from its own settings (the
	 * `[pack."<name>"]` table of the config, `{}` when there is none). It fails
	 * with why, in words, when the settings do not fit.
	 */
	readonly layer: (settings: unknown) => Effect.Effect<Layer.Layer<any, never, Platform>, string>;
}

/** A pack found by name. */
export interface Loaded {
	readonly name: string;
	readonly pack: Pack;
}

/** A pack that could not be found, loaded or wired, and why. Nothing was started. */
export interface PackRefused {
	readonly _tag: "pack_refused";
	readonly name: string;
	readonly why: string;
}
const refused = (name: string, why: string): PackRefused => ({_tag: "pack_refused", name, why});

const isRecordOfStrings = (value: unknown): value is Readonly<Record<string, string>> =>
	typeof value === "object" &&
	value !== null &&
	Object.values(value).every((v) => typeof v === "string");

/** Whether a module's default export looks like a pack. The program's own checks run at its start. */
function packOf(value: unknown): Pack | null {
	if (typeof value !== "object" || value === null) return null;
	const {program, listens, answers, layer} = value as Record<string, unknown>;
	if (typeof program !== "object" || program === null || !("main" in program)) return null;
	if (!isRecordOfStrings(listens) || !isRecordOfStrings(answers)) return null;
	if (typeof layer !== "function") return null;
	return value as Pack;
}

/** Find and load each pack by package name, from `folder` as Node would. */
export const loadPacks = (
	names: readonly string[],
	folder: string,
): Effect.Effect<readonly Loaded[], PackRefused> =>
	Effect.forEach(
		names,
		(name) =>
			Effect.gen(function* () {
				const file = yield* Effect.try({
					try: () => createRequire(`${folder}/`).resolve(name),
					catch: () => refused(name, `no package ${name} is installed where the config is`),
				});
				const module = yield* Effect.tryPromise({
					try: () => import(pathToFileURL(file).href) as Promise<{readonly default?: unknown}>,
					catch: (error) => refused(name, `it did not load: ${String(error)}`),
				});
				const pack = packOf(module.default);
				if (pack === null)
					return yield* Effect.fail(
						refused(name, "its default export is not a pack: program, listens, answers, layer"),
					);
				return {name, pack};
			}),
		// In the config's order: the first that fails is the one named.
		{concurrency: 1},
	);

/** Why a pack does not fit the core, or `null`: every wire it asks for fits by shape. */
export function misfit(core: AnyProgram, pack: Pack): string | null {
	for (const [from, to] of Object.entries(pack.listens)) {
		const out = core.outputs[from];
		const into = pack.program.inputs[to];
		if (out === undefined) return `the core has no output ${from}`;
		if (into === undefined) return `the pack has no input ${to}`;
		if (fit(out, into) === "does_not_fit") return `the core's ${from} does not fit its ${to}`;
	}
	for (const [from, to] of Object.entries(pack.answers)) {
		const out = pack.program.outputs[from];
		const into = core.inputs[to];
		if (out === undefined) return `the pack has no output ${from}`;
		if (into === undefined) return `the core has no input ${to}`;
		if (fit(out, into) === "does_not_fit") return `its ${from} does not fit the core's ${to}`;
	}
	return null;
}

/** A started core, and each started pack by name. */
export interface Wired {
	readonly core: Running<any, any, any, any, any>;
	readonly packs: readonly {
		readonly name: string;
		readonly running: Running<any, any, any, any, any>;
	}[];
}

/**
 * Start `core` with each pack wired to it. Each pack runs under the id
 * `pack:<name>` in `storage`, with the services its `layer` makes from
 * `settings[name]`. With no packs, the core starts alone: its outputs are
 * heard by nobody, as with any program.
 */
export const startWithPacks = <R>(
	core: {readonly program: AnyProgram; readonly flags: Readonly<Record<string, unknown>>},
	packs: readonly Loaded[],
	settings: Readonly<Record<string, unknown>>,
	storage: Storage,
	keeping: {readonly id: string},
): Effect.Effect<Wired, PackRefused, R | Platform | Scope.Scope> =>
	Effect.gen(function* () {
		for (const {name, pack} of packs) {
			const why = misfit(core.program, pack);
			if (why !== null) return yield* Effect.fail(refused(name, why));
		}
		const toCore = yield* Queue.unbounded<{readonly input: string; readonly value: unknown}>();
		const started: {
			readonly name: string;
			readonly pack: Pack;
			readonly running: Running<any, any, any, any, any>;
		}[] = [];
		for (const {name, pack} of packs) {
			const layer = yield* pack
				.layer(settings[name] ?? {})
				.pipe(Effect.mapError((why) => refused(name, `its settings: ${why}`)));
			const listeners = Object.fromEntries(
				Object.entries(pack.answers).map(([from, to]) => [
					from,
					(value: unknown) => Queue.offerUnsafe(toCore, {input: to, value}),
				]),
			) as Listeners<any>;
			const begun = yield* (
				start(pack.program, {}, listeners, {id: `pack:${name}`, storage}) as Effect.Effect<
					Running<any, any, any, any, any> | {readonly kind: "bad_shape"; readonly why: string},
					never,
					Scope.Scope
				>
			).pipe(Effect.provide(layer));
			if (begun.kind !== "running") return yield* Effect.fail(refused(name, begun.why));
			started.push({name, pack, running: begun});
		}
		const tellPacks = (output: string) => (value: unknown) => {
			for (const {pack, running} of started) {
				const input = pack.listens[output];
				if (input !== undefined) (running.run as AnyRun).tell(input, value);
			}
		};
		const listeners = Object.fromEntries(
			Object.keys(core.program.outputs).map((output) => [output, tellPacks(output)]),
		) as Listeners<any>;
		const begun = yield* start(core.program, core.flags, listeners, {
			...keeping,
			storage,
		}) as Effect.Effect<
			Running<any, any, any, any, any> | {readonly kind: "bad_shape"; readonly why: string},
			never,
			R | Scope.Scope
		>;
		if (begun.kind !== "running") return yield* Effect.fail(refused("core", begun.why));
		const run = begun.run as AnyRun;
		yield* Effect.forkScoped(
			Effect.forever(
				Queue.take(toCore).pipe(Effect.flatMap(({input, value}) => run.offer(input, value))),
			),
		);
		return {core: begun, packs: started.map(({name, running}) => ({name, running}))};
	});
