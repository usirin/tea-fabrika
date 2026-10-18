// Experiment 86: a plan stage for every ticket.
//
// The plan program (wip/src/stages/plan) is run, read-only, on six closed
// demlik tickets from the replay set (replay/issues). Each is planned from the
// report as it was filed, at the commit the fix was built on (the PR's base),
// and its plan is set beside today's triaged criteria and what the PR shipped.
//
// Run with
//   DEMLIK=<a local clone of kamp-us/demlik> node experiments/86-plan-stage.ts
//
//   STEP=plan    plan the tickets (ONLY=<n,n> for some; DRY=1 prints the
//                estimate and stops). Code facts are gathered from a scratch
//                clone at the base commit, made in CACHE; the planner reads a
//                copy of the code at that commit, with no history
//   STEP=judge   ask Claude (sonnet, no tools), blind, whether each criterion
//                is an outcome, a recipe or a mix: today's and ours, shuffled
//                together, with no word of which is which
//   STEP=views   write each plan as markdown to experiments/86-plans/<n>.md,
//                with today's criteria and what the PR shipped beside it
//   (no STEP)    print the tables
//
// It writes nothing to GitHub: the tickets come from the replay set, and the
// planner has Read, Grep and Glob in a copy of the code. CACHE (default
// `runs/exp-86-cache`) holds the clones and is never committed.
// `results/86-plans.json` holds each plan and what it cost;
// `results/86-judge.json` each criterion's label.
//
// Node at the edge, said out loud: `node:fs` for the result files and
// `node:child_process` for `git`, as the other replay scripts do.
import {execFileSync} from "node:child_process";
import {existsSync, mkdirSync, readFileSync, writeFileSync} from "node:fs";
import {join} from "node:path";
import {query} from "@anthropic-ai/claude-agent-sdk";
import {Effect, Layer} from "effect";
import {localFacts} from "../legacy/src/code-facts.ts";
import {Facts as LegacyFacts} from "../legacy/src/factory-services.ts";
import {factsBrief, mentionsOf} from "../legacy/src/facts.ts";
import {start, tell} from "../packages/tea-program/src/program.ts";
import {memoryStorage} from "../packages/tea-program/src/storage.ts";
import type {DraftRun} from "../wip/src/draft.ts";
import {agentEnv} from "../wip/src/env.ts";
import {type Plan, sizeOf, textOf} from "../wip/src/stages/plan/plan.ts";
import {livePlanner} from "../wip/src/stages/plan/planner.ts";
import {type Planned, planProgram} from "../wip/src/stages/plan/program.ts";
import {planMarkdown} from "../wip/src/stages/plan/render.ts";
import {
	PlanFacts,
	PlanHost,
	Planner,
	type PlanTicket,
	type Settings,
} from "../wip/src/stages/plan/services.ts";

const here = import.meta.dirname;
const DEMLIK = process.env.DEMLIK;
const CACHE = process.env.CACHE ?? join(here, "..", "runs", "exp-86-cache");
const STEP = process.env.STEP ?? "tables";
const PLANS = join(here, "results", "86-plans.json");
const JUDGE = join(here, "results", "86-judge.json");

/** The six, and why each was picked. */
const PICKED = [
	{n: 367, kind: "bug", why: "small runtime bug"},
	{n: 579, kind: "bug", why: "small docs bug"},
	{n: 393, kind: "feature", why: "feature, a new rule"},
	{n: 504, kind: "feature", why: "feature; one criterion's example was re-paired"},
	{n: 490, kind: "chore", why: "chore, comment only: the sledgehammer case"},
	{n: 565, kind: "feature", why: "the criterion's fixture proved wrong"},
] as const;

interface Replay {
	readonly number: number;
	readonly title: string;
	readonly url: string;
	readonly rawReport: string;
	readonly enriched: string;
	readonly pr: {readonly number: number; readonly url: string; readonly baseSha: string};
	readonly filesChanged: readonly {
		readonly path: string;
		readonly additions: number;
		readonly deletions: number;
		readonly kind: string;
	}[];
	readonly testsAdded: readonly {readonly path: string; readonly names: readonly string[]}[];
	readonly notes: readonly string[];
}

const replayOf = (n: number): Replay =>
	JSON.parse(readFileSync(join(here, "..", "replay", "issues", `${n}.json`), "utf8"));

/** The report as filed, without the footer of the agent that filed it. */
const reportOf = (r: Replay) => r.rawReport.replace(/\n---\n<sub>[\s\S]*$/, "").trim();

