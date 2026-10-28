// The live Sorter of experiment 163: one case under one brief, on opus through the Claude Agent SDK
// or on GPT sol through this repo's Codex adapter, the way experiment 162 ran them. The brief is
// opus's system prompt, and goes before the case on GPT sol (162 did the same with its SYSTEM).
//
//   opus  the Agent SDK's own login, no tools, no skills, no settings, the answer read by its schema
//   sol   `codexTurn` from lib/triage-codex.ts: gpt-6.1-sol, effort medium, on the ChatGPT plan, a
//         fresh Codex home each turn, removed after
//
// Node at the edge, said out loud: `node:fs` and `node:os` for the empty work folder, as 162 does.
import {mkdtempSync, realpathSync, rmSync} from "node:fs";
import {homedir, tmpdir} from "node:os";
import {join} from "node:path";
import {query} from "@anthropic-ai/claude-agent-sdk";
import {jsonSchema, reader} from "@kampus/fabrika/agents/claude";
import {agentEnv} from "@kampus/fabrika/agents/sandbox";
import {Effect, Layer, Option} from "effect";
import {type Answer, answerOf, type Brief, type Case, type Said, Sorter} from "./brief-eval.ts";
import {type Earlier, fenced, type Ticket} from "./sort.ts";
import {codexTurn} from "./triage-codex.ts";

/** What the live Sorter reads a case from: each ticket as filed, and the repo's issue list. */
export interface World {
	readonly tickets: readonly Ticket[];
	readonly all: readonly Earlier[];
	/** What the repo is, in a few lines, per repo. */
	readonly notes: Readonly<Record<string, string>>;
}

/** As 92b and 162: the 200 tickets filed just before, by number. */
const WINDOW = 200;

/** The case as the model reads it: the repo, the ticket as filed, the earlier titles. Pure. */
export function casePrompt(world: World, c: Case): string {
	const t = world.tickets.find((x) => x.n === c.n);
	if (t === undefined) throw new Error(`${c.id} is not in the cache: run STEP=fetch`);
	const earlier = world.all
		.filter((e) => e.n < t.n)
		.toSorted((a, b) => b.n - a.n)
		.slice(0, WINDOW)
		.toReversed();
	return [
		world.notes[c.repo] ?? "",
		"",
		`# The ticket: #${t.n}, filed ${t.createdAt.slice(0, 10)}`,
		"",
		fenced(`# ${t.title}\n\n${t.body}`),
		"",
		`# The ${earlier.length} tickets filed just before it, oldest first`,
		"",
		earlier.length === 0 ? "None." : earlier.map((e) => `#${e.n} ${e.title}`).join("\n"),
	].join("\n");
}

async function opusOnce(brief: Brief, prompt: string, cwd: string): Promise<Said> {
	const schema = answerOf(brief);
	const read = reader(schema);
	const started = Date.now();
	let seen = "";
	for await (const message of query({
		prompt,
		options: {
			model: "opus",
			systemPrompt: brief.text,
			tools: [],
			skills: [],
			mcpServers: {},
			strictMcpConfig: true,
			maxTurns: 3,
			settingSources: [],
			persistSession: false,
			cwd,
			env: agentEnv(),
			outputFormat: {type: "json_schema", schema: jsonSchema(schema)},
		},
	})) {
		if (message.type === "system" && message.subtype === "init") seen = message.model;
		if (message.type === "result") {
			const u = message.usage;
			const answer =
				message.subtype === "success" ? read(message.structured_output) : Option.none();
			return {
				answer: Option.getOrNull(answer) as Answer | null,
				modelId: seen,
				usd: message.total_cost_usd,
				ms: Date.now() - started,
				tokens: {
					input:
						u.input_tokens +
						(u.cache_creation_input_tokens ?? 0) +
						(u.cache_read_input_tokens ?? 0),
					cached: u.cache_read_input_tokens ?? 0,
					output: u.output_tokens,
				},
				error: Option.isSome(answer) ? null : `${message.subtype}: no answer that fits`,
			};
		}
	}
	return {
		answer: null,
		modelId: seen,
		usd: null,
		ms: Date.now() - started,
		tokens: {input: 0, cached: 0, output: 0},
		error: "no result",
	};
}

async function solOnce(brief: Brief, prompt: string, folder: string): Promise<Said> {
	const r = await codexTurn(`${brief.text}\n\n${prompt}`, answerOf(brief), {
		name: "exp-163",
		folder,
		effort: "medium",
	});
	return {
		answer: r.answer as Answer | null,
		modelId: r.model,
		usd: null,
		ms: r.ms,
		tokens: r.tokens,
		error: r.tools > 0 ? `${r.error ?? ""} ran ${r.tools} tools`.trim() : r.error,
	};
}

/**
 * The live Sorter, with one empty work folder for its whole life, removed when the layer closes.
 * Refuses a key in the environment: opus runs on the SDK's own login, GPT sol on the ChatGPT plan.
 */
export const liveSorter = (world: World): Layer.Layer<Sorter> =>
	Layer.effect(
		Sorter,
		Effect.gen(function* () {
			for (const key of ["TYPESAFE_API_KEY", "OPENAI_API_KEY", "CODEX_API_KEY"])
				if (process.env[key] !== undefined) return yield* Effect.die(`${key} is set: unset it`);
			const folder = yield* Effect.acquireRelease(
				Effect.sync(() => realpathSync(mkdtempSync(join(tmpdir(), "exp-163-")))),
				(f) => Effect.sync(() => rmSync(f, {recursive: true, force: true})),
			);
			// A call that throws is an answer with an error, so one bad call does not stop the job.
			const failed = (cause: unknown): Said => ({
				answer: null,
				modelId: "",
				usd: null,
				ms: 0,
				tokens: {input: 0, cached: 0, output: 0},
				error: String(cause).replaceAll(homedir(), "~").slice(0, 400),
			});
			return Sorter.of({
				sort: (brief, model, c) =>
					Effect.tryPromise({
						try: () =>
							model === "opus"
								? opusOnce(brief, casePrompt(world, c), folder)
								: solOnce(brief, casePrompt(world, c), folder),
						catch: failed,
					}).pipe(Effect.catch((said) => Effect.succeed(said))),
			});
		}),
	);
