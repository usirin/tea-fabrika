// Experiment 139's TLC side: runs written as TLA+ values, TLC started on a copy of the specs in a
// temp folder, and what it dumps read back. Effect's FileSystem and Path, and the pipeline's
// `runChild` for java; the caller provides Node's services at its edge.

import {runChild} from "@kampus/pipeline/child";
import {SpecState, type Step} from "@kampus/pipeline/hosted/lane-trace";
import {Effect, FileSystem, Path, Schema} from "effect";

export const SPECS = import.meta.dirname;
const HERE = SPECS.slice(0, SPECS.lastIndexOf("/"));
/** 116's spec, as it was written: TraceV1 checks the runs against it. */
const V1 = `${HERE}/116-established-checkers/HostedLane.tla`;

/** A JS value as a TLA+ one: strings, whole numbers, booleans, arrays and records. */
export const tla = (v: unknown): string => {
	if (typeof v === "string") return JSON.stringify(v);
	if (typeof v === "number" && Number.isInteger(v)) return String(v);
	if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
	if (Array.isArray(v)) return `<<${v.map(tla).join(", ")}>>`;
	if (typeof v === "object" && v !== null)
		return `[${Object.entries(v)
			.map(([k, x]) => `${k} |-> ${tla(x)}`)
			.join(", ")}]`;
	throw new Error(`no TLA+ form for ${String(v)}`);
};

/** The two trace specs: 139's v2, and 116's spec as written (rows have no kind there). */
export type Against = "v2" | "v1";

const forSpec = (against: Against, s: SpecState) =>
	against === "v2" ? s : {...s, row: s.row.map((r) => r !== "none")};

const dataModule = (name: string, against: Against, runs: readonly (readonly Step[])[]) =>
	[
		`---- MODULE ${name} ----`,
		"Runs == <<",
		runs
			.map(
				(run) =>
					`  <<${run.map((e) => tla({act: e.act, k: e.k, to: forSpec(against, e.to)})).join(",\n    ")}>>`,
			)
			.join(",\n"),
		">>",
		"====",
		"",
	].join("\n");

/** How TLC ended and what it printed, with the wall time. */
export interface Ran {
	readonly code: number;
	readonly out: string;
	readonly ms: number;
}

const java = (jar: string, dir: string, args: readonly string[]) =>
	Effect.gen(function* () {
		const t0 = performance.now();
		const r = yield* runChild(
			"java",
			[
				"-XX:+UseParallelGC",
				"-cp",
				jar,
				"tlc2.TLC",
				"-workers",
				"1",
				"-metadir",
				`${dir}/meta`,
				...args,
			],
			{cwd: dir, env: {PATH: process.env.PATH ?? ""}},
		);
		return {code: r.code, out: r.out + r.err, ms: Math.round(performance.now() - t0)} satisfies Ran;
	});

/** A temp folder holding every spec and config of 139, and 116's spec. */
const workDir = Effect.gen(function* () {
	const fs = yield* FileSystem.FileSystem;
	const path = yield* Path.Path;
	const dir = yield* fs.makeTempDirectoryScoped({prefix: "tlc-139-"});
	for (const f of yield* fs.readDirectory(SPECS))
		if (f.endsWith(".tla") || f.endsWith(".cfg"))
			yield* fs.copyFile(path.join(SPECS, f), path.join(dir, f));
	yield* fs.copyFile(V1, path.join(dir, "HostedLane.tla"));
	return dir;
});

/** One run's verdict: accepted, or the first event TLC could not match (`at`, 0 first; `rest`). */
export interface Verdict {
	readonly accepted: boolean;
	/** The first event no behaviour of the spec matched; its length: the end, not at rest. */
	readonly at: number;
}

/**
 * What TLC printed for each run: how many of its events a behaviour took, and whether it came to
 * rest. (TLC's `-dump` of states leaves the last state out, so the spec prints instead.)
 */
const reached = (out: string, runs: number) => {
	const took = Array.from({length: runs}, () => 0);
	const rest = Array.from({length: runs}, () => false);
	for (const m of out.matchAll(/<<"took", (\d+), (\d+)>>/g)) {
		const i = Number(m[1]) - 1;
		took[i] = Math.max(took[i] ?? 0, Number(m[2]));
	}
	for (const m of out.matchAll(/<<"rest", (\d+)>>/g)) rest[Number(m[1]) - 1] = true;
	return {took, rest};
};

/** Which trace spec, for how many children, with which wait. */
export interface TraceSpec {
	readonly against: Against;
	readonly n: number;
	readonly fixed: boolean;
}

/**
 * Check runs against a trace spec in one TLC run. A run is accepted when its behaviour reached
 * one step past its last event: at rest. Each run's steps must be read for the spec's `n`.
 */
