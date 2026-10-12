import {execFileSync} from "node:child_process";
import {cp, mkdir, mkdtemp, readFile, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {fileURLToPath} from "node:url";
import {Effect} from "effect";
import {describe, expect, it} from "vitest";
import {compareSurfaces, statementsOf, surfaceOf} from "./declarations.ts";
import type {FactsPack} from "./facts.ts";
import type {Issue, RawIssue} from "./issue.ts";
import {localPublishedApi} from "./local.ts";
import {PublishedApi} from "./services.ts";
import {type ApiChange, type ApiDiff, namedIn, ruleOnApi, ticketNames} from "./surface.ts";
import type {Command} from "./tests.ts";

const FIXTURE = fileURLToPath(new URL("../fixtures/surface", import.meta.url));
const exportsOf = async () =>
	(JSON.parse(await readFile(join(FIXTURE, "package.json"), "utf8")) as {exports: unknown}).exports;

describe("reading what a package publishes from its declaration files", () => {
	it("splits an emitted file into statements, a block or a semicolon each, strings and all", () => {
		const text =
			'export { a,\n  b as c, } from "./x";\ninterface I {\n  sep: ";{";\n}\ndeclare function f(): void;\n';

		expect(statementsOf(text)).toEqual([
			'export { a, b as c, } from "./x";',
			'interface I { sep: ";{"; }',
			"declare function f(): void;",
		]);
	});

	it("follows re-exports, aliases and stars, and folds a private type into the names that use it", async () => {
		const surface = await surfaceOf(await exportsOf(), join(FIXTURE, "before"));

		// A wildcard subpath names no one file, so it is left out.
		expect([...surface.keys()]).toEqual([".", "./testing"]);
		expect([...(surface.get(".")?.keys() ?? [])].sort()).toEqual([
			"Machine",
			"Shape",
			"aliased",
			"replay",
			"run",
		]);
		expect(surface.get(".")?.get("aliased")).toBe("const helper: (x: number) => number;");
		expect(surface.get(".")?.get("replay")).toBe(
			"function replay<Ctx>(opts: Opts<Ctx>): string; type Opts<Ctx> = { msgs: readonly string[]; ctx: Ctx; };",
		);
		expect(surface.get(".")?.get("run")).toBe(
			"function run(n: number): number; function run(s: string): string;",
		);
	});

	it("names every published difference once, with the subpaths it is in, and nothing that only moved", async () => {
		const exports = await exportsOf();
		const changes = compareSurfaces(
			await surfaceOf(exports, join(FIXTURE, "before")),
			await surfaceOf(exports, join(FIXTURE, "after")),
		);

		expect(changes.map((c) => [c.kind, c.name, c.subpaths])).toEqual([
			["removed", "dropped", ["./testing"]],
			["changed", "expectSame", ["./testing"]],
			// Only the private `Opts` changed; `replay` publishes it, so `replay` changed.
			["changed", "replay", ["."]],
			["added", "ReplayArg", ["."]],
		]);
		expect(changes.find((c) => c.name === "expectSame")).toMatchObject({
			before: "function expectSame(m: Machine, cmd: NoInfer<string>): void;",
			after: "function expectSame(m: Machine, cmd: string): void;",
		});
	});

	it("compares HEAD, emitted once in a fresh copy, with the folder as the builder left it", async () => {
		const dir = await mkdtemp(join(tmpdir(), "tea-fabrika-surface-"));
		const git = (...args: string[]) =>
			execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], {
				cwd: dir,
				encoding: "utf8",
			});
		try {
			await mkdir(join(dir, "pkg"));
			await cp(join(FIXTURE, "package.json"), join(dir, "pkg", "package.json"));
			await cp(join(FIXTURE, "before"), join(dir, "pkg", "types"), {recursive: true});
			git("init", "-q");
			git("add", "-A");
			git("commit", "-q", "-m", "base");
			await rm(join(dir, "pkg", "types"), {recursive: true});
			await cp(join(FIXTURE, "after"), join(dir, "pkg", "types"), {recursive: true});
			// Stands in for the compiler: the package's declarations are already written, in `types/`.
			const emit: Command = ["sh", "-c", 'cp -R types/. "$0"'];
			const diffs = (pkg: string) =>
				Effect.runPromise(
					Effect.gen(function* () {
						const api = yield* PublishedApi;
						return [yield* api.diff(), yield* api.diff()] as const;
					}).pipe(Effect.provide(localPublishedApi(dir, {package: pkg, emit}))),
				);
			const [first, again] = await diffs("pkg");

			expect(first).toMatchObject({kind: "compared", package: "pkg"});
			expect(first.kind === "compared" ? first.changes.map((c) => c.name) : []).toEqual([
				"dropped",
				"expectSame",
				"replay",
				"ReplayArg",
			]);
			expect(again).toEqual(first);
			// The builder's folder is left as it was: only throwaway copies were written to.
			expect(git("status", "--porcelain")).toContain("pkg/types/");

			// A package that is not there is a comparison that did not run, never a failure.
			const [skipped] = await diffs("nowhere");
			expect(skipped).toMatchObject({kind: "skipped"});
		} finally {
			await rm(dir, {recursive: true, force: true});
		}
	});
});

