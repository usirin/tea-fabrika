import {mkdirSync, readFileSync, rmSync, writeFile, writeFileSync} from "node:fs";
import {homedir} from "node:os";
import {join} from "node:path";
import * as readline from "node:readline";
import {PassThrough} from "node:stream";
import {type Cause, Effect, Fiber, Queue, Ref, Stream} from "effect";
import {start} from "../program/program.ts";
import {memoryStorage} from "../program/storage.ts";
import {fileStorage} from "../program/storage-node.ts";
import {complete} from "./complete.ts";
import {runIdOf} from "./execute.ts";
import {EMPTY} from "./jobs.ts";
import {homeOf, linesOf, programsOf, type Source, showOf, sourceOf, USAGE} from "./launch.ts";
import {JobStorage, type ProgramList, Programs} from "./programs.ts";
import {begin, keyOf, keysIn, type Search, shown, step} from "./search.ts";
import {type Printed, type Ready, tsh} from "./shell.ts";
import type {Show} from "./short.ts";

// The launcher: tsh on a terminal, or on a script. tsh itself (./shell.ts)
// is lines in, lines out, with no terminal in it; this file is the terminal.
//
//   node src/tsh/main.ts                  a terminal session (bin/tsh is this)
//   node src/tsh/main.ts -c 'seq --to 3'  the lines, then the end; exits with the last line's status
//   node src/tsh/main.ts script.tsh       the same, from a file
//   echo 'seq --to 3' | node src/tsh/main.ts
//
// On a terminal it is Node's readline: a prompt, editing, history kept in the
// home, and Tab completion from the pure completer (./complete.ts). readline
// has no Ctrl-R, so raw keys pass through a filter first that runs the
// history search (./search.ts) and hands every other key on. Ctrl-C tells tsh
// `signal interrupt`: what runs in the foreground is stopped by its starter's
// stop, and tsh goes on. Ctrl-D closes tsh's `line`: tsh ends.
//
// Everything tsh says comes in on one queue, from its listeners, and is drawn
// by one fiber that holds the terminal: a line printed while the prompt is
// up is drawn above it, and the prompt comes back on `ready`.

/** What tsh said, in its order. */
type Said =
	| {readonly kind: "printed"; readonly printed: Printed}
	| {readonly kind: "ready"; readonly ready: Ready};

type Started = Extract<Effect.Success<ReturnType<typeof startTsh>>, {readonly kind: "running"}>;

const startTsh = (
	list: ProgramList,
	home: string,
	show: Show,
	said: Queue.Queue<Said, Cause.Done>,
) =>
	Effect.gen(function* () {
		const storage = fileStorage(join(home, "storage"));
		// A fresh run each time: what outlives one tsh is its job table and its jobs, in the job
		// storage. tsh's own run is never started again, so it keeps its record in memory, and
		// the folder does not fill with one record per session.
		const id = yield* runIdOf("tsh");
		return yield* start(
			tsh,
			{show},
			{
				printed: (printed) => Queue.offerUnsafe(said, {kind: "printed", printed}),
				ready: (ready) => Queue.offerUnsafe(said, {kind: "ready", ready}),
			},
			{id, storage: memoryStorage()},
		).pipe(Effect.provideService(Programs, list), Effect.provideService(JobStorage, storage));
	});

/** One tsh per home: two would each run the jobs of one table. */
const takeLock = (home: string) =>
	Effect.gen(function* () {
		const file = join(home, "lock");
		const claim = Effect.try({
			try: () => writeFileSync(file, String(process.pid), {flag: "wx"}),
			catch: () => "taken" as const,
		});
		const free = yield* claim.pipe(
			Effect.as(true),
			Effect.orElseSucceed(() => false),
		);
		if (free) return {kind: "mine" as const, file};
		const holder = Number(
			yield* Effect.try(() => readFileSync(file, "utf8")).pipe(Effect.orElseSucceed(() => "")),
		);
		// `kill(pid, 0)` sends nothing: it only asks whether that process is there.
		const alive =
			Number.isInteger(holder) &&
			holder > 0 &&
			(yield* Effect.try(() => process.kill(holder, 0)).pipe(
				Effect.as(true),
				Effect.orElseSucceed(() => false),
			));
		if (alive) return {kind: "held" as const, holder};
		// Its holder is gone (killed, crashed): the lock is stale. Take it once; a race lost is held.
		yield* Effect.try(() => rmSync(file, {force: true})).pipe(Effect.ignore);
		const now = yield* claim.pipe(
			Effect.as(true),
			Effect.orElseSucceed(() => false),
		);
		return now ? {kind: "mine" as const, file} : {kind: "held" as const, holder};
	});