export const checkTraces = (jar: string, spec: TraceSpec, runs: readonly (readonly Step[])[]) =>
	Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;
		const dir = yield* workDir;
		const data = spec.against === "v2" ? "TraceData" : "TraceDataV1";
		yield* fs.writeFileString(`${dir}/${data}.tla`, dataModule(data, spec.against, runs));
		const cfg = `INIT TraceInit\nNEXT TraceNext\nCONSTANTS N = ${spec.n}\n          Fixed = ${tla(spec.fixed)}\n`;
		yield* fs.writeFileString(`${dir}/trace.cfg`, cfg);
		const module = spec.against === "v2" ? "TraceV2" : "TraceV1";
		const ran = yield* java(jar, dir, ["-deadlock", "-config", "trace.cfg", module]);
		const {took, rest} = reached(ran.out, runs.length);
		const verdicts = runs.map((_, i): Verdict => ({accepted: rest[i] === true, at: took[i] ?? 0}));
		const ok = ran.code === 0 && /No error has been found/.test(ran.out);
		return {ok, ms: ran.ms, verdicts, out: ok ? "" : ran.out.slice(-2000)};
	}).pipe(Effect.scoped);

// ---------------------------------------------------------------- the state graph

/** One state of the graph, as TLC printed it. */
export type Graph = {
	readonly init: string;
	readonly states: ReadonlyMap<string, SpecState>;
	readonly edges: ReadonlyMap<string, readonly {readonly to: string; readonly act: string}[]>;
};

/** A TLC value of the kinds this spec has, read through JSON. */
const value = (text: string): unknown =>
	JSON.parse(
		text
			.replaceAll("<<", "[")
			.replaceAll(">>", "]")
			.replace(/\bTRUE\b/g, "true")
			.replace(/\bFALSE\b/g, "false"),
	);

const readDot = (dot: string): Graph => {
	const states = new Map<string, SpecState>();
	const edges = new Map<string, {to: string; act: string}[]>();
	let init = "";
	for (const line of dot.split("\n")) {
		const node = /^(-?\d+) \[label="(.*)"(,style = filled)?\];?$/.exec(line);
		if (node !== null) {
			const vars: Record<string, unknown> = {};
			for (const part of (node[2] ?? "").replaceAll('\\"', '"').split("\\n")) {
				const m = /^\/\\\\ (\w+) = (.*)$/.exec(part);
				if (m !== null) vars[m[1] ?? ""] = value(m[2] ?? "");
			}
			states.set(node[1] ?? "", Schema.decodeUnknownSync(SpecState)(vars));
			if (node[3] !== undefined) init = node[1] ?? "";
			continue;
		}
		const edge = /^(-?\d+) -> (-?\d+) \[label="(\w+)"/.exec(line);
		if (edge !== null) {
			const from = edge[1] ?? "";
			edges.set(from, [...(edges.get(from) ?? []), {to: edge[2] ?? "", act: edge[3] ?? ""}]);
		}
	}
	return {init, states, edges};
};

/** Model-check HostedLaneV2 on one config: did its laws hold, or which broke first. */
export const modelCheck = (jar: string, cfg: string) =>
	Effect.gen(function* () {
		const dir = yield* workDir;
		const ran = yield* java(jar, dir, ["-deadlock", "-config", `${cfg}.cfg`, "HostedLaneV2"]);
		const distinct = /(\d+) distinct states found/.exec(ran.out);
		return {
			cfg,
			passed: /No error has been found/.test(ran.out),
			broke: /^Error: (.*)$/m.exec(ran.out)?.[1] ?? null,
			distinct: distinct === null ? null : Number(distinct[1]),
			ms: ran.ms,
		};
	}).pipe(Effect.scoped);

/** Model-check HostedLaneV2 on one config and dump its state graph, with action names. */
export const stateGraph = (jar: string, cfg: string) =>
	Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;
		const dir = yield* workDir;
		// A state with no way on is the end of a path here, not an error: -deadlock.
		const ran = yield* java(jar, dir, [
			"-deadlock",
			"-dump",
			"dot,actionlabels",
			`${dir}/graph`,
			"-config",
			`${cfg}.cfg`,
			"HostedLaneV2",
		]);
		const file = (yield* fs.exists(`${dir}/graph.dot`)) ? `${dir}/graph.dot` : `${dir}/graph`;
		const graph = readDot(yield* fs.readFileString(file));
		const distinct = /(\d+) distinct states found/.exec(ran.out);
		return {
			graph,
			ms: ran.ms,
			distinct: distinct === null ? null : Number(distinct[1]),
			passed: /No error has been found/.test(ran.out),
		};
	}).pipe(Effect.scoped);
