// Does Jev pick what Opus picked? The cases in `51-cases.json` are narrow
// next-step choices from real operator runs: a small text, a question, fixed
// choices, and what the driver really did. Each case is asked of Jev through
// the real Judge (`createJudge`, floor 0.8) and of Opus through `claude -p`
// with no tools, with the same instructions, texts and choices.
//
// Run with `node experiments/51-jev-vs-opus.ts`. Jev needs TYPESAFE_API_KEY,
// Opus needs the `claude` CLI.
//   SIDE=jev|opus|both|none  which side to ask (default both). The other
//                            side's saved answers are kept; `none` only
//                            prints the tables from the saved file
//   ONLY=<id>,<id>           ask only these cases
//   REPEATS=<n>              times each side answers a case (default 3)
import {execFile} from "node:child_process";
import {mkdtemp, readFile, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {DEFAULT_JEV_MODEL, JEV_ENDPOINT} from "@demlik/tea/jev";
import {Effect, Layer} from "effect";
import {createJudge} from "../src/primitives.ts";
import {Jev} from "../src/services.ts";

const FLOOR = 0.8;
/** Jev's published price per input token (output is free). */
const JEV_DOLLARS_PER_TOKEN = 0.042 / 1_000_000;
/** The whole run stops asking Opus past this. */
const MAX_OPUS_DOLLARS = 8;
const REPEATS = Number(process.env.REPEATS ?? 3);
const side = process.env.SIDE ?? "both";
const only = process.env.ONLY?.split(",") ?? null;
const here = import.meta.dirname;
const resultsFile = join(here, "results", "jev-vs-opus.json");

interface Question {
	readonly title: string;
	readonly instructions: string;
	readonly choices: Readonly<Record<string, string>>;
	/** How careful each choice is. A wrong answer that is less careful than the right one is the harmful kind. */
	readonly caution: Readonly<Record<string, number>>;
	/** The choice that hands the matter to a person, if the question has one. */
	readonly person: string | null;
}
interface Case {
	readonly id: string;
	readonly type: string;
	readonly origin: "real" | "written";
	readonly driver: "operator" | "machine" | "shell" | "written";
	readonly lane: string;
	readonly source: string;
	readonly texts: Readonly<Record<string, string>>;
	readonly did: string;
	readonly chars: number;
	readonly note?: string;
}
interface JevAnswer {
	readonly choice: string;
	readonly confidence: number;
	readonly ms: number;
	/** What Jev says it billed for the call, or `null` when the reply did not say. */
	readonly inputTokens: number | null;
	readonly tries: number;
}
interface OpusAnswer {
	/** `null` when the reply was not one of the choices. */
	readonly choice: string | null;
	readonly confidence: number | null;
	/** Start of the `claude` process to its exit. */
	readonly ms: number;
	/** The time the CLI says the API call took. */
	readonly apiMs: number | null;
	readonly costUsd: number | null;
	readonly inputTokens: number | null;
	readonly outputTokens: number | null;
	readonly model: string | null;
}
interface Row {
	readonly id: string;
	readonly jev: readonly JevAnswer[];
	readonly opus: readonly OpusAnswer[];
}

const {questions, cases: allCases} = JSON.parse(
	await readFile(join(here, "51-cases.json"), "utf8"),
) as {
	questions: Record<string, Question>;
	cases: Case[];
};
const cases = only === null ? allCases : allCases.filter((c) => only.includes(c.id));
const questionOf = (c: Case): Question => {
	const q = questions[c.type];
	if (q === undefined) throw new Error(`no question for ${c.type}`);
	return q;
};

async function pool<T, R>(
	items: readonly T[],
	limit: number,
	work: (item: T) => Promise<R>,
): Promise<R[]> {
	const results: R[] = [];
	let next = 0;
	await Promise.all(
		Array.from({length: limit}, async () => {
			while (next < items.length) {
				const index = next++;
				results[index] = await work(items[index] as T);
			}
		}),
	);
	return results;
}
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// ---------------------------------------------------------------- Jev

const judges = Object.fromEntries(
	Object.entries(questions).map(([type, q]) => [
		type,
		createJudge({name: `exp51_${type}`, instructions: q.instructions, choices: q.choices}),
	]),
);

/** One Judge call over HTTP, timed, with the tokens Jev says it billed. */
async function askJev(key: string, c: Case): Promise<JevAnswer> {
	const judge = judges[c.type];
	if (judge === undefined) throw new Error(`no judge for ${c.type}`);
	for (let tries = 1; ; tries++) {
		let inputTokens: number | null = null;
		const jev = Layer.succeed(Jev, {
			call: (request) =>
				Effect.tryPromise({
					try: async () => {
						const response = await fetch(JEV_ENDPOINT, {
							method: "POST",
							headers: {authorization: `Bearer ${key}`, "content-type": "application/json"},
							body: JSON.stringify(request),
						});
						const body = (await response.json().catch(() => ({}))) as {
							usage?: {input_tokens?: number};
						};
						inputTokens = body.usage?.input_tokens ?? null;
						return {status: response.status, body};
					},
					catch: (cause) => ({_tag: "jev_call_failed" as const, cause}),
				}),
		});
		const started = performance.now();
		const answer = await Effect.runPromise(
			judge
				.handle(DEFAULT_JEV_MODEL)(judge.ask({key: c.id, texts: c.texts}))
				.pipe(
					Effect.provide(jev),
					Effect.match({onSuccess: (judged) => judged, onFailure: () => null}),
				),
		);
		const ms = Math.round(performance.now() - started);
		if (answer !== null)
			return {choice: answer.choice, confidence: answer.confidence, ms, inputTokens, tries};
		if (tries >= 5) throw new Error(`Jev did not answer ${c.id}`);
		await sleep(1000 * 2 ** tries);
	}
}

// ---------------------------------------------------------------- Opus

const OPUS_SYSTEM =
	"You answer one multiple-choice question about a software pipeline. Reply with one JSON object and nothing else.";

/** The same instructions, texts and choices Jev gets, as one prompt. */
function opusPrompt(c: Case): string {
	const q = questionOf(c);
	const keys = Object.keys(q.choices)
		.map((k) => `"${k}"`)
		.join(", ");
	return [
		q.instructions,
		"",
		...Object.entries(c.texts).map(([name, text]) => `\`${name}\`:\n<<<\n${text}\n>>>\n`),
		"Choices:",
		...Object.entries(q.choices).map(([k, what]) => `- ${k}: ${what}`),
		"",
		`Reply with JSON only: {"choice": one of ${keys}, "confidence": a number from 0 to 1}.`,
	].join("\n");
}

let opusSpent = 0;

/** One `claude -p` turn on Opus with every tool taken away, in an empty folder, with no settings of the machine's own. */
async function askOpus(dir: string, c: Case): Promise<OpusAnswer> {
	if (opusSpent > MAX_OPUS_DOLLARS) throw new Error(`stopped at $${MAX_OPUS_DOLLARS} of Opus`);
	const {TYPESAFE_API_KEY: _key, ...env} = process.env;
	const started = performance.now();
	const printed = await new Promise<string>((resolve, reject) => {
		execFile(
			"claude",
			[
				"-p",
				opusPrompt(c),
				"--model",
				"opus",
				// `--tools ""` takes the tools away; `--allowedTools` would only pre-approve them.
				"--tools",
				"",
				"--system-prompt",
				OPUS_SYSTEM,
				"--setting-sources",
				"",
				"--strict-mcp-config",
				"--disable-slash-commands",
				"--no-session-persistence",
				"--output-format",
				"json",
			],
			{cwd: dir, env, maxBuffer: 16 * 1024 * 1024, timeout: 120_000},
			(error, stdout) => (error === null ? resolve(stdout) : reject(error)),
		);
	});
	const ms = Math.round(performance.now() - started);
	const parsed = JSON.parse(printed) as unknown;
	const events = (Array.isArray(parsed) ? parsed : [parsed]) as Record<string, unknown>[];
	const result = events.findLast((e) => e.type === "result") ?? {};
	const usage = (result.usage ?? {}) as Record<string, number>;
	const costUsd = typeof result.total_cost_usd === "number" ? result.total_cost_usd : null;
	opusSpent += costUsd ?? 0;
	const reply = replyOf(String(result.result ?? ""), Object.keys(questionOf(c).choices));
	return {
		...reply,
		ms,
		apiMs: typeof result.duration_api_ms === "number" ? result.duration_api_ms : null,
		costUsd,
		inputTokens:
			(usage.input_tokens ?? 0) +
			(usage.cache_read_input_tokens ?? 0) +
			(usage.cache_creation_input_tokens ?? 0),
		outputTokens: usage.output_tokens ?? null,
		model: Object.keys((result.modelUsage ?? {}) as object)[0] ?? null,
	};
}

/** The choice and confidence in a reply, or `null`s when it is not one of the choices. */
function replyOf(text: string, keys: readonly string[]): Pick<OpusAnswer, "choice" | "confidence"> {
	const json = text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
	// biome-ignore lint/plugin: a plain function with no Effect in it; a reply that is not JSON reads as no answer
	try {
		const {choice, confidence} = JSON.parse(json) as {choice?: unknown; confidence?: unknown};
		return {
			choice: typeof choice === "string" && keys.includes(choice) ? choice : null,
			confidence: typeof confidence === "number" ? confidence : null,
		};
	} catch {
		return {choice: null, confidence: null};
	}
}

// ---------------------------------------------------------------- asking

const saved = await readFile(resultsFile, "utf8").then(
	(text) => (JSON.parse(text) as {rows: Row[]}).rows,
	() => [] as Row[],
);
const rowOf = new Map(saved.map((r) => [r.id, r]));
const repeated = (c: Case): Case[] => Array.from({length: REPEATS}, () => c);

if (side === "jev" || side === "both") {
	const key = process.env.TYPESAFE_API_KEY;
	if (!key) throw new Error("set TYPESAFE_API_KEY");
	const answers = await pool(cases.flatMap(repeated), 6, (c) => askJev(key, c));
	cases.forEach((c, i) => {
		rowOf.set(c.id, {
			id: c.id,
			jev: answers.slice(i * REPEATS, (i + 1) * REPEATS),
			opus: rowOf.get(c.id)?.opus ?? [],
		});
	});
}
if (side === "opus" || side === "both") {
	const dir = await mkdtemp(join(tmpdir(), "exp51-"));
	const answers = await pool(cases.flatMap(repeated), 4, (c) => askOpus(dir, c)).finally(() =>
		rm(dir, {recursive: true, force: true}),
	);
	cases.forEach((c, i) => {
		rowOf.set(c.id, {
			id: c.id,
			jev: rowOf.get(c.id)?.jev ?? [],
			opus: answers.slice(i * REPEATS, (i + 1) * REPEATS),
		});
	});
}
const rows = allCases.flatMap((c) => rowOf.get(c.id) ?? []);
if (side !== "none") {
	await writeFile(
		resultsFile,
		`${JSON.stringify({floor: FLOOR, jevModel: DEFAULT_JEV_MODEL, rows}, null, 2)}\n`,
	);
}

// ---------------------------------------------------------------- scoring

const median = (xs: readonly number[]) =>
	[...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? Number.NaN;
const sum = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0);

/** The choice most of the answers gave, or `null` when no choice has more than half. */
function majority(choices: readonly (string | null)[]): string | null {
	const counts = new Map<string, number>();
	for (const choice of choices)
		if (choice !== null) counts.set(choice, (counts.get(choice) ?? 0) + 1);
	const [top] = [...counts].sort((a, b) => b[1] - a[1]);
	return top !== undefined && top[1] * 2 > choices.length ? top[0] : null;
}

/**
 * Which way a wrong answer leans, against the answer it should have matched.
 * `skips_person`: the right answer hands it to a person and this one does not.
 * `moves_on`: this answer is less careful (skips a repair, a wait or a note).
 * `asks_person` and `extra_care` are the harmless side. `other` is a sideways miss.
 */
function direction(q: Question, right: string, said: string | null): string {
	if (said === null) return "no_answer";
	if (said === right) return "same";
	const [r, s] = [q.caution[right] ?? 0, q.caution[said] ?? 0];
	if (s < r) return right === q.person ? "skips_person" : "moves_on";
	if (s > r) return said === q.person ? "asks_person" : "extra_care";
	return "other";
}

interface Scored {
	readonly c: Case;
	readonly q: Question;
	readonly jev: string | null;
	readonly confidence: number;
	readonly sure: boolean;
	readonly stable: boolean;
	readonly opus: string | null;
	readonly opusStable: boolean;
}
const scored: Scored[] = allCases.flatMap((c) => {
	const row = rowOf.get(c.id);
	if (row === undefined || row.jev.length === 0) return [];
	const confidence = median(row.jev.map((a) => a.confidence));
	return [
		{
			c,
			q: questionOf(c),
			jev: majority(row.jev.map((a) => a.choice)),
			confidence,
			sure: confidence >= FLOOR,
			stable: new Set(row.jev.map((a) => a.choice)).size === 1,
			opus: majority(row.opus.map((a) => a.choice)),
			opusStable: new Set(row.opus.map((a) => a.choice)).size === 1,
		},
	];
});

const of = (n: number, d: number) => `${n} of ${d}`;
function agreement(
	label: string,
	set: readonly Scored[],
	right: (s: Scored) => string | null,
	said: (s: Scored) => string | null,
) {
	const asked = set.filter((s) => right(s) !== null);
	const same = asked.filter((s) => said(s) === right(s));
	console.log(`  ${label.padEnd(34)} ${of(same.length, asked.length)}`);
}
function table(title: string, set: readonly Scored[], right: (s: Scored) => string | null) {
	console.log(`\n${title} (${set.length} cases)`);
	agreement("Jev agrees", set, right, (s) => s.jev);
	const sure = set.filter((s) => s.sure);
	agreement(`Jev at ${FLOOR} and up agrees`, sure, right, (s) => s.jev);
	agreement(
		`Jev under ${FLOOR} agrees`,
		set.filter((s) => !s.sure),
		right,
		(s) => s.jev,
	);
	for (const type of Object.keys(questions)) {
		const mine = set.filter((s) => s.c.type === type);
		if (mine.length > 0)
			agreement(`  ${type} (${mine.filter((s) => s.sure).length} sure)`, mine, right, (s) => s.jev);
	}
	const misses = set.filter((s) => right(s) !== null && s.jev !== right(s));
	const ways = new Map<string, number>();
	for (const s of misses) {
		const way = `${direction(s.q, right(s) as string, s.jev)}${s.sure ? " (sure)" : ""}`;
		ways.set(way, (ways.get(way) ?? 0) + 1);
	}
	console.log(
		`  misses by direction: ${[...ways].map(([way, n]) => `${way} ${n}`).join(", ") || "none"}`,
	);
	for (const s of misses) {
		console.log(
			`    ${s.c.id.padEnd(16)} should be ${String(right(s)).padEnd(9)} Jev ${String(s.jev).padEnd(9)} ${s.confidence.toFixed(2)}  ${direction(s.q, right(s) as string, s.jev)}`,
		);
	}
}

const real = scored.filter((s) => s.c.origin === "real");
const written = scored.filter((s) => s.c.origin === "written");
const byOperator = real.filter((s) => s.c.driver === "operator");
const byOthers = real.filter((s) => s.c.driver !== "operator");

console.log(
	`cases: ${scored.length} (${real.length} real, ${written.length} written); ${REPEATS} answers a side`,
);
console.log(
	`Jev gave one choice all ${REPEATS} times: ${of(scored.filter((s) => s.stable).length, scored.length)}`,
);
console.log(
	`Opus gave one choice all ${REPEATS} times: ${of(scored.filter((s) => s.opusStable).length, scored.length)}`,
);
console.log(`Jev at ${FLOOR} and up: ${of(scored.filter((s) => s.sure).length, scored.length)}`);

table("1. Jev against what the operator agent did", byOperator, (s) => s.c.did);
table("1b. Jev against what the machine or a shell did", byOthers, (s) => s.c.did);
table("2. Jev against Opus on the same small text, real cases", real, (s) => s.opus);
table("2b. Jev against Opus on the same small text, written cases", written, (s) => s.opus);

console.log("\n3. Opus on the small text against what the operator agent did");
agreement(
	"Opus agrees",
	byOperator,
	(s) => s.c.did,
	(s) => s.opus,
);
for (const s of byOperator.filter((x) => x.opus !== x.c.did)) {
	console.log(
		`    ${s.c.id.padEnd(16)} did ${s.c.did.padEnd(9)} Opus ${String(s.opus).padEnd(9)} ${direction(s.q, s.c.did, s.opus)}`,
	);
}
console.log("\n4. Written cases against the answer their writer meant");
agreement(
	"Jev agrees",
	written,
	(s) => s.c.did,
	(s) => s.jev,
);
agreement(
	"Opus agrees",
	written,
	(s) => s.c.did,
	(s) => s.opus,
);

const jevAnswers = rows.flatMap((r) => r.jev);
const opusAnswers = rows.flatMap((r) => r.opus);
const jevTokens = sum(jevAnswers.map((a) => a.inputTokens ?? 0));
console.log("\n5. Cost and time for one answer");
console.log(
	`  Jev:  ${jevAnswers.length} answers, median ${median(jevAnswers.map((a) => a.ms))} ms, ${Math.round(jevTokens / Math.max(1, jevAnswers.length))} billed tokens each, $${((jevTokens * JEV_DOLLARS_PER_TOKEN) / Math.max(1, jevAnswers.length)).toFixed(7)} each, $${(jevTokens * JEV_DOLLARS_PER_TOKEN).toFixed(4)} in all`,
);
console.log(
	`  Opus: ${opusAnswers.length} answers, median ${median(opusAnswers.map((a) => a.ms))} ms from start to exit (${median(opusAnswers.flatMap((a) => a.apiMs ?? []))} ms in the API), $${(sum(opusAnswers.map((a) => a.costUsd ?? 0)) / Math.max(1, opusAnswers.length)).toFixed(5)} each, $${sum(opusAnswers.map((a) => a.costUsd ?? 0)).toFixed(2)} in all`,
);
console.log(
	`  text sent: median ${median(allCases.map((c) => c.chars))} characters a case, largest ${Math.max(...allCases.map((c) => c.chars))}`,
);
