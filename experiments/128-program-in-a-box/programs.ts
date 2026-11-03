// Experiment 128: the programs run in a box, and the one service that crosses its wall.
//
// This file is loaded in two places: by the host, for each program's declarations (its flags,
// inputs and outputs, to check what crosses), and by the runner inside the box, to run it.
// No key is in it: the real Greeter, the one that holds a key, is made on the host only
// (`realGreeter` in ../128-program-in-a-box.ts).
//
// Node at the edge: `probe` reads files and the environment with Node, on purpose. It is the
// program that looks for the key from inside.

import {readdirSync, readFileSync, statSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {defineMachine} from "@demlik/tea";
import {Cmd, run} from "@demlik/tea/effect";
import {defineProgram, flag, input, output} from "@kampus/fabrika-old";
import {Context, Effect, Schema, Stream} from "effect";
import {Rpc, RpcGroup} from "effect/rpc";
import {Outside, outside} from "./cmd-wall.ts";
import {boxable, type Wall} from "./wall.ts";

// ---------------------------------------------------------------- the service

/** A tiny service with one method. Its real layer holds a key. */
export class Greeter extends Context.Service<
	Greeter,
	{readonly greet: (name: string) => Effect.Effect<string>}
>()("exp128/Greeter") {}

export const GreeterRpcs = RpcGroup.make(
	Rpc.make("greet", {payload: {name: Schema.String}, success: Schema.String}),
);

/** How Greeter crosses the wall. */
export const greeterWall: Wall<Greeter, Greeter["Service"], RpcGroup.Rpcs<typeof GreeterRpcs>> = {
	name: "greeter",
	tag: Greeter,
	group: GreeterRpcs,
	inside: (client) => Greeter.of({greet: (name) => client.greet({name}).pipe(Effect.orDie)}),
	outside: (greeter) => GreeterRpcs.of({greet: ({name}) => greeter.greet(name)}),
};

// ---------------------------------------------------------------- the programs

/** The README's `double`. */
export const double = boxable(
	import.meta.url,
	"double",
	defineProgram({
		name: "double",
		description: "Doubles each number it is told, and ends when its input closes.",
		inputs: {n: input(Schema.Int, "A number to double.")},
		outputs: {n: output(Schema.Int, "The number, doubled.")},
		main: ({inputs, send}) => inputs.n.pipe(Stream.runForEach((n) => send("n", n * 2))),
	}),
);

const Greeting = Schema.Struct({text: Schema.String, ms: Schema.Number});

/** Greets each name it is told, through Greeter, and says how long the call took inside. */
export const greet = boxable(
	import.meta.url,
	"greet",
	defineProgram({
		name: "greet",
		description: "Greets each name it is told, through the Greeter service.",
		inputs: {name: input(Schema.String, "A name to greet.")},
		outputs: {greeting: output(Greeting, "The greeting, and the call's time in ms.")},
		main: ({inputs, send}) =>
			inputs.name.pipe(
				Stream.runForEach((name) =>
					Effect.gen(function* () {
						const greeter = yield* Greeter;
						const t0 = performance.now();
						const text = yield* greeter.greet(name);
						yield* send("greeting", {text, ms: performance.now() - t0});
					}),
				),
			),
	}),
	[greeterWall],
);

// ---------------------------------------------------------------- the Cmd wall

/** Runs inside the box: counts the words of a text. */
export const countWords = Cmd.define("count_words", {
	input: Schema.Struct({text: Schema.String}),
	ok: Schema.Int,
	err: ["empty"],
});

/** Keyed: signs a text and its count with the host's key. It runs on the host. */
export const stamp = Cmd.define("stamp", {
	input: Schema.Struct({text: Schema.String, words: Schema.Int}),
	ok: Schema.Struct({sig: Schema.String}),
	err: ["refused"],
});

interface Tally {
	readonly text: string;
	readonly words: number | null;
	readonly sig: string | null;
	readonly why: string | null;
}
const blank: Tally = {text: "", words: null, sig: null, why: null};
type Step = readonly [Tally, readonly ReturnType<typeof countWords | typeof stamp>[]];

/** One text: count its words in here, then have the host stamp it. */
const tally = defineMachine({
	types: {
		model: {} as Tally,
		msg: {} as {readonly type: "got"; readonly text: string},
		ctx: undefined,
	},
	cmds: [countWords, stamp],
	init: (loaded) => [loaded ?? blank, []],
	update: {
		got: (_, m): Step => [{...blank, text: m.text}, [countWords({text: m.text})]],
		count_words_ok: (s, m): Step => [
			{...s, words: m.value},
			[stamp({text: s.text, words: m.value})],
		],
		stamp_ok: (s, m): Step => [{...s, sig: m.value.sig}, []],
		count_words_err: (s, m): Step => [{...s, why: m.error._tag}, []],
		stamp_err: (s, m): Step => [{...s, why: m.error._tag}, []],
	},
});

/** Runs `tally` on one text, `stamp` outside, and says how long the stamp took from in here. */
const tallyOne = (text: string) =>
	Effect.gen(function* () {
		let ms = 0;
		const handle = yield* run(tally, {
			ctx: undefined,
			interpret: {
				count_words: (c: ReturnType<typeof countWords>) => {
					const words = c.text.split(/\s+/).filter((w) => w !== "").length;
					return words === 0 ? Effect.fail({_tag: "empty" as const}) : Effect.succeed(words);
				},
				stamp: (c: ReturnType<typeof stamp>) => {
					const t0 = performance.now();
					return outside(stamp)(c).pipe(
						Effect.ensuring(Effect.sync(() => (ms = performance.now() - t0))),
					);
				},
			},
			terminal: (s) => s.sig !== null || s.why !== null,
		});
		const runtime = yield* handle.ready;
		yield* runtime.dispatch({type: "got", text});
		const end = yield* runtime.done();
		return {...end, ms};
	}).pipe(Effect.scoped);

const Stamped = Schema.Struct({
	text: Schema.String,
	words: Schema.NullOr(Schema.Number),
	sig: Schema.NullOr(Schema.String),
	why: Schema.NullOr(Schema.String),
	ms: Schema.Number,
});

/** A tea machine in the box with one Cmd inside and one, keyed, outside. */
export const stamped = boxable(
	import.meta.url,
	"stamped",
	defineProgram({
		name: "stamped",
		description: "Counts the words of each text it is told, and has the host stamp it.",
		inputs: {text: input(Schema.String, "A text to count and stamp.")},
		outputs: {stamped: output(Stamped, "The text, its count, the host's stamp, the stamp's ms.")},
		main: ({inputs, send}) =>
			inputs.text.pipe(
				Stream.runForEach((text) => Effect.flatMap(tallyOne(text), (t) => send("stamped", t))),
			),
	}),
	[],
	[stamp],
);

const Forged = Schema.Struct({inside: Schema.String, host: Schema.String});

/**
 * Sends a `stamp` of the wrong shape twice: once through `outside`, which refuses it in the
 * box, and once around it, straight on the channel, as a broken box could.
 */
export const forge = boxable(
	import.meta.url,
	"forge",
	defineProgram({
		name: "forge",
		description: "Tries to send a stamp of the wrong shape, through the wall and around it.",
		inputs: {},
		outputs: {forged: output(Forged, "What each try came back with.")},
		main: ({send}) =>
			Effect.gen(function* () {
				const bad = {type: "stamp", text: 7, words: "many"} as never;
				const inside = yield* outside(stamp)(bad).pipe(
					Effect.exit,
					Effect.map((e) => (e._tag === "Success" ? "sent" : "refused in the box")),
				);
				const host = yield* (yield* Outside).send("stamp", {text: 7, words: "many"});
				yield* send("forged", {inside, host: host.kind === "no" ? `no: ${host.why}` : host.kind});
			}),
	}),
	[],
	[stamp],
);

// ---------------------------------------------------------------- the key probe

/** What the probe found, inside the box. */
const Report = Schema.Struct({
	/** A value of the program's environment holds the key. */
	env: Schema.Boolean,
	/** Linux only: the process's environment as the kernel keeps it holds the key. */
	procEnv: Schema.Boolean,
	/** The host's key file could be read at all, and whether it held the key. */
	keyFileRead: Schema.Boolean,
	keyFileHit: Schema.Boolean,
	/** Files under the box's temp folder and home looked at, and how many held the key. */
	scanned: Schema.Number,
	fileHits: Schema.Number,
	/** An HTTPS request to example.com got any answer: the box has a network. */
	net: Schema.Boolean,
	/** The one call across the wall, a greeting or a stamp: it still works. */
	call: Schema.String,
	home: Schema.String,
	tmp: Schema.String,
});

const FAKE_KEY = /fake-key-[0-9a-f]{32}/g;

const sha256 = (text: string) =>
	Effect.promise(async () => {
		const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
		return Buffer.from(bytes).toString("hex");
	});

/** Does `text` hold the key whose hash is `hash`? The probe never knows the key, only its hash. */
const holds = (text: string, hash: string) =>
	Effect.gen(function* () {
		for (const found of text.match(FAKE_KEY) ?? [])
			if ((yield* sha256(found)) === hash) return true;
		return false;
	});

const readOr = (path: string): string | null => {
	try {
		return readFileSync(path, "utf8");
	} catch {
		return null;
	}
};

/** Files under `root`, at most `depth` folders down and `max` in all, each under 1 MB. */
const walk = (root: string, depth: number, max: number): string[] => {
	const found: string[] = [];
	const go = (dir: string, left: number) => {
		if (found.length >= max) return;
		let names: string[];
		try {
			names = readdirSync(dir);
		} catch {
			return;
		}
		for (const name of names) {
			if (found.length >= max) return;
			const path = join(dir, name);
			try {
				const s = statSync(path);
				if (s.isDirectory() && left > 0) go(path, left - 1);
				else if (s.isFile() && s.size < 1_000_000) found.push(path);
			} catch {
				// Not ours to read: the box said no.
			}
		}
	};
	go(root, depth);
	return found;
};

const probeFlags = {
	hash: flag(Schema.String, "The SHA-256 of the key to look for. Never the key."),
	keyFile: flag(Schema.String, "Where the host keeps the key, to try to read it."),
};

/** Looks for the key from inside the box, then makes one call across the wall. */
const look = <E, R>(
	flags: {readonly hash: string; readonly keyFile: string},
	call: Effect.Effect<string, E, R>,
) =>
	Effect.gen(function* () {
		const env = yield* holds(Object.values(process.env).join("\n"), flags.hash);
		const proc = readOr("/proc/self/environ");
		const key = readOr(flags.keyFile);
		const home = process.env.HOME ?? "";
		const files = [
			...walk(tmpdir(), 3, 500),
			...(home === "" || home === "/" ? [] : walk(home, 2, 500)),
		];
		let fileHits = 0;
		for (const f of files) if (yield* holds(readOr(f) ?? "", flags.hash)) fileHits++;
		const net = yield* Effect.promise(() =>
			fetch("https://example.com", {signal: AbortSignal.timeout(3_000)}).then(
				() => true,
				() => false,
			),
		);
		return {
			net,
			env,
			procEnv: proc !== null && (yield* holds(proc.replaceAll("\0", "\n"), flags.hash)),
			keyFileRead: key !== null,
			keyFileHit: key !== null && (yield* holds(key, flags.hash)),
			scanned: files.length,
			fileHits,
			call: yield* call,
			home,
			tmp: tmpdir(),
		};
	});

/** The probe whose one call is Greeter's, over the RPC wall. */
export const probe = boxable(
	import.meta.url,
	"probe",
	defineProgram({
		name: "probe",
		description: "Looks for the host's key in its own environment and files, then greets once.",
		flags: probeFlags,
		inputs: {},
		outputs: {report: output(Report, "What was found, and the greeting.")},
		main: ({flags, send}) =>
			Effect.flatMap(
				look(
					flags,
					Effect.flatMap(Greeter, (g) => g.greet("probe")),
				),
				(r) => send("report", r),
			),
	}),
	[greeterWall],
);

/** The probe whose one call is a `stamp`, over the Cmd wall. */
export const probeCmd = boxable(
	import.meta.url,
	"probeCmd",
	defineProgram({
		name: "probeCmd",
		description: "Looks for the host's key in its own environment and files, then stamps once.",
		flags: probeFlags,
		inputs: {},
		outputs: {report: output(Report, "What was found, and the stamp.")},
		main: ({flags, send}) =>
			Effect.flatMap(
				look(flags, tallyOne("probe").pipe(Effect.map((t) => t.sig ?? `no stamp: ${t.why}`))),
				(r) => send("report", r),
			),
	}),
	[],
	[stamp],
);
