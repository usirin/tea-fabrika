// Experiment 128: a whole fabrika program in a box, and a service that crosses the wall
// while its key stays out.
//
//   env -u TYPESAFE_API_KEY node experiments/128-program-in-a-box.ts run none
//   env -u TYPESAFE_API_KEY SRT=<srt bin> node experiments/128-program-in-a-box.ts run srt
//   env -u TYPESAFE_API_KEY node experiments/128-program-in-a-box.ts run docker
//   env -u TYPESAFE_API_KEY node experiments/128-program-in-a-box.ts clean
//   ... run <box> cmd     the Cmd wall's measurements alone, kept beside the rest
//
// `SRT` is the `srt` CLI of `@anthropic-ai/sandbox-runtime` 0.0.81, installed in a scratch
// folder outside the repo, as in experiment 127. Docker builds a Node + pnpm image from a
// Dockerfile on stdin and fills a Linux node_modules volume with experiment 98's install script.
// Everything docker makes carries the label `exp128`; `clean` removes it, and `run docker`
// cleans at its end too.
//
// $0: no model, no agent, no real key. The key is a random `fake-key-<32 hex>` made at each
// start. It is put in this process's environment and in a file in the home folder, the two
// places a real key sits, and the real Greeter reads it from the environment. The file is
// removed at the end.
//
// The parts (experiments/128-program-in-a-box/):
//   wall.ts     fabrika's part: the frames, the stand-in maker and the host's server for a wall
//   cmd-wall.ts fabrika's part: the Cmd wall, a tea Cmd run on the host
//   runner.ts   fabrika's part: the runner inside the box
//   host.ts     fabrika's part: startBoxed
//   box.ts      the box tool's part: experiment 127's boxed(), the srt settings, the image
//   programs.ts double, greet, probe, the Greeter service; stamped, forge, probeCmd

import {execFileSync} from "node:child_process";
import {createHash, createHmac, randomBytes} from "node:crypto";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import {homedir, tmpdir} from "node:os";
import {dirname, join} from "node:path";
import {fileURLToPath} from "node:url";
import {start} from "@kampus/fabrika";
import {toolchain} from "@kampus/fabrika/agents/sandbox";
import {Deferred, Effect, Exit, Layer, Scope} from "effect";
import {
	type Box,
	cleanDocker,
	containerThere,
	prepareDocker,
	srtSettings,
} from "./128-program-in-a-box/box.ts";
import {answer, Outside} from "./128-program-in-a-box/cmd-wall.ts";
import {type BoxedRunning, type Place, startBoxed} from "./128-program-in-a-box/host.ts";
import {
	double,
	forge,
	Greeter,
	greet,
	probe,
	probeCmd,
	stamp,
	stamped,
} from "./128-program-in-a-box/programs.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = realpathSync(join(HERE, ".."));
const RESULTS = join(HERE, "results", "128-program-in-a-box.json");
const DOCKER = {
	label: "exp128",
	image: "exp128-node:local",
	volume: "exp128-node-modules",
} as const;
const BOXES = ["none", "srt", "docker"] as const;
type BoxName = (typeof BOXES)[number];

// ---------------------------------------------------------------- the key and the real service

const KEY_NAME = "EXP128_GREETER_KEY";
const key = `fake-key-${randomBytes(16).toString("hex")}`;
/** What the probe is handed: the key's SHA-256, never the key. */
const keyHash = createHash("sha256").update(key).digest("hex");
const keyFile = join(homedir(), `.exp128-key-${randomBytes(4).toString("hex")}`);
process.env[KEY_NAME] = key;

const sign = (secret: string, name: string) =>
	createHmac("sha256", secret).update(name).digest("hex").slice(0, 8);

/** The real Greeter: it holds the key, and runs on the host only. */
const realGreeter = Layer.sync(Greeter, () => {
	const secret = process.env[KEY_NAME] ?? "";
	return Greeter.of({
		greet: (name) => Effect.sync(() => `hello ${name}, signed ${sign(secret, name)}`),
	});
});

