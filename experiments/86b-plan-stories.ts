// Experiment 86b: the plan stage again, with user stories, a whole-job first
// criterion, and the code-name rule narrowed to internal names.
//
// The same six closed demlik tickets as part 1 (86-plan-stage.ts), the same
// method: each planned from the report as filed, at the PR's base commit,
// read-only, with opus at effort medium, up to 3 drafts. What changed is the
// plan program (wip/src/stages/plan): stories, `serves` on every criterion,
// a `job` that opens every task, and a Check that lets a criterion name what
// a user meets. The names a user meets are read here, from each published
// package's manifest and docs at the base commit (wip/src/stages/plan/names.ts).
//
// Run with
//   DEMLIK=<a local clone of kamp-us/demlik> node experiments/86b-plan-stories.ts
//
//   STEP=plan    plan the tickets (ONLY=<n,n> for some; DRY=1 prints what the
//                planner would be handed about names, and stops)
//   STEP=judge   the blind outcome-or-recipe judge of part 1, on today's
//                criteria and ours (the job with its fixture), shuffled
//   STEP=views   write each plan to experiments/86-plans/<n>.md, stories first,
//                with today's criteria and what the PR shipped beside it
//   (no STEP)    print the tables, part 1's numbers beside this run's
//
// It writes nothing to GitHub. CACHE (default `runs/exp-86-cache`) holds the
// scratch clones and is never committed. `results/86b-plans.json` holds each
// plan and what it cost; `results/86b-judge.json` each criterion's label.
// Part 1's results stay in `results/86-plans.json` and `results/86-judge.json`.
//
// Node at the edge, said out loud: `node:fs` for the result files and the
// published docs, `node:child_process` for `git`, as the other replay scripts do.
import {execFileSync} from "node:child_process";
import {existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync} from "node:fs";
import {join} from "node:path";
import {query} from "@anthropic-ai/claude-agent-sdk";
import {memoryStorage, start, tell} from "@kampus/fabrika";
import type {DraftRun} from "@kampus/fabrika/agents/claude";
import {agentEnv} from "@kampus/fabrika/pipeline/env";
import {type Published, userNames} from "@kampus/fabrika/pipeline/stages/plan/names";
import {criteriaOf, type Plan, sizeOf, textOf} from "@kampus/fabrika/pipeline/stages/plan/plan";
import {livePlanner, namesBrief} from "@kampus/fabrika/pipeline/stages/plan/planner";
import {type Planned, planProgram} from "@kampus/fabrika/pipeline/stages/plan/program";
import {planMarkdown} from "@kampus/fabrika/pipeline/stages/plan/render";
import {
	PlanFacts,
	PlanHost,
	Planner,
	type PlanTicket,
	type Settings,
} from "@kampus/fabrika/pipeline/stages/plan/services";
import {Effect, Layer} from "effect";
import {localFacts} from "../legacy/src/code-facts.ts";
import {Facts as LegacyFacts} from "../legacy/src/factory-services.ts";
import {factsBrief, mentionsOf} from "../legacy/src/facts.ts";

const here = import.meta.dirname;
const DEMLIK = process.env.DEMLIK;
const CACHE = process.env.CACHE ?? join(here, "..", "runs", "exp-86-cache");
const STEP = process.env.STEP ?? "tables";
const PLANS = join(here, "results", "86b-plans.json");
const JUDGE = join(here, "results", "86b-judge.json");
const PART1_PLANS = join(here, "results", "86-plans.json");
const PART1_JUDGE = join(here, "results", "86-judge.json");

