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
import {defineProgram, flag, input, output} from "@kampus/fabrika";
import {Context, Effect, Schema, Stream} from "effect";
import {Rpc, RpcGroup} from "effect/rpc";
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
	/** The one Greeter call: it still works. */
	greeting: Schema.String,
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

/** Looks for the key from inside the box, then calls Greeter once. */
export const probe = boxable(
	import.meta.url,
	"probe",
	defineProgram({
		name: "probe",
		description: "Looks for the host's key in its own environment and files, then greets once.",
		flags: {
			hash: flag(Schema.String, "The SHA-256 of the key to look for. Never the key."),
			keyFile: flag(Schema.String, "Where the host keeps the key, to try to read it."),
		},
		inputs: {},
		outputs: {report: output(Report, "What was found, and the greeting.")},
		main: ({flags, send}) =>
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
				const greeter = yield* Greeter;
				yield* send("report", {
					net,
					env,
					procEnv: proc !== null && (yield* holds(proc.replaceAll("\0", "\n"), flags.hash)),
					keyFileRead: key !== null,
					keyFileHit: key !== null && (yield* holds(key, flags.hash)),
					scanned: files.length,
					fileHits,
					greeting: yield* greeter.greet("probe"),
					home,
					tmp: tmpdir(),
				});
			}),
	}),
	[greeterWall],
);
