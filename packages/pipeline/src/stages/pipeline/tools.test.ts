import {execFileSync} from "node:child_process";
import {mkdtempSync, realpathSync, rmSync, writeFileSync} from "node:fs";
import {homedir, tmpdir} from "node:os";
import {join} from "node:path";
import {Ledger, streams} from "@kampus/fabrika-old";
import {Effect, Layer} from "effect";
import {afterEach, beforeEach, describe, expect, it} from "vitest";
import {memoryLedger} from "../../asks/ledger.ts";
import type {Settings} from "../../settings.ts";
import {factsOf, nameOf} from "../../tickets/ticket.ts";
import {Tickets, ticketsOnLedger} from "../../tickets/tickets.ts";
import {placeIn} from "../mutation/mutant.ts";
import {spansOf} from "../mutation/scope.ts";
import {MutationRunner, MutationScope, type RunAsk} from "../mutation/services.ts";
import {PushWork} from "../push/program.ts";
import {TestsWork} from "../test-writer/program.ts";
import {CheckRunner} from "./checks.ts";
import {ticketUrlOf} from "./hosts.ts";
import {LANE_REPO, makeLaneHome} from "./lane-fixture.ts";
import {LanePulls, PullWire} from "./pulls.ts";
import {laneCheckRunner, laneMutationScope, lanePushWork, laneTestsWork} from "./tools.ts";
import {LaneHome, LaneWork, laneWork} from "./work.ts";

// Today's version. The mutation step's read of a change, on real git over a bare remote.

describe("the lines the mutation step reads from a change", () => {
	let dir: string;
	beforeEach(() => {
		dir = realpathSync(mkdtempSync(join(tmpdir(), "lane-scope-")));
	});
	afterEach(() => rmSync(dir, {recursive: true, force: true}));

	it("a changed file with a space or a non-ASCII letter in its name gets its span", async () => {
		const {home, seed} = makeLaneHome({dir, nodeModules: join(dir, "no-modules")});
		const work = laneWork.pipe(
			Layer.provide(Layer.succeed(LaneHome, {home, checkout: seed, briefs: "", person: "owner"})),
		);
		const NAMES = ["src/my file.ts", "src/café.ts"];
		const read = await Effect.runPromise(
			Effect.gen(function* () {
				const lane = yield* LaneWork;
				const {tree, base} = yield* lane.tree(1);
				const files = NAMES.map((path) => ({
					path,
					text: "export const flip = (on: boolean): boolean => !on;\n",
				}));
				const head = yield* lane.commit(tree, files, "A change");
				return yield* (yield* MutationScope).read(base, head, [], []);
			}).pipe(Effect.provide(Layer.provideMerge(laneMutationScope, work))),
		);
		expect(read.diff.files.toSorted()).toEqual(NAMES.toSorted());
		expect(
			spansOf(read)
				.map((span) => span.file)
				.toSorted(),
		).toEqual(NAMES.toSorted());
	});
});

// A new test kills its mutant when the mutant no longer survives, so a run that looked at no line
// would call every test a killer.
describe("whether a new test kills its mutant", () => {
	let dir: string;
	beforeEach(() => {
		dir = realpathSync(mkdtempSync(join(tmpdir(), "lane-kill-")));
	});
	afterEach(() => rmSync(dir, {recursive: true, force: true}));

	const MUTANT = "src/flip.ts:7:3:abc123";

	/** With `surviving` as what a run finds on the lines it is asked for: as a real one, none on no line. */
	const killed = async (surviving: readonly string[]) => {
		const {home, seed} = makeLaneHome({dir, nodeModules: join(dir, "no-modules")});
		const work = laneWork.pipe(
			Layer.provide(Layer.succeed(LaneHome, {home, checkout: seed, briefs: "", person: "owner"})),
		);
		const asks: RunAsk[] = [];
		const onLines = (ask: RunAsk) =>
			surviving.filter((mutant) => {
				const {file, line} = placeIn(mutant);
				return ask.spans.some((s) => s.file === file && s.from <= line && line <= s.to);
			});
		const runner = Layer.succeed(MutationRunner, {
			tests: () => Effect.succeed({result: "green", failed: [], tail: ""} as const),
			run: (ask) =>
				Effect.sync(() => {
					asks.push(ask);
					const survived = onLines(ask).map((mutant) => ({
						mutant,
						mutator: "EqualityOperator",
						original: "===",
						replacement: "!==",
					}));
					return {
						found: survived.length,
						ran: survived.length,
						ignored: 0,
						compileErrors: 0,
						killed: 0,
						survived,
					};
				}),
		});
		const result = await Effect.runPromise(
			Effect.gen(function* () {
				const lane = yield* LaneWork;
				const {tree} = yield* lane.tree(1);
				const commit = yield* lane.commit(
					tree,
					[{path: "src/flip.ts", text: "export const flip = (on: boolean): boolean => !on;\n"}],
					"A change",
				);
				const tests = yield* TestsWork;
				return yield* tests.kill({
					commit,
					mutant: MUTANT,
					file: "src/flip.test.ts",
					test: "flips",
				});
			}).pipe(Effect.provide(Layer.provideMerge(laneTestsWork, Layer.merge(work, runner)))),
		);
		return {result, spans: asks.map((ask) => ask.spans)};
	};

	it("asks for the mutant's own line, and a mutant still surviving there answers green", async () => {
		const {result, spans} = await killed([MUTANT]);
		expect(spans).toEqual([[{file: "src/flip.ts", from: 7, to: 7}]]);
		expect(result).toBe("green");
	});

	it("a mutant no longer surviving answers red", async () => {
		expect((await killed([])).result).toBe("red");
	});
});