/** The six of part 1, in its order. */
const PICKED = [
	{n: 367, kind: "bug"},
	{n: 579, kind: "bug"},
	{n: 393, kind: "feature"},
	{n: 504, kind: "feature"},
	{n: 490, kind: "chore"},
	{n: 565, kind: "feature"},
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
function todayOf(r: Replay): string[] {
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

const load = <T>(file: string): Record<string, T> =>
	existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {};
const save = (file: string, data: unknown) =>
	writeFileSync(file, `${JSON.stringify(data, null, "\t")}\n`);

// ---------------------------------------------------------------- plan

interface Kept extends Planned {
	readonly seconds: number;
	readonly factsChars: number;
	readonly names: number;
	/** What the Check sent back, one entry per later try. */
	readonly sentBack: readonly string[];
}

/** A scratch clone at the base commit, for the code facts and the published docs. */
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

/** Every published package under `packages/`: its manifest, its README and its docs folder. */
function publishedAt(dir: string): Published[] {
	const root = join(dir, "packages");
	if (!existsSync(root)) return [];
	return readdirSync(root).flatMap((name) => {
		const at = join(root, name);
		const manifest = join(at, "package.json");
		if (!existsSync(manifest)) return [];
		const docsDir = join(at, "docs");
		const pages = [
			join(at, "README.md"),
			...(existsSync(docsDir)
				? readdirSync(docsDir, {recursive: true, encoding: "utf8"})
						.filter((f) => f.endsWith(".md"))
						.map((f) => join(docsDir, f))
				: []),
		].filter(existsSync);
		return [
			{
				manifest: JSON.parse(readFileSync(manifest, "utf8")),
				docs: pages.map((page) => readFileSync(page, "utf8")),
			},
		];
	});
}

const urlOf = (n: number) => `https://github.com/kamp-us/demlik/issues/${n}`;

async function plan(only: readonly number[]) {
	const kept = load<Kept>(PLANS);
	const todo = only.filter((n) => kept[n] === undefined);
	console.log(
		`planning ${todo.join(", ") || "nothing"}; kept already: ${Object.keys(kept).join(", ")}`,
	);
	if (process.env.DRY === "1") {
		for (const n of todo) {
			const r = replayOf(n);
			const names = userNames(publishedAt(cloneAt(r.pr.baseSha)));
			const brief = namesBrief(names, `${r.title}\n${reportOf(r)}`);
			console.log(`#${n}: ${names.length} names; shown to the planner:\n${brief}\n`);
		}
		console.log("estimate: about $0.5 to $1.5 a ticket on opus, effort medium");
		return;
	}
	if (todo.length === 0) return;
	const factsChars = new Map<number, number>();
	const namesCount = new Map<number, number>();
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
				const names = yield* Effect.try({
					try: () => userNames(publishedAt(dir)),
					catch: () => ({_tag: "unknown" as const}),
				});
				const text = factsBrief(pack);
				factsChars.set(ticket.number, text.length);
				namesCount.set(ticket.number, names.length);
				return {text, names};
			}),
	});
	if (DEMLIK === undefined) throw new Error("DEMLIK is not set");
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
							names: namesCount.get(n) ?? 0,
							sentBack: sentBack.get(n) ?? [],
						};
						last = now;
						save(PLANS, kept);
						console.log(
							`#${n}: ${p.name}, ${p.tries} tries, $${p.spend.costUsd.toFixed(2)}, ${kept[n]?.seconds}s`,
						);
					},
				},
				{id: "exp-86b", storage: memoryStorage()},
			);
			if (started.kind !== "running") return yield* Effect.die(`did not start: ${started.why}`);
			for (const n of todo) yield* tell(started.run, "ticket", urlOf(n));
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

/** Part 1's prompt, word for word. */
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

/** Our criteria as the judge reads them: the job with its fixture, then the rest. */
const oursOf = (p: Plan): string[] =>
	p.tasks.flatMap((t) => [
		`${textOf(t.job)}, on ${t.job.fixture.trim().replace(/\.$/, "")}.`,
		...t.criteria.map((c) => `${textOf(c)}.`),
	]);