/** The real `stamp` handler, for the Cmd wall: it holds the key too, and runs on the host only. */
let stamps = 0;
const handlers = {
	stamp: (c: ReturnType<typeof stamp>) =>
		Effect.sync(() => {
			stamps++;
			return {sig: sign(process.env[KEY_NAME] ?? "", `${c.text}:${c.words}`)};
		}),
};

// ---------------------------------------------------------------- places

const job = realpathSync(mkdtempSync(join(tmpdir(), "exp128-")));
mkdirSync(join(job, "tmp"));

const placeOf = (name: BoxName): Place => {
	// srt starts the program through bash, so the system's own folders are on the PATH.
	const env = {PATH: `${dirname(process.execPath)}:/usr/bin:/bin`, TMPDIR: join(job, "tmp")};
	if (name === "none")
		return {box: {kind: "none"}, root: REPO, hostRoot: REPO, node: process.execPath, env};
	if (name === "srt") {
		const srt = process.env.SRT;
		if (srt === undefined) throw new Error("set SRT to the srt CLI");
		const settingsFile = join(job, "srt.json");
		writeFileSync(
			settingsFile,
			JSON.stringify(
				srtSettings({
					deny: [homedir(), job],
					read: [REPO, ...toolchain()],
					write: [join(job, "tmp")],
				}),
				null,
				2,
			),
		);
		return {
			box: {kind: "srt", srt, settingsFile},
			root: REPO,
			hostRoot: REPO,
			node: process.execPath,
			env,
		};
	}
	const box: Box = {
		kind: "docker",
		image: DOCKER.image,
		label: DOCKER.label,
		mounts: [
			{from: REPO, to: "/repo", readOnly: true},
			{from: DOCKER.volume, to: "/repo/node_modules", readOnly: true},
		],
	};
	return {box, root: "/repo", hostRoot: REPO, node: "node", env: {}};
};

// ---------------------------------------------------------------- helpers

const median = (xs: readonly number[]) => {
	const s = [...xs].sort((a, b) => a - b);
	if (s.length === 0) return null;
	const m = Math.floor(s.length / 2);
	return (
		Math.round((s.length % 2 === 1 ? (s[m] ?? 0) : ((s[m - 1] ?? 0) + (s[m] ?? 0)) / 2) * 100) / 100
	);
};
const r2 = (n: number) => Math.round(n * 100) / 100;

/** The next value an output says, or fail after `ms`. */
const next = (started: BoxedRunning<any>, name: string, ms = 30_000) =>
	Effect.gen(function* () {
		const got = yield* Deferred.make<unknown>();
		const off = started.run.listen(name as never, (v) => Deferred.doneUnsafe(got, Exit.succeed(v)));
		const endedFirst = started.run.ended.pipe(
			Effect.flatMap((e) =>
				Effect.die(new Error(`no ${name}: the run ended ${JSON.stringify(e)}`)),
			),
		);
		return yield* Effect.raceFirst(Deferred.await(got), endedFirst).pipe(
			Effect.ensuring(Effect.sync(off)),
			Effect.timeoutOrElse({
				duration: ms,
				orElse: () => Effect.die(new Error(`no ${name} in ${ms} ms`)),
			}),
		);
	});

const running = <P extends {kind: string}>(s: P) => {
	if (s.kind !== "running") throw new Error(`not started: ${JSON.stringify(s)}`);
	return s as Extract<P, {kind: "running"}>;
};

const alive = (pid: number | undefined) => {
	if (pid === undefined) return false;
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
};

/** Run one scoped measurement with the real Greeter on the host. */
const run = <A>(eff: Effect.Effect<A, unknown, any>): Promise<A> =>
	Effect.runPromise(eff.pipe(Effect.scoped, Effect.provide(realGreeter)) as Effect.Effect<A>);