const write = (to: "out" | "err", text: string) =>
	(to === "out" ? process.stdout : process.stderr).write(`${text}\n`);

/** Lines from a text or a file, or from stdin as they come; each told in order, then `line` closed. */
const batch = (started: Started, said: Queue.Queue<Said, Cause.Done>, source: Source) =>
	Effect.gen(function* () {
		const last = yield* Ref.make(0);
		const drawer = yield* Stream.fromQueue(said).pipe(
			Stream.runForEach((s) =>
				s.kind === "printed"
					? Effect.sync(() => write(s.printed.to, s.printed.text))
					: Ref.set(last, s.ready.status),
			),
			Effect.forkScoped,
		);
		const interrupt = () => started.run.tell("signal", "interrupt");
		process.on("SIGINT", interrupt);
		if (source.kind === "stdin") {
			const rl = readline.createInterface({input: process.stdin, terminal: false});
			rl.on("line", (line) => started.run.tell("line", line));
			rl.on("close", () => started.close("line"));
			yield* started.run.ended;
			rl.close();
		} else {
			const text =
				source.kind === "text"
					? source.text
					: yield* Effect.try(() =>
							source.kind === "file" ? readFileSync(source.path, "utf8") : "",
						).pipe(Effect.option);
			if (typeof text !== "string" && text._tag === "None") {
				process.off("SIGINT", interrupt);
				write("err", `tsh: cannot read ${source.kind === "file" ? source.path : "the script"}`);
				return 127;
			}
			const lines = linesOf(typeof text === "string" ? text : text.value);
			for (const line of lines) started.run.tell("line", line);
			started.close("line");
			yield* started.run.ended;
		}
		process.off("SIGINT", interrupt);
		Queue.endUnsafe(said);
		yield* Fiber.join(drawer);
		return yield* Ref.get(last);
	});

