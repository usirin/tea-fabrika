import {execFileSync} from "node:child_process";
import {
	appendFileSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {Ledger, streams} from "@kampus/fabrika-old";
import {Effect, Layer} from "effect";
import {afterEach, beforeEach, describe, expect, it} from "vitest";
import {memoryLedger} from "../../asks/ledger.ts";
import {factsOf, nameOf} from "../../tickets/ticket.ts";
import {Tickets, ticketsOnLedger} from "../../tickets/tickets.ts";
import {BuildWrites} from "../build/services.ts";
import {LaneNow, laneNow} from "./agents.ts";
import {formatExam, NO_FORMATTER} from "./format.ts";
import {ticketUrlOf} from "./hosts.ts";
import {LANE_REPO, makeLaneHome} from "./lane-fixture.ts";
import {laneBuildWrites} from "./tools.ts";
import {LaneHome, LaneWork, laneWork} from "./work.ts";

// Today's version. The exam's own format commit before a build round (./format.ts), and the builder's
// files through the formatter before the build's commit (./tools.ts). Real git on a bare remote, the
// toy repository's own formatter. Self-fix PR 1. ./tools.format.test.ts and ./program.format.test.ts
// hold the test writer's cases; these are the two the plan left without one, and how a formatter that
// fails is seen.

/** Each leading pair of spaces becomes a tab, in place, as `node oxlint-plugins/format.ts` would. */
const FORMATTER = {
	path: "fmt.mjs",
	text: [
		'import {readFileSync, writeFileSync} from "node:fs";',
		"for (const file of process.argv.slice(2))",
		'\twriteFileSync(file, readFileSync(file, "utf8").replace(/^(?: {2})+/gm, (s) => "\\t".repeat(s.length / 2)));',
		"",
	].join("\n"),
};
/** Formats the files it is given, then fails, as oxfmt does when one of them does not parse. */
const FAILS = {
	path: "fails.mjs",
	text: [
		'import {readFileSync, writeFileSync} from "node:fs";',
		"for (const file of process.argv.slice(2))",
		'\twriteFileSync(file, readFileSync(file, "utf8").replace(/^(?: {2})+/gm, (s) => "\\t".repeat(s.length / 2)));',
		'process.stderr.write("x Expected `}` but found `EOF`\\n");',
		"process.exit(2);",
		"",
	].join("\n"),
};

const EXAM = "src/lower.test.ts";
const SPACES = 'it("lowers", () => {\n  expect(lower("AB")).toBe("ab");\n});\n';
const TABS = 'it("lowers", () => {\n\texpect(lower("AB")).toBe("ab");\n});\n';
const NUMBER = 1;
const TICKET = ticketUrlOf(LANE_REPO, NUMBER);
const OWNER = "user:owner";

const IDENTITY = {
	GIT_AUTHOR_NAME: "fixture",
	GIT_AUTHOR_EMAIL: "fixture@fabrika.invalid",
	GIT_COMMITTER_NAME: "fixture",
	GIT_COMMITTER_EMAIL: "fixture@fabrika.invalid",
};

const gitIn =
	(cwd: string) =>
	(...args: readonly string[]) =>
		execFileSync("git", args, {
			cwd,
			encoding: "utf8",
			env: {...process.env, ...IDENTITY},
			stdio: "pipe",
		}).trim();

/** Main names `run` as its formatter, pushed as a commit of its own. */
const nameFormatter = (seed: string, run: readonly string[]) => {
	appendFileSync(
		join(seed, ".fabrika", "fabrika.toml"),
		`\n[format]\nrun = ${JSON.stringify(run)}\n`,
	);
	const git = gitIn(seed);
	git("add", "-A");
	git("commit", "--quiet", "-m", "name the formatter");
	git("push", "--quiet", "origin", "main");
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

/** What the ticket says, oldest first. */
const comments = Effect.gen(function* () {
	const ticket = yield* (yield* Tickets).read(NUMBER);
	return factsOf(ticket.timeline, "commented").map((c) => String(c.body));
});

let dir: string;
beforeEach(() => {
	dir = realpathSync(mkdtempSync(join(tmpdir(), "lane-fmt-")));
});
afterEach(() => rmSync(dir, {recursive: true, force: true}));

/** A toy lane: its home, and `run` named as main's formatter, or none. */
const lane = (run: readonly string[] | null) => {
	const {home, seed} = makeLaneHome({
		dir,
		nodeModules: join(dir, "no-modules"),
		mainFiles: [FORMATTER, FAILS],
	});
	if (run !== null) nameFormatter(seed, run);
	const work = laneWork.pipe(
		Layer.provide(Layer.succeed(LaneHome, {home, checkout: seed, briefs: "", person: "owner"})),
	);
	const tickets = ticketsOnLedger({kind: "agent", id: "lane", for: "owner"});
	const all = Layer.provideMerge(laneBuildWrites, Layer.mergeAll(work, tickets, laneNow)).pipe(
		Layer.provideMerge(Layer.fresh(memoryLedger().layer)),
	);
	return <A, E>(
		effect: Effect.Effect<A, E, LaneWork | Tickets | LaneNow | BuildWrites | Ledger>,
	): Promise<A> => Effect.runPromise(Effect.andThen(fileTicket, effect).pipe(Effect.provide(all)));
};

/** The exam file, committed on the ticket's working copy as its writer wrote it. */
const examOnTree = Effect.gen(function* () {
	const work = yield* LaneWork;
	const {tree} = yield* work.tree(NUMBER);
	const head = yield* work.commit(tree, [{path: EXAM, text: SPACES}], "tests, as written");
	return {tree, head};
});

describe("the exam's format commit before a build round", () => {
	it("holds the exam file alone, formatted from the head's text, and the round's base is on it", async () => {
		const run = lane(["node", FORMATTER.path, "{files}"]);
		const {tree, head, formatted, base} = await run(
			Effect.gen(function* () {
				const {tree, head} = yield* examOnTree;
				// What a round the guard turned back leaves in the copy: the exam changed, and a file of its own.
				writeFileSync(join(tree, EXAM), 'it("passes", () => {});\n');
				writeFileSync(join(tree, "src/left.ts"), "export const left = 1;\n");
				const formatted = yield* formatExam(NUMBER, tree, [EXAM]);
				const {base} = yield* (yield* BuildWrites).copy(TICKET, NUMBER);
				return {tree, head, formatted, base};
			}),
		);
		const git = gitIn(tree);
		expect(formatted).not.toBeNull();
		expect(formatted).not.toBe(head);
		expect(git("rev-parse", `${formatted}^`)).toBe(head);
		expect(git("show", "--format=", "--name-only", formatted ?? "")).toBe(EXAM);
		expect(git("show", `${formatted}:${EXAM}`)).toBe(TABS.trim());
		expect(base).toBe(formatted);
		expect(git("status", "--porcelain", "--", "src/left.ts")).toBe("?? src/left.ts");
	});

	it("an exam file already formatted gets no commit", async () => {
		const run = lane(["node", FORMATTER.path, "{files}"]);
		const formatted = await run(
			Effect.gen(function* () {
				const work = yield* LaneWork;
				const {tree} = yield* work.tree(NUMBER);
				yield* work.commit(tree, [{path: EXAM, text: TABS}], "tests, as written");
				return yield* formatExam(NUMBER, tree, [EXAM]);
			}),
		);
		expect(formatted).toBeNull();
	});

	it("a repository that names no formatter gets one line on the ticket saying so, once", async () => {
		const run = lane(null);
		const {head, after, rounds, said} = await run(
			Effect.gen(function* () {
				const work = yield* LaneWork;
				const {tree, head} = yield* examOnTree;
				const rounds = [
					yield* formatExam(NUMBER, tree, [EXAM]),
					yield* formatExam(NUMBER, tree, [EXAM]),
				];
				return {head, after: yield* work.head(tree), rounds, said: yield* comments};
			}),
		);
		expect(rounds).toEqual([null, null]);
		expect(after).toBe(head);
		expect(said).toEqual([NO_FORMATTER]);
	});

	it("a formatter that fails: what it wrote is committed, and the ticket says what it said", async () => {
		const run = lane(["node", FAILS.path, "{files}"]);
		const {tree, formatted, said} = await run(
			Effect.gen(function* () {
				const {tree} = yield* examOnTree;
				const formatted = yield* formatExam(NUMBER, tree, [EXAM]);
				return {tree, formatted, said: yield* comments};
			}),
		);
		expect(gitIn(tree)("show", `${formatted}:${EXAM}`)).toBe(TABS.trim());
		expect(said).toHaveLength(1);
		expect(said[0]).toContain("The formatter failed on the tests");
		expect(said[0]).toContain("ended with 2: x Expected `}` but found `EOF`");
	});

	it("a formatter that cannot start: the files stay as written, and the ticket says so", async () => {
		const run = lane(["no-such-formatter", "{files}"]);
		const {formatted, said} = await run(
			Effect.gen(function* () {
				const {tree} = yield* examOnTree;
				const formatted = yield* formatExam(NUMBER, tree, [EXAM]);
				return {formatted, said: yield* comments};
			}),
		);
		expect(formatted).toBeNull();
		expect(said).toHaveLength(1);
		expect(said[0]).toContain("no-such-formatter {files} ended with -1");
	});
});

describe("the builder's files before the build's commit", () => {
	/** A round: the copy, what the builder writes and takes away in it, and the push. */
	const round = (write: (tree: string) => void) =>
		Effect.gen(function* () {
			const {head} = yield* examOnTree;
			yield* (yield* LaneNow).exam.set([EXAM]);
			const writes = yield* BuildWrites;
			const copied = yield* writes.copy(TICKET, NUMBER);
			yield* Effect.sync(() => write(copied.tree));
			const pushed = yield* writes.push(TICKET, copied, "the build");
			return {tree: copied.tree, head, pushed, said: yield* comments};
		});
	const builds = (tree: string) => {
		writeFileSync(
			join(tree, "src/lower.ts"),
			"export function lower(name: string): string {\n  return name.toLowerCase();\n}\n",
		);
		// A file the builder took away is not handed to the formatter.
		rmSync(join(tree, "src/slug.ts"));
	};

	it("are committed formatted, and a file the builder took away is not formatted", async () => {
		const run = lane(["node", FORMATTER.path, "{files}"]);
		const {tree, head, pushed, said} = await run(round(builds));
		const git = gitIn(tree);
		expect(pushed.changed).toBe(true);
		expect(git("rev-parse", `${pushed.head}^`)).toBe(head);
		expect(git("show", `${pushed.head}:src/lower.ts`)).toBe(
			"export function lower(name: string): string {\n\treturn name.toLowerCase();\n}",
		);
		expect(git("show", "--format=", "--name-only", pushed.head).split("\n").sort()).toEqual([
			"src/lower.ts",
			"src/slug.ts",
		]);
		expect(said).toEqual([]);
	});

	it("a formatter that fails: the change is still committed, and the ticket says what it said", async () => {
		const run = lane(["node", FAILS.path, "{files}"]);
		const {tree, pushed, said} = await run(round(builds));
		expect(readFileSync(join(tree, "src/lower.ts"), "utf8")).toContain("\treturn");
		expect(pushed.changed).toBe(true);
		expect(said).toHaveLength(1);
		expect(said[0]).toContain("The formatter failed on the builder's files");
	});

	it("no formatter named: the builder's files are committed as written, with no line from the push", async () => {
		const run = lane(null);
		const {tree, pushed, said} = await run(round(builds));
		expect(gitIn(tree)("show", `${pushed.head}:src/lower.ts`)).toContain("\n  return");
		expect(said).toEqual([]);
	});
});