const errorOf = (e: unknown) =>
	(e instanceof Error ? e.message : String(e))
		.replaceAll(REPO, "<repo>")
		.replaceAll(job, "<job>")
		.replaceAll(homedir(), "~")
		.slice(0, 600);

// ---------------------------------------------------------------- the measurements

const works = (place: Place) =>
	run(
		Effect.gen(function* () {
			const heard: number[] = [];
			const d = running(yield* startBoxed(place, double, {}, {n: (v) => heard.push(v as number)}));
			for (const n of [1, 2, 3]) yield* d.run.tell("n", n);
			d.close("n");
			const dEnd = yield* d.run.ended;
			const g = running(yield* startBoxed(place, greet, {}));
			const reply = next(g, "greeting");
			yield* g.run.tell("name", "ada");
			const said = (yield* reply) as {text: string};
			g.close("name");
			const gEnd = yield* g.run.ended;
			return {
				double: {ok: heard.join(",") === "2,4,6" && dEnd.kind === "ended", heard, ended: dEnd},
				greet: {
					ok: said.text === `hello ada, signed ${sign(key, "ada")}` && gEnd.kind === "ended",
					text: said.text,
					ended: gEnd,
				},
			};
		}),
	);

/** From `startBoxed` to the first output, the first value told at once. */
const startTimes = async (place: Place, n = 5) => {
	const ms: number[] = [];
	for (let i = 0; i < n; i++)
		ms.push(
			await run(
				Effect.gen(function* () {
					const t0 = performance.now();
					const d = running(yield* startBoxed(place, double, {}));
					const first = next(d, "n");
					yield* d.run.tell("n", 21);
					yield* first;
					const t = performance.now() - t0;
					d.close("n");
					yield* d.run.ended;
					return t;
				}),
			),
		);
	return {ms: ms.map(r2), median: median(ms)};
};

/** 20 Greeter calls, one at a time, after one to warm up: inside (the call) and outside (tell to heard). */
const roundTrips = (place: Place, n = 20) =>
	run(
		Effect.gen(function* () {
			const g = running(yield* startBoxed(place, greet, {}));
			const inside: number[] = [];
			const outside: number[] = [];
			for (let i = 0; i <= n; i++) {
				const reply = next(g, "greeting");
				const t0 = performance.now();
				yield* g.run.tell("name", `n${i}`);
				const said = (yield* reply) as {ms: number};
				if (i === 0) continue;
				outside.push(performance.now() - t0);
				inside.push(said.ms);
			}
			g.close("name");
			yield* g.run.ended;
			return {calls: n, insideMedianMs: median(inside), outsideMedianMs: median(outside)};
		}),
	);

/** The probe looks for the key from inside, then makes its one call: a greeting, or a stamp. */
const keyCheck = (place: Place, wall: "rpc" | "cmd" = "rpc") =>
	run(
		Effect.gen(function* () {
			const flags = {hash: keyHash, keyFile};
			const p = running(
				wall === "rpc"
					? yield* startBoxed(place, probe, flags)
					: yield* startBoxed(place, probeCmd, flags, {}, handlers),
			);
			const report = (yield* next(p, "report")) as Record<string, unknown>;
			yield* p.run.ended;
			const home = String(report.home);
			const out =
				report.env === false &&
				report.procEnv === false &&
				report.keyFileHit === false &&
				report.fileHits === 0;
			const expected =
				wall === "rpc" ? `hello probe, signed ${sign(key, "probe")}` : sign(key, "probe:1");
			return {
				keyStaysOut: out,
				callWorks: report.call === expected,
				...report,
				home: home.startsWith(homedir()) ? home.replace(homedir(), "~") : home,
				tmp: String(report.tmp).replace(job, "<job>"),
			};
		}),
	);