/** A terminal session: readline, history, completion, Ctrl-R, Ctrl-C, Ctrl-D. */
const terminal = (
	started: Started,
	said: Queue.Queue<Said, Cause.Done>,
	list: ProgramList,
	home: string,
) =>
	Effect.gen(function* () {
		const historyFile = join(home, "history");
		const kept = yield* Effect.try(() => readFileSync(historyFile, "utf8")).pipe(
			Effect.orElseSucceed(() => ""),
		);
		// readline holds its history newest first; the file keeps it oldest first, like bash's.
		let history: readonly string[] = linesOf(kept).toReversed();
		const keys = new PassThrough();
		const rl = readline.createInterface({
			input: keys,
			output: process.stdout,
			terminal: true,
			history: [...history],
			historySize: 1000,
			removeHistoryDuplicates: true,
			prompt: "tsh$ ",
			completer: (line: string) => {
				const done = complete(line, list, started.run.machines.jobs.state() ?? EMPTY);
				return [[...done.candidates], done.word];
			},
		});
		rl.on("history", (now: string[]) => {
			history = [...now];
			writeFile(historyFile, `${[...now].reverse().join("\n")}\n`, () => {});
		});

		// Lines told and not yet `ready`: the prompt is up only when none is.
		let waiting = 0;
		let search: Search | null = null;
		const clearRow = () => {
			readline.clearLine(process.stdout, 0);
			readline.cursorTo(process.stdout, 0);
		};
		const drawSearch = (now: Search) => {
			clearRow();
			process.stdout.write(shown(history, now));
		};

		/** One key while a search is up. */
		const searchKey = (now: Search, key: string) => {
			const stepped = step(history, now, keyOf(key));
			if (stepped.kind === "searching") {
				search = stepped.search;
				drawSearch(stepped.search);
				return;
			}
			search = null;
			clearRow();
			rl.prompt(true);
			// Ctrl-E Ctrl-U: to the end of the line, then clear it; then the line found, typed.
			if (stepped.line !== null) keys.write(`\x05\x15${stepped.line}`);
			if (stepped.run) keys.write("\r");
			if (stepped.replay !== null) keys.write(stepped.replay);
		};
		const onKeys = (chunk: Buffer) => {
			let raw = chunk.toString("utf8");
			while (raw !== "") {
				if (search === null) {
					// Up to a Ctrl-R, the chunk goes to readline as it came: a pasted Tab stays a Tab.
					const at = waiting === 0 ? raw.indexOf("\x12") : -1;
					if (at === -1) {
						keys.write(raw);
						return;
					}
					if (at > 0) keys.write(raw.slice(0, at));
					search = begin;
					drawSearch(search);
					raw = raw.slice(at + 1);
					continue;
				}
				const [key = ""] = keysIn(raw);
				raw = raw.slice(key.length);
				searchKey(search, key);
			}
		};
		process.stdin.setRawMode(true);
		process.stdin.on("data", onKeys);
		process.stdin.resume();

		rl.on("line", (line) => {
			waiting += 1;
			started.run.tell("line", line);
		});
		rl.on("SIGINT", () => {
			if (waiting > 0) {
				process.stdout.write("^C\n");
				started.run.tell("signal", "interrupt");
				return;
			}
			// Nothing runs: leave what is typed on its row, and start a fresh, empty one, as a shell does.
			process.stdout.write("^C\n");
			rl.write(null, {ctrl: true, name: "e"});
			rl.write(null, {ctrl: true, name: "u"});
		});
		// tsh has no stop-and-continue of itself: Ctrl-Z does nothing.
		rl.on("SIGTSTP", () => {});
		rl.on("close", () => started.close("line"));

		const last = yield* Ref.make(0);
		const drawer = yield* Stream.fromQueue(said).pipe(
			Stream.runForEach((s) =>
				Effect.gen(function* () {
					if (s.kind === "ready") {
						yield* Ref.set(last, s.ready.status);
						waiting = Math.max(0, waiting - 1);
						if (waiting === 0) rl.prompt();
						return;
					}
					if (waiting > 0) {
						write(s.printed.to, s.printed.text);
						return;
					}
					// The prompt is up: draw the line above it, then the prompt and what is typed again.
					clearRow();
					write(s.printed.to, s.printed.text);
					if (search === null) rl.prompt(true);
					else drawSearch(search);
				}),
			),
			Effect.forkScoped,
		);

		rl.prompt();
		yield* started.run.ended;
		process.stdin.off("data", onKeys);
		process.stdin.setRawMode(false);
		process.stdin.pause();
		rl.close();
		Queue.endUnsafe(said);
		yield* Fiber.join(drawer);
		return yield* Ref.get(last);
	});

const main = Effect.gen(function* () {
	const {show, rest} = showOf(process.argv.slice(2));
	const source = sourceOf(rest, process.stdin.isTTY === true);
	if (source.kind === "usage") {
		write("err", `tsh: ${source.why}\n${USAGE}`);
		return 2;
	}
	const home = homeOf(process.env, homedir());
	yield* Effect.try(() => mkdirSync(home, {recursive: true})).pipe(Effect.orDie);
	const lock = yield* takeLock(home);
	if (lock.kind === "held") {
		write(
			"err",
			`tsh: another tsh (process ${lock.holder}) is using ${home}. One tsh per home: its job table is one.`,
		);
		return 2;
	}
	yield* Effect.addFinalizer(() =>
		Effect.try(() => rmSync(lock.file, {force: true})).pipe(Effect.ignore),
	);
	const list = programsOf(process.env);
	const said = yield* Queue.unbounded<Said, Cause.Done>();
	const started = yield* startTsh(list, home, show, said);
	if (started.kind !== "running") return 2;
	return source.kind === "terminal"
		? yield* terminal(started, said, list, home)
		: yield* batch(started, said, source);
}).pipe(Effect.scoped);

process.exitCode = await Effect.runPromise(main);
