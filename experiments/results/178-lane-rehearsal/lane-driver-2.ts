// Rehearsal driver: one real lane, headless, no window. Today's version.
// Args: <temp root> <repo worktree>. The person is played by this script.
import cp from "node:child_process";
import {appendFileSync, existsSync, readFileSync} from "node:fs";
import {syncBuiltinESMExports} from "node:module";
import {join} from "node:path";
import {pathToFileURL} from "node:url";

const T = process.argv[2] as string;
const REPO = process.argv[3] as string;
const LOGS = join(T, "logs");
const now = () => new Date().toISOString();
const log = (file: string, row: unknown) =>
	appendFileSync(join(LOGS, file), `${JSON.stringify({at: now(), ...(row as object)})}\n`);

// ---- a passive tee of every child: nothing changes for the lane. `push` is what the socket calls
// with bytes, so reading here starts no flow and steals nothing from the lane's own reader.
const realSpawn = cp.spawn;
let spawned = 0;
const tee = (stream: any, file: string) => {
	if (stream == null) return;
	const push = stream.push.bind(stream);
	let rest = "";
	stream.push = (chunk: any, ...more: any[]) => {
		if (chunk !== null && chunk !== undefined) {
			rest += chunk.toString();
			const lines = rest.split("\n");
			rest = lines.pop() ?? "";
			for (const line of lines) if (line !== "") log(file, {line});
		} else if (rest !== "") {
			log(file, {line: rest});
			rest = "";
		}
		return push(chunk, ...more);
	};
};
(cp as any).spawn = (command: string, args: any, options: any) => {
	const child: any = (realSpawn as any)(command, args, options);
	const n = ++spawned;
	const list: readonly string[] = Array.isArray(args) ? args : [];
	const base = String(command).split("/").at(-1) ?? "";
	const isCodex = base === "codex";
	const isClaude = base === "claude" || list.includes("stream-json");
	const agent = isCodex ? "codex" : isClaude ? "claude" : null;
	const row: any = {
		n,
		command,
		args: agent === "codex" ? list : list.map((a) => String(a).slice(0, 300)),
		cwd: options?.cwd,
		envNames: Object.keys(options?.env ?? {}),
		agent,
		pid: child.pid,
	};
	log("spawns.jsonl", row);
	if (agent !== null) {
		const name = `agent-${String(n).padStart(4, "0")}-${agent}`;
		tee(child.stdout, `${name}.stdout.jsonl`);
		tee(child.stderr, `${name}.stderr.jsonl`);
		// Which schema it was given: only that file, never anything else in its home.
		const at = list.indexOf("--output-schema");
		if (at >= 0)
			log(`${name}.schema.jsonl`, {
				schema: JSON.parse(readFileSync(list[at + 1] as string, "utf8")),
			});
	}
	child.on("exit", (code: number | null, signal: string | null) =>
		log("exits.jsonl", {n, code, signal, agent}),
	);
	return child;
};
syncBuiltinESMExports();

// ---- the lane's own code, from the worktree, at its head.
const p = (path: string) => pathToFileURL(join(REPO, "packages/pipeline/src", path)).href;
const {Ledger, streams} = await import(
	pathToFileURL(join(REPO, "packages/fabrika/src/index.ts")).href
);
const {Effect, Duration, Layer, Option, Fiber} = await import("effect");
const {memoryLedger} = await import(p("asks/ledger.ts"));
const {hashOf, textOf} = await import(p("tickets/approval.ts"));
const {nameOf} = await import(p("tickets/ticket.ts"));
const {ticketsOnLedger} = await import(p("tickets/tickets.ts"));
const {Tickets} = await import(p("tickets/tickets.ts"));
const {laneLayer, runLane} = await import(p("stages/pipeline/layer.ts"));

const OWNER = "user:owner";
const NUMBER = 1;
const BRIEFS = join(REPO, "programs/pipeline/briefs");
const HOME = join(T, "home");