const edges = async (place: Place) => {
	const wrongShape = await run(
		Effect.gen(function* () {
			const d = running(yield* startBoxed(place, double, {}));
			const before = d.sent();
			const words = {
				half: yield* d.run.tell("n", 1.5),
				text: yield* d.run.tell("n", "two"),
				noInput: yield* d.run.tell("m" as never, 1),
			};
			const crossed = d.sent() - before;
			const badFlags = yield* startBoxed(place, probe, {hash: 7, keyFile});
			d.close("n");
			yield* d.run.ended;
			return {words, framesCrossed: crossed, badFlags: badFlags.kind};
		}),
	);
	const killed = await run(
		Effect.gen(function* () {
			const d = running(yield* startBoxed(place, double, {}));
			const first = next(d, "n");
			yield* d.run.tell("n", 1);
			yield* first;
			const pid = yield* d.run.pid;
			const t0 = performance.now();
			// The program's own process, by the id it said in its first line; in a container, from inside it.
			if (d.box.name !== null)
				execFileSync("docker", ["exec", d.box.name, "sh", "-c", `kill -9 ${pid}`], {
					stdio: "ignore",
				});
			else process.kill(pid, "SIGKILL");
			const ended = yield* d.run.ended.pipe(
				Effect.timeoutOrElse({
					duration: 10_000,
					orElse: () => Effect.succeed({kind: "hung" as const}),
				}),
			);
			const ms = performance.now() - t0;
			const word = yield* d.run.tell("n", 2);
			return {how: "SIGKILL to the runner", ended, endedMs: r2(ms), tellAfter: word};
		}),
	);
	if ("why" in killed.ended) killed.ended = {...killed.ended, why: errorOf(killed.ended.why)};
	const scope = await Effect.runPromise(
		Effect.gen(function* () {
			const s = yield* Scope.make();
			const d = running(yield* startBoxed(place, double, {}).pipe(Scope.provide(s)));
			const first = next(d, "n");
			yield* d.run.tell("n", 1);
			yield* first;
			const pid = yield* d.run.pid;
			const before = d.box.name === null ? alive(pid) : containerThere(d.box.name);
			yield* Scope.close(s, Exit.void);
			yield* Effect.sleep("1 second");
			return {
				thereBefore: before,
				runnerAlive: d.box.name === null ? alive(pid) : null,
				boxProcessAlive: alive(d.box.child.pid),
				containerThere: d.box.name === null ? null : containerThere(d.box.name),
			};
		}).pipe(Effect.provide(realGreeter)) as Effect.Effect<Record<string, boolean | null>>,
	);
	return {
		wrongShape,
		killed,
		scopeClosed: {
			...scope,
			gone: !Object.values(scope)
				.slice(1)
				.some((v) => v === true),
		},
	};
};

type Stamped = {
	text: string;
	words: number | null;
	sig: string | null;
	why: string | null;
	ms: number;
};

/** The Cmd wall: a tea machine in the box, `count_words` run inside, `stamp` run on the host. */
const cmdWall = async (place: Place, n = 20) => {
	const works = await run(
		Effect.gen(function* () {
			const before = stamps;
			const s = running(yield* startBoxed(place, stamped, {}, {}, handlers));
			const first = next(s, "stamped");
			yield* s.run.tell("text", "two words here");
			const one = (yield* first) as Stamped;
			const second = next(s, "stamped");
			yield* s.run.tell("text", "   ");
			const empty = (yield* second) as Stamped;
			s.close("text");
			const ended = yield* s.run.ended;
			return {
				ok:
					one.words === 3 &&
					one.sig === sign(key, "two words here:3") &&
					empty.why === "empty" &&
					empty.sig === null &&
					stamps - before === 1 &&
					ended.kind === "ended",
				stamped: {words: one.words, sigRight: one.sig === sign(key, "two words here:3")},
				empty: {why: empty.why, sig: empty.sig},
				handlerRan: stamps - before,
				cmdFrames: s.cmds(),
				ended,
			};
		}),
	);
	const call = await run(
		Effect.gen(function* () {
			const s = running(yield* startBoxed(place, stamped, {}, {}, handlers));
			const inside: number[] = [];
			const outside: number[] = [];
			for (let i = 0; i <= n; i++) {
				const reply = next(s, "stamped");
				const t0 = performance.now();
				yield* s.run.tell("text", `text number ${i}`);
				const t = (yield* reply) as Stamped;
				if (i === 0) continue;
				outside.push(performance.now() - t0);
				inside.push(t.ms);
			}
			s.close("text");
			yield* s.run.ended;
			return {calls: n, insideMedianMs: median(inside), outsideMedianMs: median(outside)};
		}),
	);
	const wrongShape = await run(
		Effect.gen(function* () {
			const before = stamps;
			const f = running(yield* startBoxed(place, forge, {}, {}, handlers));
			const forged = (yield* next(f, "forged")) as {inside: string; host: string};
			yield* f.run.ended;
			// Two tries; only the one sent around `outside` reaches the host, and the host refuses it.
			return {...forged, cmdFramesHeard: f.cmds(), handlerRan: stamps - before};
		}),
	);
	return {works, call, key: await keyCheck(place, "cmd"), wrongShape};
};