async function judge(only: readonly number[]) {
	const plans = load<Kept>(PLANS);
	const judged = load<{label: Judged[]; costUsd: number}>(JUDGE);
	for (const n of only) {
		const kept = plans[n];
		if (kept?.plan == null || judged[n] !== undefined) continue;
		const items = [
			...todayOf(replayOf(n)).map((text) => ({source: "today" as const, text})),
			...oursOf(kept.plan).map((text) => ({source: "ours" as const, text})),
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
			`<!-- Experiment 86b (part 1 was 86). The plan the plan stage wrote for ${urlOf(n)}, from the report as filed, at the PR's base commit, with user stories and a whole-job first criterion. Mark what you would change: tick, strike or note any line. -->`,
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

/** What kind of problem one line the Check sent back is. */
function kindOf(problem: string): string {
	if (problem.includes("names code")) return "names code";
	if (problem.includes("which no story has")) return "serves an unknown story";
	if (problem.includes("has no criterion: write one that serves it")) return "story unserved";
	if (problem.includes("fixture")) return "job fixture";
	if (/step to take/.test(problem)) return "a step, not a result";
	if (/one claim|joins two results|more than one sentence/.test(problem)) return "two claims";
	if (problem.startsWith("Story")) return "story shape";
	if (problem.includes("has no lean")) return "no lean";
	return "other";
}

const problemsIn = (sent: readonly string[]): string[] =>
	sent.flatMap((prompt) =>
		prompt
			.split("\n")
			.filter((line) => line.startsWith("- "))
			.map((line) => line.slice(2)),
	);

function labelCounts(file: string) {
	const judged = load<{label: Judged[]; costUsd: number}>(file);
	const counts = {
		today: {outcome: 0, recipe: 0, mixed: 0},
		ours: {outcome: 0, recipe: 0, mixed: 0},
	};
	let cost = 0;
	const perTicket: Record<string, {outcome: number; all: number}> = {};
	for (const [n, {label, costUsd}] of Object.entries(judged)) {
		cost += costUsd;
		for (const j of label) {
			counts[j.source][j.label] += 1;
			if (j.source === "ours") {
				const t = perTicket[n] ?? {outcome: 0, all: 0};
				perTicket[n] = t;
				t.all += 1;
				if (j.label === "outcome") t.outcome += 1;
			}
		}
	}
	return {counts, cost, perTicket};
}

function tables() {
	const plans = load<Kept>(PLANS);
	// Part 1's plans have the old shape: only their counts are read here.
	const part1 = load<{
		name: string;
		seconds: number;
		spend: {costUsd: number};
		plan: {tasks: {criteria: unknown[]}[]; questions: unknown[]} | null;
	}>(PART1_PLANS);
	const j1 = labelCounts(PART1_JUDGE);
	const j2 = labelCounts(JUDGE);
	console.log(
		"| # | ended (1 / 1b) | drafts | stories | criteria (today / 1 / 1b) | outcome share (1 / 1b) | job carries a fixture | questions (1 / 1b) | cost (1 / 1b) | time (1 / 1b) | words |",
	);
	console.log("|---|---|---|---|---|---|---|---|---|---|---|");
	let cost = 0;
	const kinds: Record<string, number> = {};
	for (const {n} of PICKED) {
		const kept = plans[n];
		const old = part1[n];
		if (kept === undefined) continue;
		const r = replayOf(n);
		const p = kept.plan;
		const size = p === null ? null : sizeOf(p);
		cost += kept.spend.costUsd;
		for (const problem of problemsIn(kept.sentBack)) {
			const kind = kindOf(problem);
			kinds[kind] = (kinds[kind] ?? 0) + 1;
		}
		const oldCriteria = old?.plan?.tasks.reduce((s, t) => s + t.criteria.length, 0) ?? "-";
		const share = (t: {outcome: number; all: number} | undefined) =>
			t === undefined ? "-" : `${t.outcome}/${t.all}`;
		const fixture =
			p === null
				? "-"
				: p.tasks.map((t) => (t.job.fixture.trim() === "" ? "no" : "yes")).join(", ");
		console.log(
			`| ${n} | ${old?.name ?? "-"} / ${kept.name} | ${kept.tries} | ${size?.stories ?? "-"} | ${todayOf(r).length} / ${oldCriteria} / ${size?.criteria ?? "-"} | ${share(j1.perTicket[n])} / ${share(j2.perTicket[n])} | ${fixture} | ${old?.plan?.questions.length ?? "-"} / ${p?.questions.length ?? "-"} | $${old?.spend.costUsd.toFixed(2) ?? "-"} / $${kept.spend.costUsd.toFixed(2)} | ${old?.seconds ?? "-"} s / ${kept.seconds} s | ${size?.words ?? "-"} |`,
		);
	}
	console.log(`\nplanner cost: $${cost.toFixed(2)}`);
	console.log("\nCheck problems by kind:");
	for (const [kind, count] of Object.entries(kinds).sort((a, b) => b[1] - a[1]))
		console.log(`- ${kind}: ${count}`);
	console.log("\n| criteria | outcome | mixed | recipe |\n|---|---|---|---|");
	for (const [run, j] of [
		["part 1", j1],
		["86b", j2],
	] as const) {
		for (const source of ["today", "ours"] as const) {
			const c = j.counts[source];
			const all = c.outcome + c.mixed + c.recipe;
			const pct = (x: number) => `${x} (${all === 0 ? 0 : Math.round((100 * x) / all)}%)`;
			console.log(
				`| ${run}, ${source} (${all}) | ${pct(c.outcome)} | ${pct(c.mixed)} | ${pct(c.recipe)} |`,
			);
		}
	}
	console.log(`\njudge cost: $${j2.cost.toFixed(3)}`);
	console.log("\nStories, by who:");
	for (const {n} of PICKED) {
		const p = plans[n]?.plan;
		if (p == null) continue;
		console.log(`- ${n}: ${p.stories.map((s) => `${s.id} ${s.who}`).join("; ")}`);
		for (const t of p.tasks)
			for (const c of criteriaOf(t))
				if (c.serves.length > 1)
					console.log(`    serves ${c.serves.join("+")}: ${textOf(c).slice(0, 90)}`);
	}
}

const only = (process.env.ONLY ?? PICKED.map((p) => p.n).join(","))
	.split(",")
	.map((s) => Number(s.trim()));
if (STEP === "plan") await plan(only);
else if (STEP === "judge") await judge(only);
else if (STEP === "views") views(only);
else tables();
