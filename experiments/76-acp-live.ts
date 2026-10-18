// Experiment 76, live: the acp program (src/agents/acp/program.ts) run in
// this process on a harness, with only `--agent` changed between runs.
//
//   node experiments/76-acp-live.ts swap <agent> <folder> [model] [effort]
//   node experiments/76-acp-live.ts long <agent> <folder> <turns> [model] [effort]
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
// <folder>: a scratch folder outside any repository, with a.txt and b.txt in
// it. The agent `claude` is a paid run on the signed-in Claude account (pick
// a cheap model); `fake` has no model. TSH_TRACE=1: the spans go to Jaeger.
// Results go to results/76-acp-<step>-<agent>.json: shapes, times and counts,
// never a word the agent said, never a path.
import {writeFileSync} from "node:fs";
import {layer as nodeServices} from "@effect/platform-node/NodeServices";
import {Effect, Layer} from "effect";
import {acpProgram} from "../src/agents/acp/program.ts";
import {statusLine, type Transcript, turnShapes} from "../src/agents/acp/transcript.ts";
import {ear} from "../src/program/ear.ts";
import {type Given, start, tell} from "../src/program/program.ts";
import {memoryStorage, type Storage} from "../src/program/storage.ts";
import {endpointOf, tracing} from "../src/trace/otel.ts";

type Flags = Given<(typeof acpProgram)["flags"]>;
type Opened = {readonly how: string; readonly ms: number; readonly replayed: number};
type Result = {
	readonly turn: number;
	readonly stop: string;
	readonly ms: number;
	readonly cost: number | null;
};

const [step, agentArg, folder = "", ...rest] = process.argv.slice(2);
const agent = agentArg === "claude" || agentArg === "fake" ? agentArg : null;
if ((step !== "swap" && step !== "long") || agent === null || folder === "") {
	console.error(
		"usage: node experiments/76-acp-live.ts swap|long claude|fake <folder> [turns] [model] [effort]",
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

const main = Effect.gen(function* () {
	const storage = memoryStorage();
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