/** The same program on the host, in-process, with `start`: the baseline. */
const inProcess = async () => {
	const startMs: number[] = [];
	for (let i = 0; i < 5; i++)
		startMs.push(
			await run(
				Effect.gen(function* () {
					const t0 = performance.now();
					const got = yield* Deferred.make<void>();
					const s = running(
						yield* start(double.program, {}, {n: () => Deferred.doneUnsafe(got, Exit.void)}),
					);
					yield* s.run.tell("n", 21);
					yield* Deferred.await(got);
					const t = performance.now() - t0;
					s.close("n");
					yield* s.run.ended;
					return t;
				}),
			),
		);
	const rtt = await run(
		Effect.gen(function* () {
			const inside: number[] = [];
			let got = yield* Deferred.make<number>();
			const s = running(
				yield* start(
					greet.program,
					{},
					{greeting: (g) => Deferred.doneUnsafe(got, Exit.succeed(g.ms))},
				),
			);
			for (let i = 0; i <= 20; i++) {
				got = yield* Deferred.make<number>();
				yield* s.run.tell("name", `n${i}`);
				const ms = yield* Deferred.await(got);
				if (i > 0) inside.push(ms);
			}
			s.close("name");
			yield* s.run.ended;
			return median(inside);
		}),
	);
	// `stamped` in-process: its `Outside` hands each Cmd straight to the host's `answer`.
	const here = Layer.succeed(Outside, {
		send: (name, input) => answer([stamp], handlers, {id: 0, name, input}),
	});
	const stampMs = await run(
		Effect.gen(function* () {
			const inside: number[] = [];
			let got = yield* Deferred.make<number>();
			const s = running(
				yield* start(
					stamped.program,
					{},
					{stamped: (t) => Deferred.doneUnsafe(got, Exit.succeed(t.ms))},
				),
			);
			for (let i = 0; i <= 20; i++) {
				got = yield* Deferred.make<number>();
				yield* s.run.tell("text", `text number ${i}`);
				const ms = yield* Deferred.await(got);
				if (i > 0) inside.push(ms);
			}
			s.close("text");
			yield* s.run.ended;
			return median(inside);
		}).pipe(Effect.provide(here)),
	);
	return {
		startMedianMs: median(startMs),
		startMs: startMs.map(r2),
		callMedianMs: rtt,
		stampMedianMs: stampMs,
	};
};

// ---------------------------------------------------------------- sizes

/** Lines that hold code: not blank, not only a comment. */
const codeLines = (text: string) =>
	text.split("\n").filter((l) => {
		const t = l.trim();
		return t !== "" && !t.startsWith("//") && !t.startsWith("*") && !t.startsWith("/*");
	}).length;

