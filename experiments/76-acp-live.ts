// Experiment 76, live: the acp program (src/agents/acp/program.ts) run in
// this process on a harness, with only `--agent` changed between runs.
//
//   node experiments/76-acp-live.ts swap <agent> <folder> [model] [effort]
//   node experiments/76-acp-live.ts long <agent> <folder> <turns> [model] [effort]
//   node experiments/76-acp-live.ts ask <agent> <folder> [model] [effort]
//
// swap: the three-turn task (read two files and answer, then two follow-ups).
// It prints each turn's shape (src/agents/acp/transcript.ts `turnShapes`),
// the status line, and what each turn cost. The shapes of two harnesses are
// compared by hand in the write-up.
//
// long: a session of <turns> short turns, then the same session opened again
// three times with `session/load` and three times with `session/resume`, each
// in a fresh start of the program on the same storage. It prints how long
// each open took and how many updates the load replayed.
//
// ask: one prompt that needs a file written, in the harness's `default` mode
// (the one that asks before an edit). First with the default answer, refuse;
// then in a new session with `--permissions ask`, allowing the first ask once
// when it shows. It prints each ask as shown and whether the file was written.
//
// <folder>: a scratch folder outside any repository, with a.txt and b.txt in
// it. The agent `claude` is a paid run on the signed-in Claude account (pick
// a cheap model); `fake` has no model. TSH_TRACE=1: the spans go to Jaeger.
// Results go to results/76-acp-<step>-<agent>.json: shapes, times and counts,
// never a word the agent said, never a path.
import {existsSync, writeFileSync} from "node:fs";
import {layer as nodeServices} from "@effect/platform-node/NodeServices";
import {Effect, Layer} from "effect";
import {ear} from "../packages/tea-program/src/ear.ts";
import {type Given, start, tell} from "../packages/tea-program/src/program.ts";
import {memoryStorage, type Storage} from "../packages/tea-program/src/storage.ts";
import {endpointOf, tracing} from "../packages/tsh/src/trace/otel.ts";
import {acpProgram} from "../wip/src/agents/acp/program.ts";
import {statusLine, type Transcript, turnShapes} from "../wip/src/agents/acp/transcript.ts";

type Flags = Given<(typeof acpProgram)["flags"]>;
type Opened = {readonly how: string; readonly ms: number; readonly replayed: number};
type Result = {
	readonly turn: number;
	readonly stop: string;
	readonly ms: number;
	readonly cost: number | null;
};

type Ask = {
	readonly ask: string;
	readonly tool: string;
	readonly kind: string;
	readonly answer: string;
};

const [step, agentArg, folder = "", ...rest] = process.argv.slice(2);
const agent = agentArg === "claude" || agentArg === "fake" ? agentArg : null;
if ((step !== "swap" && step !== "long" && step !== "ask") || agent === null || folder === "") {
	console.error(
		"usage: node experiments/76-acp-live.ts swap|long|ask claude|fake <folder> [turns] [model] [effort]",
	);
	process.exit(2);
}
const turns = step === "long" ? Number(rest.shift() ?? "30") : 0;
const [model, effort] = rest;

const flags = (reopen: "load" | "resume"): Flags => ({
	agent,
	folder,
	model,
	effort,
	mode: undefined,
	permissions: undefined,
	reopen,
	budget: agent === "claude" ? 2 : undefined,
});

const endpoint = endpointOf(process.env);
const traced = endpoint === null ? Layer.empty : tracing(endpoint);

/** One start of the program: tell it `prompts`, close the input, wait for its end. */
const life = (storage: Storage, reopen: "load" | "resume", prompts: readonly string[]) =>
	Effect.gen(function* () {
		const opened = ear<Opened>();
		const results = ear<Result>();
		const said = ear<string>();
		const started = yield* start(
			acpProgram,
			flags(reopen),
			{opened: opened.hear, result: results.hear, said: said.hear},
			{id: `acp:live-${agent}`, storage},
		);
		if (started.kind !== "running") return yield* Effect.die(started.why);
		for (const prompt of prompts) tell(started.run, "prompt", prompt);
		started.close("prompt");
		const end = yield* started.run.ended;
		if (end.kind !== "ended") return yield* Effect.die(`the run ended ${JSON.stringify(end)}`);
		const transcript = started.run.machines.transcript.state() as Transcript | null;
		return {opened: opened.values, results: results.values, said: said.values, transcript};
	}).pipe(Effect.scoped);

const SWAP = [
	"Read a.txt and b.txt in this folder, then say in one short sentence each what they say.",
	"Which of the two files names a number? Answer in one short sentence.",
	"Say that number as a word, and nothing else.",
];