// Self-fix PR 4: code runs `[build] checks` after every build. A repository whose settings name
// none has nothing that says a head holds, so the checks are not run, never green.
describe("code's checks, as the repository's settings name them", () => {
	let dir: string;
	beforeEach(() => {
		dir = realpathSync(mkdtempSync(join(tmpdir(), "lane-checks-")));
	});
	afterEach(() => rmSync(dir, {recursive: true, force: true}));

	/** The fixture's real lane work, with `change` made to it. */
	const workWith = (change: (work: LaneWork["Service"]) => LaneWork["Service"]) => {
		const {home, seed} = makeLaneHome({dir, nodeModules: join(dir, "no-modules")});
		const real = laneWork.pipe(
			Layer.provide(Layer.succeed(LaneHome, {home, checkout: seed, briefs: "", person: "owner"})),
		);
		return Layer.effect(
			LaneWork,
			Effect.gen(function* () {
				return change(yield* LaneWork);
			}),
		).pipe(Layer.provide(real));
	};
	/** Code's checks at ticket 1's base, over `work`. */
	const checkedOver = (work: Layer.Layer<LaneWork>) =>
		Effect.runPromise(
			Effect.gen(function* () {
				const {base} = yield* (yield* LaneWork).tree(1);
				return yield* (yield* CheckRunner).run(base);
			}).pipe(Effect.provide(Layer.provideMerge(laneCheckRunner, work))),
		);
	/** The settings' `[build]` table, as `change` makes it. */
	type Build = NonNullable<Settings["build"]>;
	const buildWith =
		(change: (build: Build) => Build) =>
		(work: LaneWork["Service"]): LaneWork["Service"] => ({
			...work,
			settings: Effect.map(work.settings, (s) => ({...s, build: change(s.build ?? {})})),
		});

	it("are not_run when the settings name no `[build] checks`", async () => {
		// The fixture's own settings, with `[build] checks` left out.
		const checked = await checkedOver(workWith(buildWith(({checks: _, ...build}) => build)));
		expect(checked).toMatchObject({commands: [], result: "not_run", failed: []});
	});

	// The PR 4 review: a hung command ends at `[build] checks_within`, as the settings say it.
	it(
		"end a command that runs past `[build] checks_within` as not_run that says it timed out",
		{timeout: 60_000},
		async () => {
			const started = Date.now();
			const checked = await checkedOver(
				workWith(buildWith((build) => ({...build, checks: [["sleep", "20"]], checks_within: 1}))),
			);
			expect(Date.now() - started).toBeLessThan(15_000);
			expect(checked).toMatchObject({result: "not_run", failed: []});
			expect(checked.tail).toMatch(/timed out/);
		},
	);

	// The PR 4 review: what git or an install says when a copy or the settings fail goes on a
	// public ticket. A home path in it shows as `~`, and a key in it is cut.
	describe("say no home path and no key when", () => {
		const mine = join(homedir(), "code", "acme");
		const key = `ghp_${"Ab3".repeat(12)}`;
		const says = `fatal: could not read ${mine}/.git: the remote said ${key}`;
		const failed = {_tag: "unknown", says} as const;

		it.each([
			[
				"the settings could not be read",
				(work: LaneWork["Service"]) => ({...work, settings: Effect.fail(failed)}),
			],
			[
				"the copy of the head could not be made",
				(work: LaneWork["Service"]) => ({...work, worktree: () => Effect.fail(failed)}),
			],
		])("%s", async (_, change) => {
			const checked = await checkedOver(workWith(change));
			expect(checked.result).toBe("not_run");
			expect(checked.tail).toContain("~/code/acme");
			expect(checked.tail).not.toContain(homedir());
			expect(checked.tail).toContain("[key cut]");
			expect(checked.tail).not.toContain(key);
		});
	});
});