const sizes = () => {
	const read = (f: string) => readFileSync(join(HERE, "128-program-in-a-box", f), "utf8");
	const box = read("box.ts");
	// `boxed()` and what it uses: from the Command type to the srt section.
	const from = box.indexOf("export interface Command");
	const boxedOnly = box.slice(from, box.indexOf("\n// ----", from));
	const fabrika = {
		wall: codeLines(read("wall.ts")),
		runner: codeLines(read("runner.ts")),
		host: codeLines(read("host.ts")),
	};
	// The two walls. RPC: the Wall type, standIn and serve in wall.ts, and per service its RPC
	// group and its Wall value. Cmd: all of cmd-wall.ts; per Cmd, nothing but its name in a list.
	const wall = read("wall.ts");
	const programs = read("programs.ts");
	const between = (text: string, a: string, b: string) => {
		const i = text.indexOf(a);
		return text.slice(i, text.indexOf(b, i));
	};
	const rpcShared =
		codeLines(between(wall, "export interface Wall", "/**\n * A program a box")) +
		codeLines(wall.slice(wall.indexOf("/** Where an `rpc` frame")));
	const rpcPerService = codeLines(
		between(
			programs,
			"export const GreeterRpcs",
			"// ----------------------------------------------------------------",
		),
	);
	return {
		fabrika: {
			...fabrika,
			cmdWall: codeLines(read("cmd-wall.ts")),
			total: fabrika.wall + fabrika.runner + fabrika.host + codeLines(read("cmd-wall.ts")),
		},
		walls: {
			rpc: {shared: rpcShared, perService: rpcPerService, newSchemasPerMethod: 1},
			cmd: {shared: codeLines(read("cmd-wall.ts")), perCmd: 0, newSchemasPerCmd: 0},
		},
		box: {boxed: codeLines(boxedOnly), all: codeLines(box)},
	};
};

// ---------------------------------------------------------------- main

const load = (): Record<string, unknown> =>
	existsSync(RESULTS) ? JSON.parse(readFileSync(RESULTS, "utf8")) : {experiment: 128, boxes: {}};

/** All the measurements for one box, or with `only` "cmd" the Cmd wall's alone, kept beside the rest. */
const one = async (name: BoxName, only: string | undefined, was: unknown) => {
	const place = placeOf(name);
	const out: Record<string, unknown> =
		only === "cmd" && typeof was === "object" && was !== null ? {...was} : {box: name};
	const step = async (label: string, f: () => Promise<unknown>) => {
		try {
			out[label] = await f();
		} catch (e) {
			out[label] = {error: errorOf(e)};
		}
		console.log(label, JSON.stringify(out[label]));
	};
	if (only !== "cmd") {
		await step("works", () => works(place));
		await step("start", () => startTimes(place));
		await step("call", () => roundTrips(place));
		await step("key", () => keyCheck(place));
		await step("edges", () => edges(place));
	}
	await step("cmdWall", () => cmdWall(place));
	return out;
};

const main = async () => {
	const [mode, which, only] = process.argv.slice(2);
	if (mode === "clean") return console.log(cleanDocker(DOCKER));
	if (mode !== "run" || !BOXES.some((b) => b === which))
		throw new Error(`usage: run ${BOXES.join("|")} | clean`);
	const name = which as BoxName;
	writeFileSync(keyFile, `${key}\n`);
	const data = load() as {boxes: Record<string, unknown>; [k: string]: unknown};
	try {
		if (name === "docker") data.docker = prepareDocker(REPO, DOCKER);
		if (name === "none") data.inProcess = await inProcess();
		data.boxes[name] = await one(name, only, data.boxes[name]);
		data.sizes = sizes();
		data.date = new Date().toISOString().slice(0, 10);
		data.node = process.version;
	} finally {
		rmSync(keyFile, {force: true});
		rmSync(job, {recursive: true, force: true});
		if (name === "docker") data.dockerClean = cleanDocker(DOCKER);
	}
	const text = `${JSON.stringify(data, null, "\t")}\n`;
	if (text.includes(key)) throw new Error("the key is in the results: not written");
	writeFileSync(RESULTS, text);
	console.log("written", data.sizes);
};

await main();
