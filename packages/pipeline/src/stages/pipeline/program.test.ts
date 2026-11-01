import {execFileSync} from "node:child_process";
import {existsSync, mkdtempSync, readFileSync, realpathSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {dirname, join} from "node:path";
import {fileURLToPath} from "node:url";
import {Ledger, streams} from "@kampus/fabrika-old";
import {Effect, Fiber, Layer} from "effect";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {memoryLedger} from "../../asks/ledger.ts";
import {hashOf, textOf} from "../../tickets/approval.ts";
import {nameOf} from "../../tickets/ticket.ts";
import {Tickets, ticketsOnLedger} from "../../tickets/tickets.ts";
import {fakeEnv, makeLaneHome} from "./lane-fixture.ts";
import {laneLayer, runLane} from "./layer.ts";

// One tracker ticket through the whole lane in this process: the real machines, the real Codex
// adapter over a fake `codex`, real git on a bare remote, real vitest and Stryker, the real box, and
// a person's answers written as the ticket window writes them. No live agent, and nothing real is
// touched. Today's version.

const MODULES = fileURLToPath(new URL("../../../node_modules", import.meta.url));
const BRIEFS = fileURLToPath(new URL("../../../../../programs/pipeline/briefs", import.meta.url));
const OWNER = "user:owner";
const NUMBER = 1;

const file = (title: string, body: string, writer: string) =>
	Effect.gen(function* () {
		const ledger = yield* Ledger;
		yield* ledger.register(nameOf(NUMBER), writer);
		yield* ledger.send(streams(nameOf(NUMBER)).inbox, `file-${NUMBER}`, {
			kind: "filed",
			writer,
			data: {type: "filed", title, body},
		});
	});

const read = Effect.gen(function* () {
	return yield* (yield* Tickets).read(NUMBER);
}).pipe(Effect.provide(ticketsOnLedger({kind: "agent", id: "reader", for: "owner"})));

/** Answers every ask as a person, with `picks[kind]` or its first pick, until the fiber is stopped. */
const answering = (picks: Readonly<Record<string, string>>) =>
	Effect.gen(function* () {
		const ledger = yield* Ledger;
		const done = new Set<string>();
		for (;;) {
			const ticket = yield* read;
			for (const entry of ticket.timeline) {
				const fact = entry.fact;
				if (fact.type !== "asked" || done.has(fact.ask)) continue;
				done.add(fact.ask);
				const kind = fact.ask.split("-")[1] ?? "";
				yield* ledger.send(streams(nameOf(NUMBER)).inbox, `answer-${fact.ask}`, {
					kind: "answered",
					writer: OWNER,
					data: {
						type: "answered",
						ask: fact.ask,
						pick: picks[kind] ?? fact.picks[0],
						note: "",
						text: yield* hashOf(textOf(ticket)),
					},
				});
			}
			yield* Effect.sleep("50 millis");
		}
	});

interface Ran {
	readonly lines: readonly string[];
	readonly stages: readonly string[];
	readonly names: Readonly<Record<string, string>>;
	readonly facts: readonly {readonly type: string; readonly [key: string]: unknown}[];
	readonly dir: string;
	readonly remote: string;
}

interface Script {
	readonly title?: string;
	readonly writer?: string;
	readonly picks?: Readonly<Record<string, string>>;
	/** Stop the lane when a line holding this is said, then type the line again. */
	readonly killAt?: string;
	readonly noConfig?: boolean;
}

const lane = ({
	title = "Read names in one form",
	writer = OWNER,
	picks = {},
	killAt,
	noConfig = false,
}: Script): Promise<Ran> => {
	const dir = realpathSync(mkdtempSync(join(tmpdir(), "lane-")));
	const {home, remote} = makeLaneHome({
		dir,
		nodeModules: MODULES,
		reads: [dirname(dirname(dirname(MODULES)))],
	});
	if (noConfig) rmSync(join(home, "pipeline.json"));
	for (const [key, value] of Object.entries(fakeEnv(dir))) vi.stubEnv(key, value);
	const lines: string[] = [];
	const line = () =>
		runLane(NUMBER, (said) => Effect.sync(() => void lines.push(said))).pipe(
			Effect.provide(laneLayer({home, briefs: BRIEFS, person: "owner"})),
		);
	return Effect.runPromise(
		Effect.gen(function* () {
			yield* file(title, "Lower case, no spaces around.", writer);
			yield* Effect.forkScoped(answering(picks));
			if (killAt !== undefined) {
				const first = yield* Effect.forkScoped(line());
				while (!lines.some((said) => said.includes(killAt))) yield* Effect.sleep("20 millis");
				yield* Fiber.interrupt(first);
				lines.push("-- killed --");
			}
			yield* line();
			const ticket = yield* read;
			const facts = ticket.timeline.map((e) => e.fact as Ran["facts"][number]);
			const ends = facts.filter((f) => f.type === "ended");
			return {
				lines,
				facts,
				dir,
				remote,
				stages: ends.map((f) => String(f.stage)),
				names: Object.fromEntries(
					ends.map((f) => [String(f.stage), JSON.stringify(f.outcome)] as const),
				),
			} satisfies Ran;
		}).pipe(Effect.scoped, Effect.provide(Layer.fresh(memoryLedger().layer))),
	);
};

const onMain = (remote: string, path: string): string | null => {
	try {
		return execFileSync("git", ["--git-dir", remote, "show", `main:${path}`], {
			encoding: "utf8",
			stdio: "pipe",
		});
	} catch {
		return null;
	}
};

const codexRuns = (dir: string) =>
	existsSync(join(dir, "codex.log"))
		? readFileSync(join(dir, "codex.log"), "utf8")
				.trim()
				.split("\n")
				.map(
					(row) =>
						JSON.parse(row) as {
							readonly args: readonly string[];
							readonly step: string;
							readonly keys: readonly string[];
						},
				)
		: [];

const WHOLE = [
	"triage",
	"plan",
	"exam",
	"test_writer",
	"build",
	"mutation",
	"mutants",
	"review",
	"push",
	"merge",
];

describe("a lane, whole", () => {
	beforeEach(() => {
		vi.stubEnv("TYPESAFE_API_KEY", "");
		vi.stubEnv("OPENAI_API_KEY", "");
		vi.stubEnv("CODEX_API_KEY", "");
	});
	afterEach(() => {
		vi.unstubAllEnvs();
	});

	it(
		"runs every step in order and ends on a merge, on a person's yes",
		{timeout: 300_000},
		async () => {
			const ran = await lane({});
			expect(ran.stages).toEqual(WHOLE);
			expect(ran.lines.at(-1)).toContain("ended: done");
			expect(onMain(ran.remote, "src/lower.ts")).toContain("toLowerCase");
			expect(onMain(ran.remote, "src/lower.test.ts")).toContain("lowers capitals");
			expect(onMain(ran.remote, "src/lower-spaces.test.ts")).toContain("cuts spaces");

			// Each agent's run names its brief at the start, and its model and tokens at the end.
			const started = ran.facts.filter((f) => f.type === "started" && f.stage === "plan");
			expect(started[0]).toMatchObject({
				brief: "plan.md",
				harness: "codex",
				model: "gpt-6-astra",
				effort: "high",
			});
			expect(String(started[0]?.hash)).toMatch(/^[0-9a-f]{8,}$/);
			const plan = ran.facts.find((f) => f.type === "ended" && f.stage === "plan");
			expect(plan).toMatchObject({input: 1000, cached: 200, output: 100, listUsd: null, billed: 0});

			// The real adapter ran the fake: the model from `fabrika.toml`, read-only and no key in reach.
			const runs = codexRuns(ran.dir);
			expect(runs.map((r) => r.step)).toEqual([
				"triage",
				"plan",
				"tests",
				"build",
				"mutants",
				"review",
			]);
			for (const run of runs) {
				expect(run.args).toContain("gpt-6-astra");
				expect(run.keys).toEqual([]);
			}
		},
	);

	it(
		"lands rule changes in their own pull request before the test writer starts",
		{timeout: 300_000},
		async () => {
			const ran = await lane({title: "[rules] Read names in one form"});
			expect(ran.stages).toEqual([
				"triage",
				"plan",
				"exam",
				"exam_merge",
				"test_writer",
				"build",
				"mutation",
				"mutants",
				"review",
				"push",
				"merge",
			]);
			expect(onMain(ran.remote, ".oxlintrc.json")).toContain("rules");
			expect(ran.lines.at(-1)).toContain("ended: done");
			expect(codexRuns(ran.dir).map((r) => r.step)).toContain("exam");
		},
	);

	it(
		"keeps nothing of a build that changes a test the writer wrote",
		{timeout: 300_000},
		async () => {
			const ran = await lane({title: "[touch-exam] Read names in one form"});
			expect(ran.stages).toEqual(["triage", "plan", "exam", "test_writer", "build"]);
			expect(ran.names.build).toContain("exam_touched");
			expect(ran.lines.at(-1)).toContain("exam_touched");
			expect(onMain(ran.remote, "src/lower.ts")).toBeNull();
			const said = ran.facts.filter((f) => f.type === "commented").map((f) => String(f.body));
			expect(said.some((body) => body.includes("src/lower.test.ts"))).toBe(true);
		},
	);

	it("does not merge when the person says no", {timeout: 300_000}, async () => {
		const ran = await lane({picks: {merge: "no"}});
		expect(onMain(ran.remote, "src/lower.ts")).toBeNull();
		expect(ran.stages).not.toContain("merge");
		expect(ran.lines.at(-1)).not.toContain("ended: done");
	});

	it(
		"refuses a ticket someone else filed, before any agent starts",
		{timeout: 60_000},
		async () => {
			const ran = await lane({writer: "user:someone"});
			expect(ran.stages).toEqual([]);
			expect(ran.lines.join("\n")).toMatch(/not_yours/);
			expect(codexRuns(ran.dir)).toEqual([]);
		},
	);

	it("says what is missing when the home names no repository", {timeout: 60_000}, async () => {
		const ran = await lane({noConfig: true});
		expect(ran.stages).toEqual([]);
		expect(ran.lines.join("\n")).toContain("pipeline.json");
	});

	it(
		"resumes after a kill inside an agent's run, and ends each step once",
		{timeout: 300_000},
		async () => {
			const ran = await lane({
				title: "[slow-build] Read names in one form",
				killAt: "test_writer: done",
			});
			expect(ran.lines).toContain("-- killed --");
			expect(ran.stages).toEqual(WHOLE);
			expect(ran.lines.at(-1)).toContain("ended: done");
			expect(onMain(ran.remote, "src/lower.ts")).toContain("toLowerCase");
			const steps = codexRuns(ran.dir).map((r) => r.step);
			expect(steps.filter((s) => s === "plan")).toHaveLength(1);
			expect(steps.filter((s) => s === "tests")).toHaveLength(1);
			// The run the kill cut short starts over: one that was killed, one that ended. Never a third.
			expect(steps.filter((s) => s === "build").length).toBeLessThanOrEqual(2);
		},
	);

	it("resumes after a kill and does no step twice", {timeout: 300_000}, async () => {
		const ran = await lane({killAt: "build: done"});
		expect(ran.lines).toContain("-- killed --");
		expect(ran.stages).toEqual(WHOLE);
		expect(ran.lines.at(-1)).toContain("ended: done");
		const steps = codexRuns(ran.dir).map((r) => r.step);
		expect(steps.filter((s) => s === "plan")).toHaveLength(1);
		expect(steps.filter((s) => s === "build")).toHaveLength(1);
		expect(
			ran.facts.filter((f) => f.type === "asked" && String(f.ask).startsWith("a-approve")),
		).toHaveLength(1);
	});
});
