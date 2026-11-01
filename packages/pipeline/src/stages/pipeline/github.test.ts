import {execFileSync} from "node:child_process";
import {mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {fileURLToPath} from "node:url";
import {layer as nodeServices} from "@effect/platform-node/NodeServices";
import {Ledger, streams} from "@kampus/fabrika-old";
import {Effect, Layer, Option, Schema, Stream} from "effect";
import {afterEach, describe, expect, it, vi} from "vitest";
import {memoryLedger} from "../../asks/ledger.ts";
import {checksOf, codeHostOn, type Gh} from "../../code-host-github.ts";
import {CodeHost} from "../../services.ts";
import {nameOf} from "../../tickets/ticket.ts";
import {ghOn, markerOf} from "../operate/writes.ts";
import {reviewsOf, type PrFacts} from "../ship/facts.ts";
import {createdUrl, laneFactsOver, openArgs} from "./github.ts";
import {fakeEnv, type GhStory, LANE_REPO, makeFakeGh, makeLaneHome} from "./lane-fixture.ts";
import {laneLayer} from "./layer.ts";
import {examTicket, LanePulls, type Pull, pullFacts, pullUrl, PullWire} from "./pulls.ts";
import {LaneWork, rubricsFolder} from "./work.ts";

// Today's version. The parts of the GitHub host that can be read with no GitHub, then the host itself
// over a stand-in `gh` (fixtures/pipeline-lane/gh.mjs). It has never run against real GitHub, and
// nothing here touches it.

const FACTS: PrFacts = {
	head: "h",
	state: "open",
	ours: false,
	ticket: "none",
	approval: "given",
	reviews: null,
	checks: "green",
	mergeable: "clean",
	comments: [],
	main: {tested: "m", tip: "m"},
};
const PULL: Pull = {
	id: "https://github.invalid/o/r/pull/9",
	kind: "lane",
	ticket: 7,
	branch: "lane/7",
	head: "h",
	tree: "t",
	state: "open",
	title: "t",
	body: "b",
	verdicts: [],
};
const PASSED: Pull = {...PULL, verdicts: [{kind: "review-code", verdict: "pass"}]};

describe("what GitHub says, under the lane's own facts", () => {
	it("an approval on GitHub is not the person's yes", () => {
		expect(laneFactsOver(FACTS, PULL, "o/r", false).approval).toBe("missing");
		expect(laneFactsOver(FACTS, PULL, "o/r", true).approval).toBe("given");
	});

	it("the ticket is the one the lane kept, not one a pull request's text names", () => {
		const read = laneFactsOver(
			{...FACTS, ticket: {id: "o/r#99", link: "closes_it"}},
			PULL,
			"o/r",
			true,
		);
		expect(read.ticket).toEqual({id: "o/r#7", link: "closes_it"});
	});

	it("keeps what only GitHub knows", () => {
		const read = laneFactsOver(
			{...FACTS, checks: "red", mergeable: "conflicts"},
			PULL,
			"o/r",
			true,
		);
		expect(read).toMatchObject({checks: "red", mergeable: "conflicts", head: "h"});
	});

	it("opens on the lane's branch, into main, in the repo the home names", () => {
		const args = openArgs("o/r", {branch: "lane/7", title: "T", body: "B"});
		expect(args.slice(0, 2)).toEqual(["pr", "create"]);
		expect(args).toContain("--head");
		expect(args[args.indexOf("--head") + 1]).toBe("lane/7");
		expect(args[args.indexOf("--repo") + 1]).toBe("o/r");
	});
});

describe("what `gh pr create` answers", () => {
	const URL_IN_REPO = "https://github.com/o/r/pull/9";

	it("is the new pull request's url", () => {
		expect(createdUrl("o/r", `${URL_IN_REPO}\n`)).toBe(URL_IN_REPO);
	});

	// Nothing shows `gh` prints anything above the url on stdout. This only holds what is read: the last line.
	it("reads its last line, whatever comes above it", () => {
		expect(createdUrl("o/r", `words above\n${URL_IN_REPO}\n\n`)).toBe(URL_IN_REPO);
	});

	it("compares the owner and the name without case, as GitHub does", () => {
		const url = "https://github.com/O/R/pull/9";
		expect(createdUrl("o/r", `${url}\n`)).toBe(url);
		expect(createdUrl("O/R", `${URL_IN_REPO}\n`)).toBe(URL_IN_REPO);
	});

	it.each([
		["nothing", ""],
		["words", "not a url\n"],
		["a url with no pull request in it", "https://github.com/o/r\n"],
		["a pull request with no number", "https://github.com/o/r/pull/x\n"],
		["a number with more after it", "https://github.com/o/r/pull/9x\n"],
		["a pull request's page", "https://github.com/o/r/pull/9/files\n"],
		["a pull request with a query", "https://github.com/o/r/pull/9?x=1\n"],
		["a pull request in another repository", "https://github.com/o/other/pull/9\n"],
		["another site with the path in its own", "https://evil.example/github.com/o/r/pull/9\n"],
		["another site's name around github's", "https://github.com.evil.example/o/r/pull/9\n"],
		["no tls", "http://github.com/o/r/pull/9\n"],
		["spaces before the url", `  ${URL_IN_REPO}\n`],
		["words on the line of the url", `see ${URL_IN_REPO}\n`],
		["a name that only folds to this one", "https://github.com/o/K/pull/9\n"],
		["words after the url", `${URL_IN_REPO}\nand then something broke\n`],
	])("is refused when it is %s", (_name, out) => {
		expect(createdUrl("o/r", out)).toBeNull();
	});
});

describe("the lane's verdicts count, on both hosts", () => {
	it("a verdict the lane posted counts, with no reviewers list and no GitHub approval", () => {
		// What GitHub's reader answers with no reviewers: every kind it needs reads missing.
		const github: PrFacts = {...FACTS, reviews: [{kind: "review-code", verdict: "missing"}]};
		const read = laneFactsOver(github, PASSED, "o/r", true);
		expect(read.reviews).toEqual([{kind: "review-code", verdict: "passed"}]);
		expect(reviewsOf(read.reviews)).toBe("passed");
	});

	it("a verdict that failed stays failed", () => {
		const read = laneFactsOver(
			FACTS,
			{...PULL, verdicts: [{kind: "review-code", verdict: "fail"}]},
			"o/r",
			true,
		);
		expect(read.reviews).toEqual([{kind: "review-code", verdict: "failed"}]);
	});

	it("no verdict posted yet is not known, and never passed", () => {
		const github: PrFacts = {...FACTS, reviews: [{kind: "review-code", verdict: "passed"}]};
		expect(laneFactsOver(github, PULL, "o/r", true).reviews).toBeNull();
	});

	it("a verdict for another head does not count on the head GitHub now has", () => {
		// The local host has one head. GitHub's can move: a person pushed after the lane posted.
		const read = laneFactsOver({...FACTS, head: "someone-pushed"}, PASSED, "o/r", true);
		expect(read.reviews).toEqual([{kind: "review-code", verdict: "missing"}]);
	});

	it("a verdict for another head reads missing on every row, not only the first", () => {
		const both: Pull = {
			...PULL,
			verdicts: [
				{kind: "review-code", verdict: "pass"},
				{kind: "review-doc", verdict: "fail"},
			],
		};
		const read = laneFactsOver({...FACTS, head: "someone-pushed"}, both, "o/r", true);
		expect(read.reviews).toEqual([
			{kind: "review-code", verdict: "missing"},
			{kind: "review-doc", verdict: "missing"},
		]);
	});

	it("one pure function holds the rule, and it is what the GitHub host lays over", () => {
		const own = pullFacts(PASSED, "o/r", true);
		expect(own).toEqual({
			ours: true,
			ticket: {id: "o/r#7", link: "closes_it"},
			approval: "given",
			reviews: [{kind: "review-code", verdict: "passed"}],
		});
		expect(laneFactsOver(FACTS, PASSED, "o/r", true)).toMatchObject(own);
	});
});

describe("the exam's pull request", () => {
	const EXAM: Pull = {...PULL, kind: "exam", branch: "exam/7"};

	it("is part of the ticket, under the exam's own ticket id, on both hosts", () => {
		const own = pullFacts(EXAM, "o/r", true);
		expect(own.ticket).toEqual({id: examTicket("o/r", 7), link: "part_of_it"});
		expect(laneFactsOver(FACTS, EXAM, "o/r", true).ticket).toEqual(own.ticket);
	});

	it("reads as a passed governance review: a person's answer is its one criterion", () => {
		expect(pullFacts(EXAM, "o/r", false).reviews).toEqual([
			{kind: "governance", verdict: "passed"},
		]);
		expect(laneFactsOver(FACTS, EXAM, "o/r", false).reviews).toEqual([
			{kind: "governance", verdict: "passed"},
		]);
	});

	it("still needs the person's yes", () => {
		expect(laneFactsOver(FACTS, EXAM, "o/r", false).approval).toBe("missing");
		expect(laneFactsOver(FACTS, EXAM, "o/r", true).approval).toBe("given");
	});
});

describe("how checks stand when nothing is required", () => {
	/** One check that is not required. `conclusion: null`: still running. */
	const rollup = (conclusion: string | null): Parameters<typeof checksOf>[0] => ({
		contexts: {
			pageInfo: {hasNextPage: false},
			nodes: [
				{
					__typename: "CheckRun",
					name: "ci",
					status: conclusion === null ? "IN_PROGRESS" : "COMPLETED",
					conclusion,
					isRequired: false,
				},
			],
		},
	});

	it("zero required checks never read green: they read pending, whatever the others did", () => {
		for (const conclusion of ["SUCCESS", "FAILURE", null]) {
			expect(checksOf(rollup(conclusion), "required")).toEqual({
				state: "pending",
				required: [],
			});
		}
	});

	it("counting every check, one running waits, one failed is red, and all done is green", () => {
		expect(checksOf(rollup(null), "every").state).toBe("pending");
		expect(checksOf(rollup("FAILURE"), "every").state).toBe("red");
		expect(checksOf(rollup("SUCCESS"), "every").state).toBe("green");
	});

	it("no check reported is pending, under either count", () => {
		expect(checksOf(null, "every").state).toBe("pending");
		expect(checksOf(null, "required").state).toBe("pending");
	});
});

describe("which rubrics judge a change", () => {
	const PLACES = {main: "/work/copies/tip", shipped: "/fabrika/rubrics"};

	it("a folder the file names is read from main's tip, never from the head", () => {
		expect(rubricsFolder("docs/rubrics", PLACES)).toBe("/work/copies/tip/docs/rubrics");
	});

	it("left out, the lane uses the rubrics fabrika ships", () => {
		expect(rubricsFolder(undefined, PLACES)).toBe("/fabrika/rubrics");
	});
});

describe("the url a window shows", () => {
	it("a real one stays, and a local one says it is local", () => {
		expect(pullUrl("https://github.invalid/o/r/pull/9")).toBe("https://github.invalid/o/r/pull/9");
		expect(pullUrl("local:o/r/pull/9")).toBe("https://local.invalid/o/r/pull/9");
	});
});

// ---------------------------------------------------------------- over the stand-in `gh`

const MODULES = fileURLToPath(new URL("../../../node_modules", import.meta.url));
const FIXTURE = (name: string) =>
	readFileSync(new URL(`../../../../../fixtures/code-host/${name}.json`, import.meta.url), "utf8");
const NUMBER = 7;
const IDENTITY = {
	GIT_AUTHOR_NAME: "fixture",
	GIT_AUTHOR_EMAIL: "fixture@fabrika.invalid",
	GIT_COMMITTER_NAME: "fixture",
	GIT_COMMITTER_EMAIL: "fixture@fabrika.invalid",
};

const RUNNING_THEN = (ends: "SUCCESS" | "FAILURE"): GhStory => ({
	checks: [{name: "ci", ends}],
});

describe("the GitHub host, over a stand-in gh", () => {
	const dirs: string[] = [];
	afterEach(() => {
		vi.unstubAllEnvs();
		for (const dir of dirs.splice(0)) rmSync(dir, {recursive: true, force: true});
	});

	/** The toy repository, a stand-in `gh` first on the path, and no login in reach. */
	const scene = ({story = {}, github}: {story?: GhStory; github?: "required" | "none"}) => {
		const dir = realpathSync(mkdtempSync(join(tmpdir(), "lane-gh-")));
		dirs.push(dir);
		const home = makeLaneHome({
			dir,
			nodeModules: MODULES,
			host: "github",
			...(github === undefined ? {} : {github}),
		});
		const fake = makeFakeGh({dir, remote: home.remote, story});
		for (const [key, value] of Object.entries({...fakeEnv(dir), ...fake.env}))
			vi.stubEnv(key, value);
		return {...home, fake};
	};

	/** One real pull request on the stand-in: a real commit, pushed, opened and kept as the lane does. */
	const opened = (files: readonly {path: string; text: string}[]) =>
		Effect.gen(function* () {
			const ledger = yield* Ledger;
			const writer = "user:owner";
			yield* ledger.register(nameOf(NUMBER), writer);
			yield* ledger.send(streams(nameOf(NUMBER)).inbox, `file-${NUMBER}`, {
				kind: "filed",
				writer,
				data: {type: "filed", title: "A change", body: "It changes one thing."},
			});
			const work = yield* LaneWork;
			const tree = yield* work.tree(NUMBER);
			const head = yield* work.commit(tree.tree, files, "A change");
			yield* work.pushTo(tree.tree, head, tree.branch);
			const pull = {branch: tree.branch, title: "A change", body: "From tracker ticket 7."};
			const known = yield* (yield* PullWire).open(pull);
			const pr = yield* (yield* LanePulls).open(
				{...pull, kind: "lane", ticket: NUMBER, head, tree: tree.tree},
				known ?? undefined,
			);
			return {pr, head};
		});

	const A_FILE = [{path: "src/a.ts", text: "export const a = 1;\n"}];

	const run = <A, E>(
		home: string,
		effect: Effect.Effect<A, E, Layer.Success<ReturnType<typeof laneLayer>> | Ledger>,
	) =>
		Effect.runPromise(
			effect.pipe(
				Effect.provide(laneLayer({home, briefs: "", person: "owner"})),
				Effect.provide(Layer.fresh(memoryLedger().layer)),
			),
		);

	describe("the stand-in itself", () => {
		it("is the gh the lane's own call reaches, and it writes each call down", async () => {
			const {fake} = scene({});
			const gh = await Effect.runPromise(ghOn.pipe(Effect.provide(nodeServices)));
			const said = await Effect.runPromise(
				Effect.result(gh(["api", `repos/${LANE_REPO}/git/ref/heads/main`])),
			);
			expect(said._tag).toBe("Success");
			expect(fake.calls().map((c) => c.kind)).toEqual(["ref_read"]);
			expect(execFileSync("sh", ["-c", "command -v gh"], {encoding: "utf8"}).trim()).toBe(fake.gh);
		});

		it.each([
			["a command it does not know", ["pr", "view", "1"]],
			["a pr list with no flags", ["pr", "list"]],
			["a query it does not know", ["api", "graphql", "-f", "query=query { viewer { login } }"]],
			["a route it does not know", ["api", `repos/${LANE_REPO}/issues/1`]],
			["a comments read with no page size", ["api", `repos/${LANE_REPO}/issues/1/comments`]],
			["another repository", ["api", "repos/example/other/branches/main"]],
			["a flag it does not know", ["api", `repos/${LANE_REPO}/branches/main`, "--paginate"]],
			["a merge by `gh pr merge`", ["pr", "merge", "1", "--admin"]],
		])("fails %s, and writes it down", async (_name, args) => {
			const {fake} = scene({});
			const gh = await Effect.runPromise(ghOn.pipe(Effect.provide(nodeServices)));
			const said = await Effect.runPromise(Effect.result(gh(args)));
			expect(said._tag).toBe("Failure");
			expect(fake.calls().map((c) => c.kind)).toEqual(["unknown"]);
		});

		it("answers the facts query in the shape of a recorded answer", async () => {
			const {home, fake} = scene({story: RUNNING_THEN("SUCCESS")});
			const seen: {args: readonly string[]; out: string}[] = [];
			const answer = await run(
				home,
				Effect.gen(function* () {
					const {pr} = yield* opened(A_FILE);
					const gh = yield* ghOn;
					const watching: Gh = (args) =>
						gh(args).pipe(Effect.tap((out) => Effect.sync(() => void seen.push({args, out}))));
					yield* gh([
						"api",
						"--method",
						"POST",
						`repos/${LANE_REPO}/issues/1/comments`,
						"-f",
						`body=${markerOf({pr, head: "abc", kind: "review-code", verdict: "pass", reason: "fine", text: ""})}`,
					]);
					yield* codeHostOn(watching, {own: [], reviewers: []}).prFacts(pr);
					return seen.find((c) => c.args.some((a) => a.startsWith("codeowners=")))?.out ?? "";
				}),
			);
			const shape = (value: unknown): unknown =>
				Array.isArray(value)
					? value.slice(0, 1).map(shape)
					: value !== null && typeof value === "object"
						? Object.fromEntries(
								Object.entries(value)
									.sort(([a], [b]) => a.localeCompare(b))
									.map(([key, kept]) => [key, shape(kept)]),
							)
						: typeof value;
			const pullIn = Schema.decodeUnknownSync(
				Schema.fromJsonString(
					Schema.Struct({
						data: Schema.Struct({repository: Schema.Struct({pullRequest: Schema.Unknown})}),
					}),
				),
			);
			expect(shape(pullIn(answer).data.repository.pullRequest)).toEqual(
				shape(pullIn(FIXTURE("open-clean")).data.repository.pullRequest),
			);
			expect(fake.calls().filter((c) => c.kind === "unknown")).toEqual([]);
		});

		it("refuses a second pull request on a branch that has one, as GitHub does", async () => {
			const {home, fake} = scene({});
			const twice = await run(
				home,
				Effect.gen(function* () {
					yield* opened(A_FILE);
					const gh = yield* ghOn;
					return yield* Effect.result(
						gh(openArgs(LANE_REPO, {branch: "lane/7", title: "Again", body: "Again."})),
					);
				}),
			);
			expect(twice._tag).toBe("Failure");
			expect(fake.calls().at(-1)).toMatchObject({kind: "pr_create", refused: true});
		});
	});

	describe("a kill between GitHub opening a pull request and the lane writing it down", () => {
		/** Pushed, and told to open: what a resumed lane does when the row was never written. */
		const asked = (branch: string) => {
			const pull = {branch, title: "A change", body: "It changes one thing."};
			return Effect.gen(function* () {
				return yield* (yield* PullWire).open(pull);
			});
		};

		it("finds the one it opened and uses it, and does not ask again", async () => {
			const {home, fake} = scene({});
			const {first, second} = await run(
				home,
				Effect.gen(function* () {
					const work = yield* LaneWork;
					const tree = yield* work.tree(NUMBER);
					const head = yield* work.commit(tree.tree, A_FILE, "A change");
					yield* work.pushTo(tree.tree, head, tree.branch);
					const first = yield* asked(tree.branch);
					return {first, second: yield* asked(tree.branch)};
				}),
			);
			expect(first).toBe(`https://github.com/${LANE_REPO}/pull/1`);
			expect(second).toBe(first);
			expect(fake.calls().map((c) => c.kind)).toEqual(["pr_list", "pr_create", "pr_list"]);
			expect(fake.calls().filter((c) => c.refused)).toEqual([]);
		});

		it("asks by the branch, for open pull requests into main", async () => {
			const {home, fake} = scene({});
			await run(
				home,
				Effect.gen(function* () {
					const work = yield* LaneWork;
					const tree = yield* work.tree(NUMBER);
					const head = yield* work.commit(tree.tree, A_FILE, "A change");
					yield* work.pushTo(tree.tree, head, tree.branch);
					return yield* asked(tree.branch);
				}),
			);
			const list = fake.calls().find((c) => c.kind === "pr_list");
			const flag = (name: string) => list?.args[(list?.args.indexOf(name) ?? 0) + 1];
			expect(list?.args.slice(0, 2)).toEqual(["pr", "list"]);
			expect(flag("--repo")).toBe(LANE_REPO);
			expect(flag("--head")).toBe("lane/7");
			expect(flag("--base")).toBe("main");
			expect(flag("--state")).toBe("open");
		});

		it("does not take a fork's pull request on a branch of the same name for its own", async () => {
			const {home} = scene({story: {forkOn: "lane/7"}});
			const said = await run(
				home,
				Effect.gen(function* () {
					const work = yield* LaneWork;
					const tree = yield* work.tree(NUMBER);
					const head = yield* work.commit(tree.tree, A_FILE, "A change");
					yield* work.pushTo(tree.tree, head, tree.branch);
					return yield* asked(tree.branch);
				}),
			);
			expect(said).toBe(`https://github.com/${LANE_REPO}/pull/1`);
		});
	});

	describe("an answer `gh pr create` should not have given", () => {
		it.each(["not a url\n", `https://github.com/example/other/pull/1\n`])(
			"fails, and says what it answered: %j",
			async (createSays) => {
				const {home} = scene({story: {createSays}});
				const got = await run(
					home,
					Effect.gen(function* () {
						const work = yield* LaneWork;
						const tree = yield* work.tree(NUMBER);
						const head = yield* work.commit(tree.tree, A_FILE, "A change");
						yield* work.pushTo(tree.tree, head, tree.branch);
						return yield* Effect.result(
							(yield* PullWire).open({branch: tree.branch, title: "T", body: "B"}),
						);
					}),
				);
				if (got._tag === "Success") throw new Error(`took ${got.success} for a pull request`);
				expect(got.failure.says).toContain("gh pr create");
				expect(got.failure.says).toContain(createSays.trim());
			},
		);
	});

	describe("a pull request once it has merged", () => {
		/** The ref move a merge on a branch with no rules makes, here by hand. */
		const moved = (head: string) =>
			Effect.gen(function* () {
				const gh = yield* ghOn;
				yield* gh([
					"api",
					"--method",
					"PATCH",
					`repos/${LANE_REPO}/git/refs/heads/main`,
					"-f",
					`sha=${head}`,
					"-F",
					"force=false",
				]);
			});

		it("the facts say merged: its row says so, and the branch has no open one", async () => {
			const {home} = scene({});
			const got = await run(
				home,
				Effect.gen(function* () {
					const {pr, head} = yield* opened(A_FILE);
					yield* moved(head);
					const facts = yield* (yield* CodeHost).prFacts(pr);
					const pulls = yield* LanePulls;
					return {
						facts: facts.state,
						row: (yield* pulls.find(pr)).state,
						on: yield* pulls.onBranch("lane/7"),
					};
				}),
			);
			expect(got).toEqual({facts: "merged", row: "merged", on: null});
		});

		it("a new head on that branch is a new pull request, and never reads as landed", async () => {
			const {home, fake} = scene({});
			const got = await run(
				home,
				Effect.gen(function* () {
					const {pr, head} = yield* opened(A_FILE);
					yield* moved(head);
					const host = yield* CodeHost;
					yield* host.prFacts(pr);
					const again = yield* opened([{path: "src/b.ts", text: "export const b = 1;\n"}]);
					return {pr, again: again.pr, state: (yield* host.prFacts(again.pr)).state};
				}),
			);
			expect(got.again).not.toBe(got.pr);
			expect(got.state).toBe("open");
			expect(fake.pulls().map((p) => p.state)).toEqual(["MERGED", "OPEN"]);
		});
	});

	describe("[checks] github, read when a call needs it", () => {
		const standing = (home: string) =>
			run(
				home,
				Effect.gen(function* () {
					const {pr} = yield* opened(A_FILE);
					return (yield* (yield* CodeHost).prFacts(pr)).checks;
				}),
			);

		it("left out, every check counts: one that passed is green", async () => {
			const {home} = scene({story: RUNNING_THEN("SUCCESS")});
			expect(await standing(home)).toBe("green");
		});

		it("left out, one that failed is red", async () => {
			const {home} = scene({story: RUNNING_THEN("FAILURE")});
			expect(await standing(home)).toBe("red");
		});

		it("left out, one still running waits", async () => {
			const {home} = scene({story: {...RUNNING_THEN("SUCCESS"), settleAfter: 1}});
			expect(await standing(home)).toBe("pending");
		});

		it("required: reads as every does, one that failed is red", async () => {
			const {home} = scene({github: "required", story: RUNNING_THEN("FAILURE")});
			expect(await standing(home)).toBe("red");
		});

		it("a file changed on main between two calls is read by the second", async () => {
			const {home, seed} = scene({story: RUNNING_THEN("FAILURE")});
			const git = (...args: readonly string[]) =>
				execFileSync("git", args, {cwd: seed, env: {...process.env, ...IDENTITY}, stdio: "pipe"});
			const {first, second} = await run(
				home,
				Effect.gen(function* () {
					const {pr} = yield* opened(A_FILE);
					const host = yield* CodeHost;
					const first = yield* host.prFacts(pr);
					const file = join(seed, ".fabrika/fabrika.toml");
					writeFileSync(
						file,
						readFileSync(file, "utf8").replace(
							"[[checks.run]]",
							'[checks]\ngithub = "none"\n\n[[checks.run]]',
						),
					);
					git("add", "-A");
					git("commit", "--quiet", "-m", "GitHub's checks do not count here.");
					git("push", "--quiet", "origin", "main");
					return {first, second: yield* host.prFacts(pr)};
				}),
			);
			expect(first.checks).toBe("red");
			// GitHub's red no longer counts, and the repo's own checks have not run at this head yet.
			expect(second.checks).toBe("pending");
		});

		it("none: a head a person moved reads pending, whatever the pushed head's checks said", async () => {
			const {home} = scene({github: "none"});
			const {before, after} = await run(
				home,
				Effect.gen(function* () {
					const {pr} = yield* opened(A_FILE);
					const host = yield* CodeHost;
					yield* host
						.checksSettled(pr, (yield* (yield* LanePulls).find(pr)).head, [])
						.pipe(Stream.take(1), Stream.runDrain);
					const before = (yield* host.prFacts(pr)).checks;
					// The branch moves on GitHub, and the lane's row still names what it pushed.
					const work = yield* LaneWork;
					const tree = yield* work.tree(NUMBER);
					const moved = yield* work.commit(
						tree.tree,
						[{path: "src/moved.ts", text: "export const moved = 1;\n"}],
						"A person's commit",
					);
					yield* work.pushTo(tree.tree, moved, tree.branch);
					return {before, after: (yield* host.prFacts(pr)).checks};
				}),
			);
			// Green at the head the checks ran on proves the next line is about the move.
			expect(before).toBe("green");
			expect(after).toBe("pending");
		});

		it("a pull request's change is not read from GitHub: only a plan's book has one", async () => {
			const {home, fake} = scene({});
			const got = await run(
				home,
				Effect.gen(function* () {
					const {pr, head} = yield* opened(A_FILE);
					const before = fake.calls().length;
					const said = yield* Effect.result((yield* CodeHost).change(pr, head));
					return {tag: said._tag, asked: fake.calls().length - before};
				}),
			);
			expect(got).toEqual({tag: "Failure", asked: 0});
		});

		const settledThenFacts = (home: string, files: readonly {path: string; text: string}[]) =>
			run(
				home,
				Effect.gen(function* () {
					const {pr, head} = yield* opened(files);
					const host = yield* CodeHost;
					// The real wait polls every 30 seconds, so one that never ends says so here, and soon.
					const waited = yield* host
						.checksSettled(pr, head, [])
						.pipe(Stream.take(1), Stream.runDrain, Effect.timeoutOption("20 seconds"));
					if (Option.isNone(waited)) return "the wait never ended";
					return (yield* host.prFacts(pr)).checks;
				}),
			);

		it("none: GitHub's red does not count, and the head's own checks decide", async () => {
			const {home, fake} = scene({github: "none", story: RUNNING_THEN("FAILURE")});
			expect(await settledThenFacts(home, A_FILE)).toBe("green");
			expect(fake.calls().map((c) => c.kind)).not.toContain("checks_now");
		});

		it("none: no check on GitHub at all, and the wait does not hang on it", async () => {
			const {home, fake} = scene({github: "none"});
			expect(await settledThenFacts(home, A_FILE)).toBe("green");
			expect(fake.calls().map((c) => c.kind)).not.toContain("checks_now");
		});

		it("none: the head's own red is red, however green GitHub is", async () => {
			const {home} = scene({github: "none", story: RUNNING_THEN("SUCCESS")});
			const failing = [
				...A_FILE,
				{
					path: "src/a.test.ts",
					text: 'import {expect, it} from "vitest";\n\nit("fails", () => {\n\texpect(1).toBe(2);\n});\n',
				},
			];
			expect(await settledThenFacts(home, failing)).toBe("red");
		});
	});
});