// The push stage's push, on real git over a bare remote, and its ticket on a ledger in memory. A push
// that replaces the lane's branch keeps the head it replaces and says so on the ticket: one line a
// replace, each naming its own head (docs/direction/read-fresh-run-alone.md).
describe("the push stage's push of the lane's branch", () => {
	let dir: string;
	beforeEach(() => {
		dir = realpathSync(mkdtempSync(join(tmpdir(), "lane-push-")));
	});
	afterEach(() => rmSync(dir, {recursive: true, force: true}));

	const NUMBER = 1;
	const TICKET = ticketUrlOf(LANE_REPO, NUMBER);
	const OWNER = "user:owner";
	const git = (cwd: string, ...args: readonly string[]) =>
		execFileSync("git", args, {
			cwd,
			encoding: "utf8",
			env: {
				...process.env,
				GIT_AUTHOR_NAME: "person",
				GIT_AUTHOR_EMAIL: "person@fabrika.invalid",
				GIT_COMMITTER_NAME: "person",
				GIT_COMMITTER_EMAIL: "person@fabrika.invalid",
			},
			stdio: "pipe",
		}).trim();
	/** A person's commit on top of the remote's lane branch, pushed from the seed: its sha. */
	const personPushes = (seed: string, text: string) => {
		git(seed, "fetch", "--quiet", "origin");
		git(seed, "checkout", "--quiet", "--detach", `origin/lane/${NUMBER}`);
		writeFileSync(join(seed, "person.md"), text);
		git(seed, "add", "-A");
		git(seed, "commit", "--quiet", "-m", "a person's push");
		git(seed, "push", "--quiet", "origin", `HEAD:refs/heads/lane/${NUMBER}`);
		return git(seed, "rev-parse", "HEAD");
	};
	const fileTicket = Effect.gen(function* () {
		const ledger = yield* Ledger;
		yield* ledger.register(nameOf(NUMBER), OWNER);
		yield* ledger.send(streams(nameOf(NUMBER)).inbox, `file-${NUMBER}`, {
			kind: "filed",
			writer: OWNER,
			data: {type: "filed", title: "Read names in one form", body: "Lower case."},
		});
	});

	it("each push that replaces a person's push posts its own line, naming the head it kept", async () => {
		const {home, seed} = makeLaneHome({dir, nodeModules: join(dir, "no-modules")});
		const work = laneWork.pipe(
			Layer.provide(Layer.succeed(LaneHome, {home, checkout: seed, briefs: "", person: "owner"})),
		);
		const tickets = ticketsOnLedger({kind: "agent", id: "lane", for: "owner"});
		const all = Layer.provideMerge(
			lanePushWork,
			Layer.mergeAll(work, tickets, Layer.mock(LanePulls, {}), Layer.mock(PullWire, {})),
		).pipe(Layer.provideMerge(Layer.fresh(memoryLedger().layer)));
		const {persons, lines} = await Effect.runPromise(
			Effect.gen(function* () {
				yield* fileTicket;
				const lane = yield* LaneWork;
				const push = yield* PushWork;
				const {tree} = yield* lane.tree(NUMBER);
				const commit = (path: string) => lane.commit(tree, [{path, text: `${path}\n`}], path);
				yield* push.push(TICKET, NUMBER, yield* commit("a.md"));
				const persons: string[] = [];
				for (const path of ["b.md", "c.md"]) {
					persons.push(yield* Effect.sync(() => personPushes(seed, `before ${path}\n`)));
					yield* push.push(TICKET, NUMBER, yield* commit(path));
				}
				const ticket = yield* (yield* Tickets).read(NUMBER);
				const lines = factsOf(ticket.timeline, "commented")
					.map((c) => String(c.body))
					.filter((body) => body.includes("refs/kept/"));
				return {persons, lines};
			}).pipe(Effect.provide(all)),
		);
		expect(lines, "one line a replace").toHaveLength(2);
		expect(lines[0]).toContain(persons[0]);
		expect(lines[1]).toContain(persons[1]);
	});
});