const WRITE =
	"Use the Write tool to write the file note.txt in this folder, containing only the word hi. Use no other tool.";

/** One session that asks to write a file: refused by default, or the first ask allowed once. */
const asking = (permissions: "refuse" | "ask", run: string) =>
	Effect.gen(function* () {
		const asks = ear<Ask>();
		const results = ear<Result>();
		const started = yield* start(
			acpProgram,
			{...flags("load"), mode: "default", permissions},
			{ask: asks.hear, result: results.hear},
			{id: `acp:${run}`, storage: memoryStorage()},
		);
		if (started.kind !== "running") return yield* Effect.die(started.why);
		tell(started.run, "prompt", WRITE);
		started.close("prompt");
		if (permissions === "ask") {
			// No ask in two minutes: the run goes on to its end, and the write-up says there was none.
			const first = (yield* asks.upTo(1).pipe(
				Effect.timeout("2 minutes"),
				Effect.orElseSucceed(() => []),
			))[0];
			if (first !== undefined) tell(started.run, "allow", first.ask);
		}
		yield* started.run.ended;
		return {asks: asks.values, results: results.values};
	}).pipe(Effect.scoped);

const main = Effect.gen(function* () {
	const storage = memoryStorage();
	if (step === "ask") {
		// The fake agent writes its own file name, whatever the prompt says.
		const note = `${folder}/${agent === "fake" ? "written.txt" : "note.txt"}`;
		const refusedRun = yield* asking("refuse", `ask-refuse-${agent}`);
		const writtenAfterRefuse = existsSync(note);
		const allowedRun = yield* asking("ask", `ask-allow-${agent}`);
		const writtenAfterAllow = existsSync(note);
		const shape = (asks: readonly Ask[]) =>
			asks.map(({ask, tool, kind, answer}) => ({ask, tool, kind, answer}));
		const out = {
			agent,
			model,
			refused: {
				asks: shape(refusedRun.asks),
				stops: refusedRun.results.map((r) => r.stop),
				written: writtenAfterRefuse,
			},
			allowed: {
				asks: shape(allowedRun.asks),
				stops: allowedRun.results.map((r) => r.stop),
				written: writtenAfterAllow,
			},
		};
		console.log(JSON.stringify(out, null, 2));
		writeFileSync(
			new URL(`results/76-acp-ask-${agent}.json`, import.meta.url),
			`${JSON.stringify(out, null, 2)}\n`,
		);
		return;
	}
	if (step === "swap") {
		const one = yield* life(storage, "load", SWAP);
		const shapes = one.transcript === null ? [] : turnShapes(one.transcript);
		console.log("opened", JSON.stringify(one.opened));
		for (const [i, shape] of shapes.entries()) {
			console.log("turn", JSON.stringify(shape), JSON.stringify(one.results[i]));
			console.log("  said", JSON.stringify(one.said[i]?.slice(0, 160)));
		}
		console.log("status", one.transcript === null ? "" : statusLine(one.transcript));
		writeFileSync(
			new URL(`results/76-acp-swap-${agent}.json`, import.meta.url),
			`${JSON.stringify({agent, model, effort, shapes, results: one.results, opened: one.opened.map(({how, ms, replayed}) => ({how, ms, replayed}))}, null, 2)}\n`,
		);
		return;
	}
	const prompts = Array.from({length: turns}, (_, i) => `Reply with only the number ${i + 1}.`);
	const built = yield* life(storage, "load", prompts);
	const spent = built.results.at(-1)?.cost ?? null;
	console.log(
		"built",
		turns,
		"turns; cost",
		spent,
		"; turn ms",
		built.results.map((r) => r.ms).join(" "),
	);
	const opens: {how: string; ms: number; replayed: number}[] = [];
	for (const reopen of ["load", "resume", "load", "resume", "load", "resume"] as const) {
		const again = yield* life(storage, reopen, []);
		const o = again.opened[0];
		if (o !== undefined) opens.push({how: o.how, ms: o.ms, replayed: o.replayed});
		console.log(reopen, JSON.stringify(o), "messages back", again.transcript?.messages.length ?? 0);
	}
	writeFileSync(
		new URL(`results/76-acp-long-${agent}.json`, import.meta.url),
		`${JSON.stringify({agent, model, effort, turns, cost: spent, turnMs: built.results.map((r) => r.ms), opens}, null, 2)}\n`,
	);
});

await Effect.runPromise(main.pipe(Effect.provide(nodeServices), Effect.provide(traced)));
