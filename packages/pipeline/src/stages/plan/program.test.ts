import {execFileSync} from "node:child_process";
import {mkdtempSync, readdirSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {ear, memoryStorage, start, tell} from "@kampus/fabrika";
import type {DraftRun} from "@kampus/fabrika/agents/claude";
import {Effect, Layer, Stream} from "effect";
import {afterAll, describe, expect, it} from "vitest";
import {initOf, resultOf, scriptedOpen} from "../../draft-scripted.ts";
import type {Criterion, PlanDraft as Plan, DraftTask as Task} from "./plan.ts";
import {livePlanner} from "./planner.ts";
import {type Planned, planProgram} from "./program.ts";
import {PlanFacts, PlanHost, type PlanMsg, Planner, type PlanTicket} from "./services.ts";

// The plan program, started from code: the machine and its handlers are the
// real ones; the ticket and the facts are fakes, and the planner is scripted.
// Then the live planner's own part, over a scripted SDK query: the copy of
// the code it hands the agent, and the options it starts it with.

const URL = "https://github.com/acme/widgets/issues/7";
const FLAGS = {model: "opus", effort: "medium", budget: 1, tries: 3} as const;
const TICKET: PlanTicket = {
	url: URL,
	number: 7,
	state: "open",
	title: "The slug keeps two dashes",
	body: "Two spaces make two dashes.",
	at: null,
};

const good: Plan = {
	summary: "Two spaces in a title make two dashes in its slug.",
	stories: [{id: "s1", who: "a blog author", want: "clean slugs", why: "links read well"}],
	tasks: [
		{
			title: "One dash for any run of spaces",
			ends: "pr",
			job: {
				when: "someone makes slugs from fifty real titles, then from those slugs again",
				result: "every slug has single dashes, and the second pass gives the same slugs",
				fixture: "fifty titles, a fifth with runs of spaces, run twice",
				check: {how: "test", what: "a test slugs them twice"},
				serves: ["s1"],
			},
			criteria: [
				{
					when: "someone makes a slug from a title with two spaces in a row",
					result: "the slug has one dash where the spaces were",
					check: {how: "test", what: "a test slugs such a title"},
					serves: ["s1"],
				},
			],
		},
	],
	pointers: [{at: "src/slug.ts", why: "the slug is made here"}],
	questions: [],
};
const [task] = good.tasks as [Task];
const [criterion] = task.criteria as [Criterion];
const coded: Plan = {
	...good,
	tasks: [{...task, criteria: [{...criterion, when: "slugOf gets two spaces"}]}],
};

/** A planner that answers each run with the next plan, and keeps the runs it was handed. */
function scriptedPlanner(answers: readonly Plan[]) {
	const runs: DraftRun[] = [];
	const layer = Layer.succeed(Planner, {
		run: (run) => {
			const output = answers[runs.length] ?? null;
			runs.push(run);
			const msg: PlanMsg = {
				type: "plan_finished",
				key: run.key,
				id: run.id,
				output,
				session: "s",
				spend: {costUsd: 0.25, tokens: 10, context: 5, turns: 2, minutes: 0.1},
			};
			return Stream.make(msg);
		},
	});
	return {layer, runs};
}

const world = (answers: readonly Plan[], facts: string | null) => {
	const planner = scriptedPlanner(answers);
	const services = Layer.mergeAll(
		Layer.succeed(PlanHost, {ticket: () => Effect.succeed(TICKET)}),
		Layer.succeed(PlanFacts, {
			gather: () =>
				facts === null
					? Effect.fail({_tag: "unknown" as const})
					: Effect.succeed({text: facts, names: []}),
		}),
		planner.layer,
	);
	return {services, runs: planner.runs};
};

const planOne = (w: ReturnType<typeof world>) =>
	Effect.runPromise(
		Effect.gen(function* () {
			const planned = ear<Planned>();
			const started = yield* start(
				planProgram,
				FLAGS,
				{planned: planned.hear},
				{id: "plan:test", storage: memoryStorage()},
			);
			if (started.kind !== "running") return yield* Effect.die(`did not start: ${started.why}`);
			yield* tell(started.run, "ticket", URL);
			started.close("ticket");
			yield* started.run.ended;
			return planned.values;
		}).pipe(Effect.scoped, Effect.provide(w.services)),
	);

describe("plan: the user's job", () => {
	it("a ticket in, a plan out: the Check sent the first draft back, the second passed, and both runs are paid for", async () => {
		const w = world([coded, good], "- `slugify`: src/slug.ts:3");
		const [planned, ...more] = await planOne(w);
		expect(more).toEqual([]);
		expect(planned).toMatchObject({
			ticket: URL,
			name: "done",
			plan: good,
			tries: 2,
			facts: true,
			problems: [],
			spend: {costUsd: 0.5, turns: 4},
		});
		expect(w.runs.map((r) => [r.id.endsWith("/1") ? 1 : 2, r.session.continues])).toEqual([
			[1, false],
			[2, true],
		]);
		expect(w.runs[0]?.prompt).toContain("- `slugify`: src/slug.ts:3");
		expect(w.runs[1]?.prompt).toContain("slugOf (a camelCase name)");
	});

	it("no facts: the plan is made all the same, and the report says none were handed over", async () => {
		const [planned] = await planOne(world([good], null));
		expect(planned).toMatchObject({name: "done", facts: false, tries: 1});
	});
});

describe("the live planner", () => {
	const repo = mkdtempSync(join(tmpdir(), "plan-repo-"));
	afterAll(() => rmSync(repo, {recursive: true, force: true}));
	const git = (...args: string[]) =>
		execFileSync("git", ["-C", repo, ...args], {encoding: "utf8"}).trim();
	git("init", "-q");
	writeFileSync(join(repo, "slug.ts"), "export const slug = (s: string) => s;\n");
	git("add", ".");
	git("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "one");
	const commit = git("rev-parse", "HEAD");

	it("hands the agent a copy of the code at the commit, with no history, and reading tools only", async () => {
		const scripted = scriptedOpen([initOf(["Read", "Grep", "Glob"]), resultOf(good)]);
		const run: DraftRun = {
			key: "k",
			id: "k/1",
			prompt: "plan it",
			session: {id: "00000000-0000-4000-8000-000000000000", continues: false},
			agent: null,
			folder: commit,
		};
		const seen: {files: string[]} = {files: []};
		const msgs = await Effect.runPromise(
			Effect.gen(function* () {
				const planner = yield* Planner;
				// The stream stays open until its Sub closes; the machine closes it at the run's last Msg.
				const all = yield* Stream.runCollect(
					planner
						.run(run, {model: "opus", effort: "low", budget: 1})
						.pipe(Stream.takeUntil((m) => m.type !== "plan_tool")),
				);
				const options = scripted.asked[0];
				if (options?.cwd !== undefined) seen.files = readdirSync(options.cwd).sort();
				return all;
			}).pipe(Effect.provide(livePlanner({repo, open: scripted.open})), Effect.scoped),
		);
		expect([...msgs].map((m) => m.type)).toEqual(["plan_finished"]);
		expect([...msgs][0]).toMatchObject({output: good});
		expect(seen.files).toEqual(["slug.ts"]);
		expect(scripted.asked[0]).toMatchObject({
			tools: ["Read", "Grep", "Glob"],
			allowedTools: ["Read", "Grep", "Glob"],
			settingSources: [],
			model: "opus",
			sessionId: run.session.id,
			outputFormat: {type: "json_schema"},
		});
	});

	it.each([
		[true, {resume: "00000000-0000-4000-8000-000000000001"}],
		[false, {sessionId: "00000000-0000-4000-8000-000000000001"}],
	])(
		"a second try, its conversation kept on this host %s: carried on, or the same prompt in a new one",
		async (kept, asked) => {
			const scripted = scriptedOpen([initOf(["Read", "Grep", "Glob"]), resultOf(good)]);
			const run: DraftRun = {
				key: "k",
				id: "k/2",
				prompt: "plan it, again",
				session: {id: "00000000-0000-4000-8000-000000000001", continues: true},
				agent: null,
				folder: commit,
			};
			await Effect.runPromise(
				Effect.gen(function* () {
					const planner = yield* Planner;
					return yield* Stream.runCollect(
						planner
							.run(run, {model: "opus", effort: "low", budget: 1})
							.pipe(Stream.takeUntil((m) => m.type !== "plan_tool")),
					);
				}).pipe(
					Effect.provide(
						livePlanner({repo, open: scripted.open, kept: () => Effect.succeed(kept)}),
					),
					Effect.scoped,
				),
			);
			expect(scripted.asked[0]).toMatchObject(asked);
		},
	);

	it("a commit the clone does not hold: the run ends failed, and no agent starts", async () => {
		const scripted = scriptedOpen([resultOf(good)]);
		const msgs = await Effect.runPromise(
			Effect.gen(function* () {
				const planner = yield* Planner;
				return yield* Stream.runCollect(
					planner.run(
						{
							key: "k",
							id: "k/1",
							prompt: "p",
							session: {id: "s", continues: false},
							agent: null,
							folder: "f".repeat(40),
						},
						{model: "opus", effort: "low", budget: 1},
					),
				);
			}).pipe(Effect.provide(livePlanner({repo, open: scripted.open})), Effect.scoped),
		);
		expect([...msgs]).toMatchObject([{type: "plan_failed"}]);
		expect(scripted.seen.opened).toBe(0);
	});
});
