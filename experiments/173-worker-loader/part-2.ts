// Experiment 173, part 2: can the brain hold one Effect instead of one per loaded program?
// Run it directly: node experiments/173-worker-loader/part-2.ts. About two minutes.
//
//   A  split modules: Effect, tea and fabrika as modules of their own, named by content; a new
//      program version sends only its own small module
//   B  pure step: the isolate runs only the update, with no Effect in it; the core decodes
//      with the program's schemas, rebuilt from data, and would run the Cmds
//
// Each variant gets a fresh Miniflare for its memory and cold-load numbers. COLD (default 20)
// versions per variant, STEPS (default 1000) steps per bench run. No key, no model, no network
// beyond Miniflare on this machine. Results: ../results/173-worker-loader-part-2.json.
import {mkdtempSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {counter, Press, Shown} from "@tea-fabrika/counter";
import {Comment, File, OneTicket, statusOf, Tracker, tickets, Write} from "@tea-fabrika/tracker";
import {Schema, SchemaRepresentation} from "effect";
import {Miniflare} from "miniflare";
import {
	type Built,
	bundle,
	here,
	programName,
	pureProgram,
	type Split,
	sha256,
	splitLibs,
	splitProgram,
} from "./build.ts";
import {round, summary, workerdRssKb} from "./main.ts";
import {sandboxOf} from "./sandbox.ts";

const RESULTS = here("../results/173-worker-loader-part-2.json");
const STEPS = Number(process.env.STEPS ?? "1000");
const COLD = Number(process.env.COLD ?? "20");

/** One program version as the core keeps it: its main module, and every module it loads. */
interface Version {
	readonly main: string;
	readonly modules: Record<string, string>;
}

const start = (core: string, persist: string) =>
	new Miniflare({
		modules: [{type: "ESModule", path: "core.js", contents: core}],
		compatibilityDate: "2026-07-01",
		durableObjects: {PROCESS: {className: "Process", useSQLite: true}},
		durableObjectsPersist: persist,
		workerLoaders: {LOADER: {}},
	});
type Mf = ReturnType<typeof start>;

const call = async (mf: Mf, pid: string, part: string, body: unknown): Promise<any> => {
	const r = await mf.dispatchFetch(`http://core/p/${pid}/${part}`, {
		method: "POST",
		body: JSON.stringify(body),
	});
	const out: any = await r.json();
	if (out?.error) throw new Error(`${part}: ${out.error}`);
	return out;
};

/** The hands' side of an install: ask what is missing, send only that. Bytes sent, back. */
const install = async (mf: Mf, pid: string, v: Version) => {
	const names = Object.keys(v.modules);
	const {missing} = (await call(mf, pid, "have", {names})) as {missing: string[]};
	const modules = Object.fromEntries(missing.map((n) => [n, v.modules[n] ?? ""]));
	const out = await call(mf, pid, "install", {main: v.main, names, modules});
	if (!out.kept) throw new Error(`install: ${JSON.stringify(out)}`);
	return {
		sent: missing.length,
		bytes: Object.values(modules).reduce((a, c) => a + Buffer.byteLength(c), 0),
	};
};

/** A program alone in one module, as part 1 and design B send it. */
const single = (b: Built, tag = ""): Version => {
	const code = `${b.code}${tag}`;
	const main = programName(code);
	return {main, modules: {[main]: code}};
};

/** The names a module imports: `from"./effect@4.0.6-1a12e33e16e3.js"`. */
const importsOf = (code: string) =>
	[...code.matchAll(/from\s*"\.\/([^"]+\.js)"/g)].map((m) => m[1] ?? "");

/**
 * A program on the shared modules, as design A sends it: its own module and the shared ones it
 * reaches through its imports, no others (the counter needs fabrika; the tally does not).
 */
const onLibs = (libs: Record<string, string>, b: Built, tag = ""): Version => {
	const code = `${b.code}${tag}`;
	const main = programName(code);
	const modules: Record<string, string> = {[main]: code};
	const todo = importsOf(code);
	for (let name = todo.pop(); name !== undefined; name = todo.pop()) {
		const lib = libs[name];
		if (lib === undefined) throw new Error(`no shared module ${name}`);
		if (modules[name] !== undefined) continue;
		modules[name] = lib;
		todo.push(...importsOf(lib));
	}
	return {main, modules};
};

const libCode = (split: Split) =>
	Object.fromEntries(Object.entries(split.libs).map(([n, b]) => [n, b.code]));

/**
 * The control for design A: the same shared modules, but each with new bytes (a comment at the
 * end) and so a new name, the names inside the others moved to match. If workerd reused compiled
 * code across isolates that load the same bytes, the same-bytes runs would load faster or take
 * less memory than these.
 */
const freshLibs = (split: Split, tag: string): Record<string, string> => {
	const renamed: Record<string, string> = {};
	const out: Record<string, string> = {};
	for (const [name, b] of Object.entries(split.libs)) {
		let code = b.code;
		for (const [from, to] of Object.entries(renamed)) code = code.replaceAll(from, to);
		code = `${code}\n// ${tag}\n`;
		const next = name.replace(/[0-9a-f]{12}\.js$/, `${sha256(code).slice(0, 12)}.js`);
		renamed[name] = next;
		out[next] = code;
	}
	return out;
};

/** A variant: COLD versions of one program, loaded cold in a workerd of its own. */
interface Variant {
	readonly name: string;
	readonly versions: (i: number) => Version;
	/** The call that loads an isolate. */
	readonly call: string;
}

const measure = async (core: string, v: Variant) => {
	const persist = mkdtempSync(join(tmpdir(), "exp173b-"));
	const mf = start(core, persist);
	try {
		const vs = Array.from({length: COLD}, (_, i) => v.versions(i));
		const sent: number[] = [];
		for (const ver of vs) sent.push((await install(mf, "cold", ver)).bytes);
		// One process woken, no program isolate yet.
		await call(mf, "cold", "have", {names: []});
		const before = workerdRssKb();
		const total = (ver: Version) =>
			Object.values(ver.modules).reduce((a, c) => a + Buffer.byteLength(c), 0);
		const sizes = {
			name: v.name,
			loadedBytesPerVersion: total(vs[0] as Version),
			sentFirstBytes: sent[0],
			sentNextBytes: summary(sent.slice(1)).p50,
		};
		try {
			const {ms} = await call(mf, "cold", "cold", {ids: vs.map((x) => x.main), call: v.call});
			const after = workerdRssKb();
			return {
				...sizes,
				coldMs: summary(ms),
				rssKb: {before, after, perVersionKb: Math.round((after - before) / COLD)},
			};
		} catch (e) {
			// A version that does not even load is a finding, not a crash.
			return {...sizes, failed: String(e).split("\n").slice(0, 3).join(" ").slice(0, 240)};
		}
	} finally {
		await mf.dispose();
		rmSync(persist, {recursive: true, force: true});
	}
};

// ---------------------------------------------------------------- the tracker's trace

const owner = {kind: "user", id: "owner"} as const;
const TITLES = [
	"Login fails on main",
	"Docs typo in the guide",
	"Search is slow",
	"Login page shows a blank screen",
	"Export to CSV drops the last row",
];
const entries = Array.from({length: 20}, (_, i) => ({
	pos: i + 1,
	ticket: i + 1,
	by: owner,
	at: i + 1,
	fact: {type: "filed", title: `${TITLES[i % TITLES.length]} (${i + 1})`, body: "Seen today."},
}));

const typeOf = (c: unknown) =>
	typeof c === "object" && c !== null && "type" in c ? c.type : undefined;

type DuplicatesAsk = {
	readonly type: "duplicates";
	readonly candidates: readonly {number: number}[];
};
const isDuplicates = (c: unknown): c is DuplicatesAsk =>
	typeOf(c) === "duplicates" && typeof c === "object" && c !== null && "candidates" in c;

/** The tracker from a full read of 20 tickets, through a filing and its duplicate hint, to quit. */
const trackerMsgs = () => {
	const sb = sandboxOf(tickets);
	const msgs: {type: string; [k: string]: unknown}[] = [
		{type: "load_ok", cmd: {type: "load", after: 0}, value: {entries, broken: [], last: 20}},
		{type: "pull_requests_ok", cmd: {type: "pull_requests"}, value: {pullRequests: []}},
		{type: "tick", now: 60_000},
		{type: "show", show: "all"},
		{type: "find", text: "login"},
		{type: "open", ticket: 4},
		{type: "list"},
	];
	const filed = {kind: "file", title: "Login fails again", body: "Seen today."};
	msgs.push({type: "write", id: "w1", write: filed});
	// The save comes back; what the machine asks next decides the next Msgs.
	let state = sb.init().state;
	for (const m of msgs) state = sb.step(state, m).state;
	const saved = {
		type: "save_ok",
		cmd: {type: "save", id: "w1", write: filed, next: 21},
		value: {ticket: 21},
	};
	const afterSave = sb.step(state, saved);
	msgs.push(saved);
	const asked = afterSave.cmds.find(isDuplicates);
	const first = asked?.candidates[0];
	if (asked && first) {
		const scored = {kind: "scored", scores: [{of: first.number, yes: 0.9}]};
		const dup = {type: "duplicates_ok", cmd: asked, value: scored};
		const afterDup = sb.step(afterSave.state, dup);
		msgs.push(dup);
		const hints = afterDup.cmds.find((c) => typeOf(c) === "save_hints");
		if (hints) msgs.push({type: "save_hints_ok", cmd: hints, value: {}});
	}
	msgs.push({type: "quit"});
	return {msgs, duplicatesAsked: asked !== undefined};
};

/** The same Msgs straight in Node, with the real Effect: what the sandbox must match. */
const direct = (
	machine: Parameters<typeof sandboxOf>[0],
	msgs: {type: string}[],
	status: (s: never) => string,
) => {
	const sb = sandboxOf(machine);
	const first = sb.init();
	const steps: unknown[] = [first];
	let state = first.state;
	for (const m of msgs) {
		const out = sb.step(state, m);
		steps.push({...out, status: status(out.state as never)});
		state = out.state;
	}
	return steps;
};

/** Compare as JSON, which is what crosses the isolate line. */
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

// ---------------------------------------------------------------- schemas as data

const docOf = (s: Schema.Top) => SchemaRepresentation.toJson(Schema.toRepresentation(s));

const accepts = (s: Schema.Top, v: unknown) => {
	try {
		Schema.decodeUnknownSync(s as never)(v);
		return true;
	} catch {
		return false;
	}
};

export const main = async () => {
	const results: Record<string, unknown> = {
		when: new Date().toISOString().slice(0, 10),
		versions: {node: process.version},
	};

	// 1. The builds.
	const split = await splitLibs();
	const builds = {
		singleTally: await bundle({path: "program.ts"}),
		singleCounter: await bundle({path: "counter-entry.ts"}),
		splitTally: await splitProgram("program.ts", split),
		splitCounter: await splitProgram("counter-entry.ts", split),
		splitProbe: await splitProgram("probe-entry.ts", split),
		pureCounterRealEffect: await bundle({path: "pure-counter.ts"}),
		pureTrackerRealEffect: await bundle({path: "pure-tracker.ts"}),
		pureCounter: await pureProgram("pure-counter.ts"),
		pureTracker: await pureProgram("pure-tracker.ts"),
		pureCounterNoFabrika: await pureProgram("pure-counter.ts", ["@kampus/fabrika-old"]),
		pureCounterMachine: await pureProgram("pure-counter-machine.ts"),
		pureCounterMachineRealEffect: await bundle({path: "pure-counter-machine.ts"}),
		pureTrackerNoFabrika: await pureProgram("pure-tracker.ts", ["@kampus/fabrika-old"]),
	};
	const core = await bundle({path: "core-2.ts"});
	const show = (b: Built) => ({bytes: b.bytes, gzip: b.gzip, buildMs: b.ms, parts: b.parts});
	results.builds = {
		sharedModules: Object.fromEntries(Object.entries(split.libs).map(([n, b]) => [n, show(b)])),
		...Object.fromEntries(Object.entries(builds).map(([k, b]) => [k, show(b)])),
		core: {bytes: core.bytes},
	};
	console.log("builds", JSON.stringify(results.builds, null, 1));

	const libs = libCode(split);
	const tag = (s: string, i: number) => `\n// ${s} ${i}\n`;

	// 2. Memory and cold loads, each variant in a workerd of its own.
	const empty = await bundle({path: "probe-entry.ts"});
	const variants: Variant[] = [
		{
			name: "an empty program (the floor)",
			call: "isolate",
			versions: (i) => single(empty, tag("e", i)),
		},
		{
			name: "single tally (part 1)",
			call: "isolate",
			versions: (i) => single(builds.singleTally, tag("st", i)),
		},
		{
			name: "split tally, shared modules the same bytes",
			call: "isolate",
			versions: (i) => onLibs(libs, builds.splitTally, tag("sp", i)),
		},
		{
			name: "split tally, shared modules new bytes each version (control)",
			call: "isolate",
			versions: (i) => {
				const fresh = freshLibs(split, `fresh ${i}`);
				let code = builds.splitTally.code;
				const order = Object.keys(split.libs);
				const now = Object.keys(fresh);
				order.forEach((from, k) => {
					code = code.replaceAll(from, now[k] ?? from);
				});
				return onLibs(fresh, {...builds.splitTally, code}, tag("fr", i));
			},
		},
		{
			name: "single counter (part 1)",
			call: "describe",
			versions: (i) => single(builds.singleCounter, tag("sc", i)),
		},
		{
			name: "split counter",
			call: "describe",
			versions: (i) => onLibs(libs, builds.splitCounter, tag("spc", i)),
		},
		{
			name: "pure counter, real Effect",
			call: "isolate",
			versions: (i) => single(builds.pureCounterRealEffect, tag("pcr", i)),
		},
		{
			name: "pure counter, no Effect",
			call: "isolate",
			versions: (i) => single(builds.pureCounter, tag("pc", i)),
		},
		{
			name: "pure counter, its machine module alone",
			call: "isolate",
			versions: (i) => single(builds.pureCounterMachine, tag("pcm", i)),
		},
		{
			name: "pure tracker, real Effect",
			call: "isolate",
			versions: (i) => single(builds.pureTrackerRealEffect, tag("ptr", i)),
		},
		{
			name: "pure tracker, no Effect",
			call: "isolate",
			versions: (i) => single(builds.pureTracker, tag("pt", i)),
		},
		{
			name: "pure tracker, no Effect, no fabrika",
			call: "isolate",
			versions: (i) => single(builds.pureTrackerNoFabrika, tag("ptf", i)),
		},
	];
	const loads = [];
	for (const v of variants) {
		const m = await measure(core.code, v);
		console.log("load", JSON.stringify(m));
		loads.push(m);
	}
	results.loads = loads;

	// 3. Everything else in one workerd.
	const persist = mkdtempSync(join(tmpdir(), "exp173b-"));
	const mf = start(core.code, persist);
	try {
		// 3a. What the hands send: a first version, a second, then another program on the same libs.
		const v1 = onLibs(libs, builds.splitTally, tag("one", 1));
		const v2 = onLibs(libs, builds.splitTally, tag("two", 2));
		const c1 = onLibs(libs, builds.splitCounter);
		results.sent = {
			firstVersion: await install(mf, "a", v1),
			nextVersion: await install(mf, "a", v2),
			otherProgramSameLibs: await install(mf, "a", c1),
			otherProcessSameVersion: await install(mf, "b", v2),
		};
		console.log("sent", JSON.stringify(results.sent));

		// 3b. Parity: the sandbox, Effect stubbed out, against the real Effect in Node.
		const counterMsgs = Array.from({length: 5}, () => ({type: "plus"}));
		const {msgs: trackerTrace, duplicatesAsked} = trackerMsgs();
		const pure = {
			counter: single(builds.pureCounter),
			tracker: single(builds.pureTracker),
			counterNoFabrika: single(builds.pureCounterNoFabrika),
			counterMachine: single(builds.pureCounterMachine),
			trackerNoFabrika: single(builds.pureTrackerNoFabrika),
		};
		for (const v of Object.values(pure)) await install(mf, "a", v);
		const want = {
			counter: direct(
				counter.machines.count.machine,
				counterMsgs,
				counter.machines.count.status as never,
			),
			tracker: direct(tickets, trackerTrace, statusOf as never),
		};
		const parity: Record<string, unknown> = {};
		for (const [k, v] of Object.entries(pure)) {
			const isCounter = k.startsWith("counter");
			const got = await call(mf, "a", "trace", {
				id: v.main,
				msgs: isCounter ? counterMsgs : trackerTrace,
			});
			const expected = isCounter ? want.counter : want.tracker;
			parity[k] = got.threw
				? {threw: got.threw}
				: {
						steps: got.steps.length,
						sameAsNode: same(got.steps, expected),
						lastStatus: got.steps.at(-1)?.status,
						lastCmds: got.steps.at(-1)?.cmds,
					};
			parity[`${k} effect touched`] = await call(mf, "a", "effect", {id: v.main}).catch((e) =>
				String(e).slice(0, 200),
			);
		}
		parity.trackerTrace = {msgs: trackerTrace.map((m) => m.type), duplicatesAsked};
		results.parity = parity;
		console.log("parity", JSON.stringify(parity, null, 1));

		// 3c. The core rebuilds the program's schemas from data and decodes with them.
		const schemas: Record<string, Schema.Top> = {
			"counter Press": Press,
			"counter Shown": Shown,
			"tracker Tracker": Tracker,
			"tracker Write": Write,
			"tracker File": File,
			"tracker Comment": Comment,
			"tracker OneTicket": OneTicket,
		};
		const loaded = direct(tickets, trackerTrace.slice(0, 3), statusOf as never).at(-1) as {
			state: typeof Tracker.Type;
		};
		const samples: Record<string, unknown[]> = {
			"counter Press": ["plus", "done", "minus", 1, null],
			"counter Shown": [{n: 2}, {n: 1.5}, {n: "2"}, {}],
			"tracker Tracker": [
				loaded.state,
				{...loaded.state, seen: -0.5},
				{...loaded.state, find: "x".repeat(300)},
			],
			"tracker Write": [
				{kind: "file", title: "Login fails", body: ""},
				{kind: "file", title: " Login fails", body: ""},
				{kind: "file", title: "two\nlines", body: ""},
				{kind: "close", ticket: 3},
				{kind: "close", ticket: 0},
				{kind: "comment", ticket: 3, body: "   "},
				{kind: "comment", ticket: 3, body: "Skip part 2.", asks: "changes"},
			],
			"tracker File": [
				{title: "A", body: ""},
				{title: "", body: ""},
				{title: "A", body: "x".repeat(70_000)},
			],
			"tracker Comment": [
				{ticket: 1, body: "ok"},
				{ticket: 1, body: "ok", asks: "nope"},
			],
			"tracker OneTicket": [{ticket: 1}, {ticket: 1.5}, {ticket: "1"}],
		};
		const docs: Record<string, unknown> = {};
		const docBytes: Record<string, number> = {};
		const expected: Record<string, boolean[]> = {};
		const notData: Record<string, string> = {};
		for (const [name, s] of Object.entries(schemas)) {
			try {
				docs[name] = docOf(s);
				docBytes[name] = JSON.stringify(docs[name]).length;
				expected[name] = (samples[name] ?? []).map((v) => accepts(s, v));
			} catch (e) {
				notData[name] = String(e).slice(0, 200);
			}
		}
		const rebuilt = await call(mf, "a", "schemas", {docs, samples});
		results.schemasAsData = {
			docBytes,
			notData,
			expected,
			rebuilt,
			agree: Object.keys(docs).every((n) => same(expected[n], rebuilt[n])),
		};
		console.log("schemas", JSON.stringify(results.schemasAsData, null, 1));

		// 3d. Steps in a loop, three runs each.
		const st = single(builds.singleTally);
		const sc = single(builds.singleCounter);
		const pt = onLibs(libs, builds.splitTally);
		for (const v of [st, sc, pt]) await install(mf, "a", v);
		const trackerState = loaded.state;
		const benches: Record<string, Record<string, unknown>> = {
			"tally, single bundle (part 1)": {
				id: st.main,
				kind: "single",
				state: {n: 0, pad: ""},
				inputs: [{type: "plus"}],
			},
			"tally, split modules": {
				id: pt.main,
				kind: "single",
				state: {n: 0, pad: ""},
				inputs: [{type: "plus"}],
			},
			"counter, single bundle (part 1)": {
				id: sc.main,
				kind: "single",
				state: {n: 0},
				inputs: [{type: "plus"}],
				warm: "describe",
			},
			"counter, pure step, the core decodes the press": {
				id: pure.counterMachine.main,
				kind: "pure",
				state: {n: 0},
				inputs: ["plus"],
				decode: "counter Press",
				as: "type",
			},
			"counter, pure step, no decode": {
				id: pure.counterMachine.main,
				kind: "pure",
				state: {n: 0},
				inputs: [{type: "plus"}],
			},
			"tracker, pure step, 20 tickets": {
				id: pure.trackerNoFabrika.main,
				kind: "pure",
				state: trackerState,
				inputs: [
					{type: "tick", now: 120_000},
					{type: "find", text: "login"},
					{type: "show", show: "open"},
				],
			},
			"the core decodes one Write, no step": {
				id: "",
				kind: "decodeOnly",
				state: null,
				inputs: [{kind: "file", title: "Login fails", body: "Seen today."}],
				decode: "tracker Write",
			},
			"the core decodes one press, no step": {
				id: "",
				kind: "decodeOnly",
				state: null,
				inputs: ["plus"],
				decode: "counter Press",
			},
		};
		const bench: Record<string, unknown> = {};
		for (const [name, b] of Object.entries(benches)) {
			// The clock ticks in whole ms: a decode alone needs many more turns to be seen.
			const steps = b.kind === "decodeOnly" ? STEPS * 100 : STEPS;
			await call(mf, "a", "bench", {...b, steps}); // warm-up, not kept
			const runs = [];
			for (let r = 0; r < 3; r++) runs.push(await call(mf, "a", "bench", {...b, steps}));
			bench[name] = {perStepUs: runs.map((x) => round(x.perStepUs, 2)), stateBytes: runs[0].bytes};
		}
		// The update alone, in Node with the real Effect: what the step costs with no line to cross.
		const inNode = (
			machine: Parameters<typeof sandboxOf>[0],
			state: unknown,
			msgs: {type: string}[],
		) => {
			const sb = sandboxOf(machine);
			const n = STEPS * 100;
			let s = state;
			const t0 = performance.now();
			for (let i = 0; i < n; i++) s = sb.step(s, msgs[i % msgs.length] as {type: string}).state;
			return round(((performance.now() - t0) * 1000) / n, 2);
		};
		bench["counter, the update alone in Node"] = {
			perStepUs: [0, 1, 2].map(() =>
				inNode(counter.machines.count.machine, {n: 0}, [{type: "plus"}]),
			),
		};
		bench["tracker, the update alone in Node, 20 tickets"] = {
			perStepUs: [0, 1, 2].map(() =>
				inNode(tickets, trackerState, [
					{type: "tick", now: 120_000},
					{type: "find", text: "login"},
					{type: "show", show: "open"},
				]),
			),
		};
		results.benchInObject = bench;
		console.log("bench", JSON.stringify(bench, null, 1));

		// 3e. Shared module state, again.
		const p1 = onLibs(libs, builds.splitProbe, tag("probe", 1));
		const p2 = onLibs(libs, builds.splitProbe, tag("probe", 2));
		await install(mf, "a", p1);
		await install(mf, "a", p2);
		const v1Bumps = [];
		for (let i = 0; i < 3; i++) v1Bumps.push(await call(mf, "a", "bump", {id: p1.main}));
		const v2Bump = await call(mf, "a", "bump", {id: p2.main});
		await install(mf, "x", pure.counterMachine);
		await install(mf, "y", pure.counterMachine);
		const byVersion = [
			await call(mf, "x", "which", {id: pure.counterMachine.main}),
			await call(mf, "y", "which", {id: pure.counterMachine.main}),
		];
		const byProcess = [
			await call(mf, "x", "which", {id: pure.counterMachine.main, perProcess: true}),
			await call(mf, "y", "which", {id: pure.counterMachine.main, perProcess: true}),
			await call(mf, "x", "which", {id: pure.counterMachine.main, perProcess: true}),
		];
		results.sharedState = {
			splitProbe: {
				version1: v1Bumps.map((x) => x.n),
				version2: v2Bump.n,
				oneCopyAcrossVersions: v2Bump.n > 3,
			},
			pureByVersion: {
				answers: byVersion,
				oneIsolate:
					byVersion[0].born === byVersion[1].born && byVersion[1].calls > byVersion[0].calls,
			},
			pureByProcess: {
				answers: byProcess,
				// Each process's own isolate starts its count at 1.
				apart: byProcess[0].calls === 1 && byProcess[1].calls === 1,
				sameAgainForX: byProcess[2].calls > byProcess[0].calls,
			},
		};
		console.log("shared", JSON.stringify(results.sharedState, null, 1));
	} finally {
		await mf.dispose();
		rmSync(persist, {recursive: true, force: true});
	}
	writeFileSync(RESULTS, `${JSON.stringify(results, null, "\t")}\n`);
	console.log(`saved ${RESULTS.split("/").slice(-2).join("/")}`);
};

await main();