const change = (kind: ApiChange["kind"], name: string): ApiChange => ({
	name,
	subpaths: ["."],
	kind,
	before: kind === "added" ? null : `function ${name}(a: A): void;`,
	after: kind === "removed" ? null : `function ${name}(a?: A): void;`,
});
const compared = (...changes: ApiChange[]): ApiDiff => ({
	kind: "compared",
	package: "packages/tea",
	changes,
});

describe("what a change may do to the published API", () => {
	const issue: Issue = {
		id: "558",
		title: "replay still requires ctx",
		goal: "replay lets a machine with no context leave out ctx",
		body: "",
		criteria: [
			{
				kind: "example",
				id: "default",
				rule: "`replay` hands `init` an empty object",
				file: "src/runtime-types.ts",
				name: "replay",
				uses: [{name: "defineMachine", file: "src/index.ts"}],
				examples: [{call: "replay(m, {}).state", result: "{}"}],
			},
			{
				kind: "unchecked",
				id: "types",
				rule: "`replay` types `ctx` with `CtxArg<Ctx>`",
				files: ["src/runtime-types.ts"],
				about: "type",
				why: "types",
			},
		],
		openDecision: null,
	};

	it("names what the criteria name: their rules, the names they call and use, and what the ticket named", () => {
		// A generic names its head: `CtxArg<Ctx>` names `CtxArg`.
		expect([...namedIn(issue, ["run"])].sort()).toEqual(
			["CtxArg", "ctx", "defineMachine", "init", "replay", "run"].sort(),
		);
	});

	it("names what type snippets import, as it does what examples use; an existing test names nothing beyond its rule", () => {
		const typed: Issue = {
			...issue,
			criteria: [
				{
					kind: "type",
					id: "guard",
					rule: "a machine that reads ctx still needs it",
					files: [],
					uses: [{name: "expectFinalState", file: "src/testing/index.ts"}],
					snippets: [
						{
							expect: "rejects",
							today: "holds",
							code: "// @ts-expect-error\nexpectFinalState(db, { msgs: [] }, {});",
						},
					],
				},
				{
					kind: "existing_test",
					id: "page",
					rule: "The how-to still runs",
					test: "src/docs/a.test.ts",
					files: [],
				},
			],
		};

		expect([...namedIn(typed, [])]).toEqual(["expectFinalState"]);
	});

	it("allows and lists a change to a named name; sends back a change or removal of any other, saying what to do", () => {
		const named = namedIn(issue, []);
		const ruling = ruleOnApi(
			compared(
				change("changed", "replay"),
				change("changed", "expectCmdEmitted"),
				change("removed", "step"),
			),
			named,
			"problem",
		);

		expect(ruling.allowed.map((c) => c.name)).toEqual(["replay"]);
		expect(ruling.problems).toHaveLength(2);
		expect(ruling.problems[0]).toContain("You changed the published signature of expectCmdEmitted");
		expect(ruling.problems[0]).toContain("put it back, or answer contradiction");
		expect(ruling.problems[0]).toContain("before: function expectCmdEmitted(a: A): void;");
		expect(ruling.problems[1]).toContain("You removed step from the published API");
	});

	it("sends back an added name the ticket does not name, unless the lane only lists them", () => {
		const named = namedIn(issue, []);
		const diff = compared(change("added", "ReplayCtxArg"), change("added", "CtxArg"));

		expect(ruleOnApi(diff, named, "problem")).toMatchObject({
			problems: [expect.stringContaining("You added ReplayCtxArg")],
			allowed: [{name: "CtxArg"}],
		});
		expect(ruleOnApi(diff, named, "listed")).toMatchObject({
			problems: [],
			allowed: [{name: "ReplayCtxArg"}, {name: "CtxArg"}],
		});
	});

	it("guesses nothing when the comparison did not run", () => {
		expect(ruleOnApi({kind: "skipped", why: "no package"}, new Set(), "problem")).toEqual({
			problems: [],
			allowed: [],
		});
	});

	it("takes from the facts only the names the report itself named, not the ones a doc page's code calls", () => {
		const raw: RawIssue = {
			id: "558",
			title: "`replay` needs ctx",
			body: "See `run`.",
			filedBy: "human",
		};
		const fact = (name: string, calledIn: string | null) => ({
			name,
			calledIn,
			definitions: [],
			more: 0,
			mentionedIn: 1,
		});
		const facts: FactsPack = {
			names: [fact("replay", null), fact("expectCmdEmitted", "docs/how-to/replay-in-a-test.md")],
			paths: [],
			pages: [],
			refs: [],
		};

		expect(ticketNames(raw, facts)).toEqual(["replay"]);
		expect(ticketNames(raw, null)).toEqual(["replay", "run"]);
	});
});