const TITLE = readFileSync(join(T, "ticket.title"), "utf8").trim();
const BODY = readFileSync(join(T, "ticket.body"), "utf8").trim();

const file = Effect.gen(function* () {
	const ledger = yield* Ledger;
	yield* ledger.register(nameOf(NUMBER), OWNER);
	yield* ledger.send(streams(nameOf(NUMBER)).inbox, `file-${NUMBER}`, {
		kind: "filed",
		writer: OWNER,
		data: {type: "filed", title: TITLE, body: BODY},
	});
});

const read = Effect.gen(function* () {
	return yield* (yield* Tickets).read(NUMBER);
}).pipe(Effect.provide(ticketsOnLedger({kind: "agent", id: "reader", for: "owner"})));

// Every ask waits for a file `answers/<ask>`: the agent playing the person reads each one first.
const EXPECTED = new Set<string>();

const watching = Effect.gen(function* () {
	const ledger = yield* Ledger;
	const seen = new Set<number>();
	const done = new Set<string>();
	for (;;) {
		const ticket = yield* read;
		for (const entry of ticket.timeline) {
			if (!seen.has(entry.pos)) {
				seen.add(entry.pos);
				log("facts.jsonl", {pos: entry.pos, by: entry.by, fact: entry.fact});
			}
			const fact = entry.fact;
			if (fact.type !== "asked" || done.has(fact.ask)) continue;
			const kind = fact.ask.split("-")[1] ?? "";
			let pick: string | null = null;
			let how = "script";
			if (EXPECTED.has(kind)) pick = fact.picks[0];
			else {
				const answer = join(T, "answers", fact.ask);
				if (!existsSync(answer)) {
					if (!existsSync(`${answer}.waiting`)) {
						appendFileSync(`${answer}.waiting`, JSON.stringify(fact));
						log("asks.jsonl", {ask: fact.ask, unexpected: true, fact});
					}
					continue;
				}
				pick = readFileSync(answer, "utf8").trim();
				how = "the agent playing the person, by hand";
			}
			done.add(fact.ask);
			log("asks.jsonl", {ask: fact.ask, fact, pick, how});
			yield* ledger.send(streams(nameOf(NUMBER)).inbox, `answer-${fact.ask}`, {
				kind: "answered",
				writer: OWNER,
				data: {
					type: "answered",
					ask: fact.ask,
					pick,
					note: "",
					text: yield* hashOf(textOf(ticket)),
				},
			});
		}
		yield* Effect.sleep("500 millis");
	}
});

const say = (line: string) =>
	Effect.sync(() => {
		log("lines.jsonl", {line});
		console.log(`${now()} ${line}`);
	});

const MINUTES = Number(process.env.LANE_MINUTES ?? 75);
const main = Effect.gen(function* () {
	yield* file;
	yield* Effect.forkScoped(watching);
	const ended = yield* runLane(NUMBER, say).pipe(
		Effect.provide(laneLayer({home: HOME, briefs: BRIEFS, person: "owner"})),
		Effect.timeoutOption(Duration.minutes(MINUTES)),
	);
	if (Option.isNone(ended)) yield* say("-- timed out, the driver stopped it --");
	const ticket = yield* read;
	for (const entry of ticket.timeline) log("final-timeline.jsonl", entry);
	log("final-state.jsonl", {state: ticket.state, title: ticket.title});
}).pipe(Effect.scoped, Effect.provide(Layer.fresh(memoryLedger().layer)));

const fiber = Effect.runFork(main);
const stop = () => {
	console.log(`${now()} -- signal: stopping --`);
	Effect.runFork(Fiber.interrupt(fiber));
};
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
const exit = await Effect.runPromiseExit(Fiber.await(fiber));
console.log(`${now()} driver exit: ${exit._tag}`);
if (exit._tag === "Failure") console.log(String(exit.cause));
process.exit(exit._tag === "Success" ? 0 : 1);