/** Today's criteria: the triaged ticket's checklist, less the rows marked for review only. */
export function todayOf(r: Replay): string[] {
	const at = r.enriched.indexOf("### Acceptance criteria");
	if (at < 0) return [];
	const rest = r.enriched.slice(at + "### Acceptance criteria".length);
	const end = rest.search(/\n#{2,3} /);
	return (end < 0 ? rest : rest.slice(0, end))
		.split("\n")
		.filter((line) => line.startsWith("- [ ]"))
		.filter((line) => !line.includes("ac:review"))
		.map((line) => line.replace(/^- \[ \] /, "").trim());
}

const wordsIn = (text: string) => text.split(/\s+/).filter((w) => w !== "").length;

const load = <T>(file: string): Record<string, T> =>
	existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {};
const save = (file: string, data: unknown) =>
	writeFileSync(file, `${JSON.stringify(data, null, "\t")}\n`);

// ---------------------------------------------------------------- plan

interface Kept extends Planned {
	readonly seconds: number;
	readonly factsChars: number;
	/** What the Check sent back, one entry per later try. */
	readonly sentBack: readonly string[];
}

/** A scratch clone at the base commit, for the code facts (they read git at HEAD). */
function cloneAt(sha: string): string {
	if (DEMLIK === undefined)
		throw new Error("DEMLIK is not set: point it at a local clone of demlik");
	const dir = join(CACHE, "clones", sha);
	if (!existsSync(join(dir, ".git"))) {
		mkdirSync(join(CACHE, "clones"), {recursive: true});
		execFileSync("git", ["clone", "-q", "--shared", "--no-checkout", DEMLIK, dir]);
		execFileSync("git", ["-C", dir, "checkout", "-q", "--detach", sha]);
	}
	return dir;
}

const urlOf = (n: number) => `https://github.com/kamp-us/demlik/issues/${n}`;

async function plan(only: readonly number[]) {
	const kept = load<Kept>(PLANS);
	const todo = only.filter((n) => kept[n] === undefined);
	console.log(
		`planning ${todo.join(", ") || "nothing"}; kept already: ${Object.keys(kept).join(", ")}`,
	);
	if (process.env.DRY === "1" || todo.length === 0) {
		console.log("estimate: about $0.5 to $1.5 a ticket on opus, effort medium");
		return;
	}
	const factsChars = new Map<number, number>();
	const sentBack = new Map<number, string[]>();
	let current = 0;
	const host = Layer.succeed(PlanHost, {
		ticket: (url: string) =>
			Effect.sync((): PlanTicket => {
				const r = replayOf(Number(url.split("/").pop()));
				current = r.number;
				return {
					url,
					number: r.number,
					state: "open",
					title: r.title,
					body: reportOf(r),
					at: r.pr.baseSha,
				};
			}),
	});
	const facts = Layer.succeed(PlanFacts, {
		gather: (ticket: PlanTicket) =>
			Effect.gen(function* () {
				const dir = yield* Effect.try({
					try: () => cloneAt(ticket.at ?? "HEAD"),
					catch: () => ({_tag: "unknown" as const}),
				});
				const mentions = mentionsOf(`${ticket.title}\n\n${ticket.body}`);
				const pack = yield* Effect.gen(function* () {
					return yield* (yield* LegacyFacts).gather(mentions);
				}).pipe(
					Effect.provide(localFacts(dir)),
					Effect.mapError(() => ({_tag: "unknown" as const})),
				);
				const text = factsBrief(pack);
				factsChars.set(ticket.number, text.length);
				return {text};
			}),
	});
	if (DEMLIK === undefined) throw new Error("DEMLIK is not set");
	// The live planner, with each later try's prompt (the Check's problems) kept for the write-up.
	const planner = Layer.effect(
		Planner,
		Effect.gen(function* () {
			const live = yield* Planner;
			return {
				run: (run: DraftRun, settings: Settings) => {
					if (run.session.continues)
						sentBack.set(current, [...(sentBack.get(current) ?? []), run.prompt]);
					return live.run(run, settings);
				},
			};
		}),
	).pipe(Layer.provide(livePlanner({repo: DEMLIK})));
	const services = Layer.mergeAll(host, facts, planner);
	let last = Date.now();
	await Effect.runPromise(
		Effect.gen(function* () {
			const started = yield* start(
				planProgram,
				{model: "opus", effort: "medium", budget: 1.5, tries: 3},
				{
					planned: (p: Planned) => {
						const n = Number(p.ticket.split("/").pop());
						const now = Date.now();
						kept[n] = {
							...p,
							seconds: Math.round((now - last) / 1000),
							factsChars: factsChars.get(n) ?? 0,
							sentBack: sentBack.get(n) ?? [],
						};
						last = now;
						save(PLANS, kept);
						console.log(
							`#${n}: ${p.name}, ${p.tries} tries, $${p.spend.costUsd.toFixed(2)}, ${kept[n]?.seconds}s`,
						);
					},
				},
				{id: "exp-86", storage: memoryStorage()},
			);
			if (started.kind !== "running") return yield* Effect.die(`did not start: ${started.why}`);
			for (const n of todo) tell(started.run, "ticket", urlOf(n));
			started.close("ticket");
			yield* started.run.ended;
		}).pipe(Effect.scoped, Effect.provide(services)),
	);
}

// ---------------------------------------------------------------- judge

const LABELS = ["outcome", "recipe", "mixed"] as const;
type Label = (typeof LABELS)[number];
interface Judged {
	readonly source: "today" | "ours";
	readonly text: string;
	readonly label: Label;
	readonly why: string;
}

const JUDGE_PROMPT = `You sort acceptance criteria of software tickets. For each one, say which it is:

- outcome: it says what someone can observe once the work is done (a command's output, a behaviour, a page's wording, a test that shows a behaviour), and it leaves how to build it open. Naming a published command, flag or package is fine.
- recipe: it says how to build it: which files, functions or types to change or add, steps to take, internal structure. Someone could meet it without anything a user sees changing.
- mixed: it states an observable result, but pins it to internal files, functions, types or test names a user never meets.

Judge each on its own words. Answer with one entry per criterion, by its id.`;

/** Fisher-Yates over a seeded draw, so the order is the same on a rerun. */
function shuffled<T>(items: readonly T[], seed: number): T[] {
	const out = [...items];
	let s = seed;
	for (let i = out.length - 1; i > 0; i--) {
		s = (s * 1103515245 + 12345) % 2 ** 31;
		const j = s % (i + 1);
		[out[i], out[j]] = [out[j] as T, out[i] as T];
	}
	return out;
}

async function judge(only: readonly number[]) {
	const plans = load<Kept>(PLANS);
	const judged = load<{label: Judged[]; costUsd: number}>(JUDGE);
	for (const n of only) {
		const kept = plans[n];
		if (kept?.plan == null || judged[n] !== undefined) continue;
		const items = [
			...todayOf(replayOf(n)).map((text) => ({source: "today" as const, text})),
			...kept.plan.tasks.flatMap((t) =>
				t.criteria.map((c) => ({source: "ours" as const, text: `${textOf(c)}.`})),
			),
		];
		const order = shuffled(items, n);
		const listed = order.map((item, i) => `${i + 1}. ${item.text}`).join("\n\n");
		const schema = {
			type: "object",
			additionalProperties: false,
			required: ["labels"],
			properties: {
				labels: {
					type: "array",
					items: {
						type: "object",
						additionalProperties: false,
						required: ["id", "label", "why"],
						properties: {
							id: {type: "integer"},
							label: {type: "string", enum: [...LABELS]},
							why: {type: "string"},
						},
					},
				},
			},
		};
		let answer: {labels: {id: number; label: Label; why: string}[]} | null = null;
		let cost = 0;
		for await (const m of query({
			prompt: `${JUDGE_PROMPT}\n\n# The criteria\n\n${listed}`,
			options: {
				model: "sonnet",
				tools: [],
				allowedTools: [],
				settingSources: [],
				strictMcpConfig: true,
				mcpServers: {},
				env: agentEnv(),
				permissionMode: "dontAsk",
				outputFormat: {type: "json_schema", schema},
				maxBudgetUsd: 0.5,
			},
		})) {
			if (m.type === "result") {
				cost = m.total_cost_usd;
				if (m.subtype === "success") answer = m.structured_output as typeof answer;
			}
		}
		if (answer === null) {
			console.log(`#${n}: the judge gave no answer`);
			continue;
		}
		const byId = new Map(answer.labels.map((l) => [l.id, l]));
		judged[n] = {
			costUsd: cost,
			label: order.map((item, i) => {
				const l = byId.get(i + 1);
				return {...item, label: l?.label ?? "mixed", why: l?.why ?? "(no label)"};
			}),
		};
		save(JUDGE, judged);
		console.log(`#${n}: ${order.length} criteria judged, $${cost.toFixed(3)}`);
	}
}

// ---------------------------------------------------------------- views

function views(only: readonly number[]) {
	const plans = load<Kept>(PLANS);
	const out = join(here, "86-plans");
	mkdirSync(out, {recursive: true});
	for (const n of only) {
		const kept = plans[n];
		if (kept?.plan == null) continue;
		const r = replayOf(n);
		const files = r.filesChanged
			.map((f) => `- \`${f.path}\` (${f.kind}, +${f.additions} -${f.deletions})`)
			.join("\n");
		const tests = r.testsAdded.flatMap((t) => t.names.map((name) => `- ${name}`)).join("\n");
		const text = [
			`<!-- Experiment 86. The plan the plan stage wrote for ${urlOf(n)}, from the report as filed, at the PR's base commit. Mark what you would change: tick, strike or note any line. -->`,
			"",
			planMarkdown(kept.plan, `${r.title} (#${n})`).trim(),
			"",
			"---",
			"",
			`## Beside it: today's triaged criteria (${todayOf(r).length})`,
			"",
			...todayOf(r).map((c) => `- ${c}`),
			"",
			`## Beside it: what the PR shipped (${r.pr.url})`,
			"",
			files,
			"",
			"Tests it added or changed:",
			"",
			tests || "- none",
			"",
			"Notes from the replay set:",
			"",
			...r.notes.map((note) => `- ${note}`),
			"",
		].join("\n");
		writeFileSync(join(out, `${n}.md`), text);
		console.log(`wrote 86-plans/${n}.md`);
	}
}

// ---------------------------------------------------------------- tables

function tables() {
	const plans = load<Kept>(PLANS);
	const judged = load<{label: Judged[]; costUsd: number}>(JUDGE);
	console.log(
		"| # | kind | outcome | tries | cost | time | tasks | criteria (today / ours) | words (today / ours) | questions | diff |",
	);
	console.log("|---|---|---|---|---|---|---|---|---|---|---|");
	let cost = 0;
	for (const {n, kind} of PICKED) {
		const kept = plans[n];
		if (kept === undefined) continue;
		const r = replayOf(n);
		const today = todayOf(r);
		const size = kept.plan === null ? null : sizeOf(kept.plan as Plan);
		const add = r.filesChanged.reduce((s, f) => s + f.additions, 0);
		const del = r.filesChanged.reduce((s, f) => s + f.deletions, 0);
		cost += kept.spend.costUsd;
		console.log(
			`| ${n} | ${kind} | ${kept.name} | ${kept.tries} | $${kept.spend.costUsd.toFixed(2)} | ${kept.seconds}s | ${size?.tasks ?? "-"} | ${today.length} / ${size?.criteria ?? "-"} | ${today.reduce((s, c) => s + wordsIn(c), 0)} / ${size?.words ?? "-"} | ${kept.plan?.questions.length ?? "-"} | ${r.filesChanged.length} files, +${add} -${del} |`,
		);
	}
	console.log(`\nplanner cost: $${cost.toFixed(2)}`);
	const counts = {
		today: {outcome: 0, recipe: 0, mixed: 0},
		ours: {outcome: 0, recipe: 0, mixed: 0},
	};
	let judgeCost = 0;
	for (const {label, costUsd} of Object.values(judged)) {
		judgeCost += costUsd;
		for (const j of label) counts[j.source][j.label] += 1;
	}
	console.log("\n| criteria | outcome | mixed | recipe |\n|---|---|---|---|");
	for (const source of ["today", "ours"] as const) {
		const c = counts[source];
		const all = c.outcome + c.mixed + c.recipe;
		const pct = (x: number) => `${x} (${all === 0 ? 0 : Math.round((100 * x) / all)}%)`;
		console.log(`| ${source} | ${pct(c.outcome)} | ${pct(c.mixed)} | ${pct(c.recipe)} |`);
	}
	console.log(`\njudge cost: $${judgeCost.toFixed(3)}`);
}

const only = (process.env.ONLY ?? PICKED.map((p) => p.n).join(","))
	.split(",")
	.map((s) => Number(s.trim()));
if (STEP === "plan") await plan(only);
else if (STEP === "judge") await judge(only);
else if (STEP === "views") views(only);
else tables();
