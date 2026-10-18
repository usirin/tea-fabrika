import {execFileSync} from "node:child_process";
import {mkdtemp, readFile, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {Effect} from "effect";
import {describe, expect, it, vi} from "vitest";
import {Repo, Workspace} from "./factory-services.ts";
import {type Issue, testNames} from "./issue.ts";
import {checkoutToy, localRepo, localWorkspace, TOY_BASE} from "./local.ts";
import {
	nodeTests,
	TESTS_FILE,
	type TestFlavour,
	testsFor,
	VET_TSCONFIG,
	vitestTests,
} from "./tests.ts";
import {vetProblems} from "./vetting.ts";

/** Run one Workspace call against a real checkout. */
const using = <A, E>(dir: string, call: (workspace: Workspace["Service"]) => Effect.Effect<A, E>) =>
	Effect.runPromise(
		Effect.gen(function* () {
			return yield* call(yield* Workspace);
		}).pipe(Effect.provide(localWorkspace(dir, {test: ["node", "--test"]}))),
	);

const fixed = `export function slugify(title) {
  return title.toLowerCase().replace(/[^a-z0-9 ]/g, "").trim().replace(/ +/g, "-");
}
`;

describe("a local repo", () => {
	const git = (dir: string, ...args: string[]) =>
		execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], {
			cwd: dir,
			encoding: "utf8",
		}).trim();
	const repo = <A, E>(dir: string, call: (r: Repo["Service"]) => Effect.Effect<A, E>) =>
		Effect.runPromise(
			Effect.gen(function* () {
				return yield* call(yield* Repo);
			}).pipe(Effect.provide(localRepo(dir, {test: ["node", "--test"], base: TOY_BASE}))),
		);
	/** Someone else's work landing in the base while the lane runs: a commit on `main`, made in a folder of its own. */
	const landElsewhere = (dir: string, file: string, text: string) => {
		const other = `${dir}-other`;
		git(dir, "worktree", "add", "-q", other, TOY_BASE);
		execFileSync(
			"node",
			["-e", `require("node:fs").writeFileSync(${JSON.stringify(file)}, ${JSON.stringify(text)})`],
			{cwd: other},
		);
		git(other, "add", "-A");
		git(other, "commit", "-q", "-m", "someone else's work");
		git(dir, "worktree", "remove", "--force", other);
	};
	/** A lane whose fix passed its checks, ready to ship. */
	const readyLane = async () => {
		const toy = await checkoutToy("slugify");
		await using(toy.dir, (w) => w.prepare(toy.issue));
		await writeFile(join(toy.dir, "slugify.js"), fixed);
		await using(toy.dir, (w) => w.check(toy.issue));
		return toy.dir;
	};

	it("seals the change without moving the lane's branch, and lands it in the base", async () => {
		const dir = await readyLane();
		const lane = git(dir, "rev-parse", "HEAD");

		const {head, stat} = await repo(dir, (r) => r.seal("slugify makes slugs"));
		const landed = await repo(dir, (r) => r.land(head));

		expect(stat).toContain("slugify.js");
		expect(landed).toEqual({kind: "landed", sha: head});
		expect(git(dir, "rev-parse", TOY_BASE)).toBe(head);
		expect(git(dir, "rev-parse", "HEAD")).toBe(lane);
	});

	it("merges with a base that moved, and the merge passes its tests on a fresh copy", async () => {
		const dir = await readyLane();
		const {head} = await repo(dir, (r) => r.seal("slugify makes slugs"));
		landElsewhere(dir, "README.md", "someone else's readme\n");

		const behind = await repo(dir, (r) => r.land(head));
		const merged = await repo(dir, (r) => r.catchUp(head));
		const merge = merged.kind === "merged" ? merged.head : "";
		const retested = await repo(dir, (r) => r.retest(merge));
		const landed = await repo(dir, (r) => r.land(merge));

		expect(behind).toEqual({kind: "behind"});
		expect(merged.kind).toBe("merged");
		expect(retested.passed).toBe(true);
		expect(landed).toEqual({kind: "landed", sha: merge});
		// The base holds both: the change and the work that landed first.
		expect(git(dir, "show", `${TOY_BASE}:README.md`)).toBe("someone else's readme");
		expect(git(dir, "show", `${TOY_BASE}:slugify.js`)).toContain("replace(/ +/g");
	});

	it("names the files that conflict with a base that moved", async () => {
		const dir = await readyLane();
		const {head} = await repo(dir, (r) => r.seal("slugify makes slugs"));
		landElsewhere(
			dir,
			"slugify.js",
			"export function slugify(title) {\n  return title.trim();\n}\n",
		);

		const merged = await repo(dir, (r) => r.catchUp(head));

		expect(merged).toEqual({kind: "conflicted", files: ["slugify.js"]});
		// Nothing moved: the base is still the other work.
		expect(git(dir, "log", "-1", "--format=%s", TOY_BASE)).toBe("someone else's work");
	});
});

describe("a local workspace", () => {
	it("writes the issue's tests, and every one fails on the untouched stub", async () => {
		const toy = await checkoutToy("slugify");
		const prepared = await using(toy.dir, (w) => w.prepare(toy.issue));

		expect(prepared.passing).toEqual([]);
		expect([...prepared.failing].sort()).toEqual([...testNames(toy.issue)].sort());
	});

	it("reads a file as the change started and as the change left it, a deleted one as empty", async () => {
		const toy = await checkoutToy("slugify");
		await using(toy.dir, (w) => w.prepare(toy.issue));
		const before = await using(toy.dir, (w) => w.baseFile("slugify.js"));
		await writeFile(join(toy.dir, "slugify.js"), fixed);

		expect(await using(toy.dir, (w) => w.baseFile("slugify.js"))).toBe(before);
		expect(await using(toy.dir, (w) => w.currentFile("slugify.js"))).toBe(fixed);
		expect(await using(toy.dir, (w) => w.currentFile("gone.js"))).toBe("");
	});

	it("puts a changed test back, says so, and keeps it out of the diff", async () => {
		const toy = await checkoutToy("slugify");
		await using(toy.dir, (w) => w.prepare(toy.issue));
		await writeFile(join(toy.dir, "slugify.js"), fixed);
		const original = await readFile(join(toy.dir, TESTS_FILE), "utf8");
		await writeFile(join(toy.dir, TESTS_FILE), "// emptied by the builder\n");

		const checked = await using(toy.dir, (w) => w.check(toy.issue));

		expect(checked.touched).toEqual([TESTS_FILE]);
		expect(await readFile(join(toy.dir, TESTS_FILE), "utf8")).toBe(original);
		expect(checked.passed).toBe(true);
		expect(checked.diff).toContain("slugify.js");
		expect(checked.diff).not.toContain(TESTS_FILE);
	});

	it("fails a fresh copy of a change that needs a file git ignores, and leaves the folder as it was", async () => {
		const toy = await checkoutToy("slugify");
		await using(toy.dir, (w) => w.prepare(toy.issue));
		// The fix keeps its pattern in a file git is told to ignore: it is there in the folder only.
		await writeFile(join(toy.dir, ".gitignore"), "local-pattern.js\n");
		await writeFile(join(toy.dir, "local-pattern.js"), "export const NOT_SLUG = /[^a-z0-9 ]/g;\n");
		await writeFile(
			join(toy.dir, "slugify.js"),
			fixed
				.replace("/[^a-z0-9 ]/g", "NOT_SLUG")
				.replace(
					"export function",
					'import { NOT_SLUG } from "./local-pattern.js";\nexport function',
				),
		);
		const head = () => execFileSync("git", ["rev-parse", "HEAD"], {cwd: toy.dir, encoding: "utf8"});
		const before = head();

		const checked = await using(toy.dir, (w) => w.check(toy.issue));
		const fresh = await using(toy.dir, (w) => w.freshCheck(toy.issue));

		expect(checked.passed).toBe(true);
		expect(fresh.passed).toBe(false);
		expect(fresh.output).toContain("local-pattern.js");
		// The branch did not move, so the diff still reads from where the work started.
		expect(head()).toBe(before);
		expect((await using(toy.dir, (w) => w.check(toy.issue))).diff).toContain("slugify.js");
	});

	it("installs what the tests need into a fresh copy before running them", async () => {
		const toy = await checkoutToy("slugify");
		const ws = (install?: readonly [string, ...string[]]) =>
			localWorkspace(toy.dir, {
				test: ["node", "--test"],
				...(install === undefined ? {} : {install}),
			});
		const run = <A, E>(
			layer: ReturnType<typeof ws>,
			call: (w: Workspace["Service"]) => Effect.Effect<A, E>,
		) =>
			Effect.runPromise(
				Effect.gen(function* () {
					return yield* call(yield* Workspace);
				}).pipe(Effect.provide(layer)),
			);
		await run(ws(), (w) => w.prepare(toy.issue));
		// A stand-in for a package: ignored by git, made by the install step, needed by the fix.
		await writeFile(join(toy.dir, ".gitignore"), "vendor/\n");
		const makeVendor = `require("node:fs").mkdirSync("vendor");require("node:fs").writeFileSync("vendor/pattern.js","export const NOT_SLUG = /[^a-z0-9 ]/g;\\n")`;
		execFileSync("node", ["-e", makeVendor], {cwd: toy.dir});
		await writeFile(
			join(toy.dir, "slugify.js"),
			fixed
				.replace("/[^a-z0-9 ]/g", "NOT_SLUG")
				.replace(
					"export function",
					'import { NOT_SLUG } from "./vendor/pattern.js";\nexport function',
				),
		);
		await run(ws(), (w) => w.check(toy.issue));

		const without = await run(ws(), (w) => w.freshCheck(toy.issue));
		const withInstall = await run(ws(["node", "-e", makeVendor]), (w) => w.freshCheck(toy.issue));
		const brokenInstall = await run(ws(["node", "-e", "process.exit(1)"]), (w) =>
			w
				.freshCheck(toy.issue)
				.pipe(Effect.match({onSuccess: () => "ran", onFailure: (error) => error._tag})),
		);

		expect(without.passed).toBe(false);
		expect(withInstall.passed).toBe(true);
		// An install that fails is not the change's fault: the lane parks instead of sending it back.
		expect(brokenInstall).toBe("could_not_run");
	});

	it("passes a fresh copy of a change that git holds whole", async () => {
		const toy = await checkoutToy("slugify");
		await using(toy.dir, (w) => w.prepare(toy.issue));
		await writeFile(join(toy.dir, "slugify.js"), fixed);

		await using(toy.dir, (w) => w.check(toy.issue));
		const fresh = await using(toy.dir, (w) => w.freshCheck(toy.issue));

		expect(fresh).toMatchObject({passed: true});
	});

	it("runs the tests with a short environment, in the folder and in a fresh copy: a variable set on this machine is not theirs", async () => {
		vi.stubEnv("TEA_FABRIKA_MARKER", "set");
		vi.stubEnv("TYPESAFE_API_KEY", "not-a-key");
		const toy = await checkoutToy("slugify");
		// A test command that is a real child process, and says the names of the variables it was handed.
		const names: [string, ...string[]] = [
			"node",
			"-e",
			"console.log('names: ' + Object.keys(process.env).join(' '))",
		];
		const asked = <A, E>(call: (workspace: Workspace["Service"]) => Effect.Effect<A, E>) =>
			Effect.runPromise(
				Effect.gen(function* () {
					return yield* call(yield* Workspace);
				}).pipe(Effect.provide(localWorkspace(toy.dir, {test: names}))),
			);

		const checked = await asked((w) => w.check(toy.issue));
		const fresh = await asked((w) => w.freshCheck(toy.issue));
		vi.unstubAllEnvs();

		for (const output of [checked.output, fresh.output]) {
			expect(output).toContain("names: ");
			expect(output).toContain("PATH");
			expect(output).not.toContain("TEA_FABRIKA_MARKER");
			expect(output).not.toContain("TYPESAFE_API_KEY");
		}
	});

	it("writes, locks, runs and reads the issue's tests the way the workspace's flavour says", async () => {
		const toy = await checkoutToy("slugify");
		// A flavour of its own: the file in a folder that does not exist yet, and a report it marks as cut.
		const nested: TestFlavour = {
			...nodeTests,
			file: "checks/criteria.test.js",
			write: (issue) => testsFor(issue).replaceAll(`from "./`, `from "../`),
			run: ["node", "--test", "checks/criteria.test.js"],
			brief: (output) => `cut: ${output}`,
		};
		const run = <A, E>(call: (w: Workspace["Service"]) => Effect.Effect<A, E>) =>
			Effect.runPromise(
				Effect.gen(function* () {
					return yield* call(yield* Workspace);
				}).pipe(Effect.provide(localWorkspace(toy.dir, {test: ["node", "--test"], tests: nested}))),
			);

		const prepared = await run((w) => w.prepare(toy.issue));
		await writeFile(join(toy.dir, "slugify.js"), fixed);
		await writeFile(join(toy.dir, nested.file), "// emptied by the builder\n");
		const checked = await run((w) => w.check(toy.issue));

		expect([...prepared.failing].sort()).toEqual([...testNames(toy.issue)].sort());
		expect(prepared.output.startsWith("cut: ")).toBe(true);
		expect(checked.touched).toEqual([nested.file]);
		expect(checked.passed).toBe(true);
		// node's report has the toy's own tests too, and the node flavour reads them all.
		expect(checked.passingTests).toEqual(expect.arrayContaining([...testNames(toy.issue)]));
		expect(checked.output.startsWith("cut: ")).toBe(true);
		expect(checked.changed).toEqual(["slugify.js"]);
	});

	describe("on a typed repo, with type snippets and an existing test", () => {
		const tsc = join(import.meta.dirname, "..", "node_modules", ".bin", "tsc");
		const git = (dir: string, ...args: string[]) =>
			execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], {
				cwd: dir,
				encoding: "utf8",
			});
		/** A typed repo whose `greet` takes only a string, and a test of its own that passes. */
		const typedRepo = async () => {
			const dir = await mkdtemp(join(tmpdir(), "tea-fabrika-typed-"));
			await writeFile(
				join(dir, "greet.ts"),
				// biome-ignore lint/suspicious/noTemplateCurlyInString: the text of a source file; `${name}` is that file's own template, written out as it is
				"export function greet(name: string): string {\n  return `hi ${name}`;\n}\n",
			);
			await writeFile(
				join(dir, "shape.test.js"),
				`import test from "node:test";\ntest("shape", () => {});\n`,
			);
			await writeFile(
				join(dir, "tsconfig.json"),
				JSON.stringify({
					compilerOptions: {
						strict: true,
						noEmit: true,
						noUnusedLocals: true,
						module: "NodeNext",
						moduleResolution: "NodeNext",
					},
				}),
			);
			git(dir, "init", "-q", "-b", "main");
			git(dir, "add", "-A");
			git(dir, "commit", "-q", "-m", "base");
			git(dir, "checkout", "-q", "-b", "lane");
			return dir;
		};
		// The vitest flavour's typecheck for a repo that is its own package, run with this repo's own compiler.
		const typecheck = vitestTests({
			package: ".",
			file: "greet.test.ts",
			tsconfig: "tsconfig.json",
		}).typecheck;
		if (typecheck === undefined) throw new Error("expected a typecheck");
		const typed: TestFlavour = {
			...nodeTests,
			typecheck: {...typecheck, run: [tsc, "-p", VET_TSCONFIG]},
		};
		const ticket: Issue = {
			id: "greet",
			title: "greet takes a number",
			goal: "greet greets a number as it greets a name",
			body: "",
			criteria: [
				{
					kind: "type",
					id: "number",
					rule: "greet takes a number, and still no boolean",
					files: ["greet.ts"],
					uses: [{name: "greet", file: "greet.ts"}],
					snippets: [
						{expect: "compiles", today: "fails", code: "greet(1);"},
						{
							expect: "rejects",
							today: "holds",
							code: "// @ts-expect-error a boolean is no name\ngreet(true);",
						},
					],
				},
				{
					kind: "existing_test",
					id: "shape",
					rule: "The shape test still passes",
					test: "shape.test.js",
					files: [],
				},
			],
			openDecision: null,
		};
		const on = <A, E>(dir: string, call: (w: Workspace["Service"]) => Effect.Effect<A, E>) =>
			Effect.runPromise(
				Effect.gen(function* () {
					return yield* call(yield* Workspace);
				}).pipe(Effect.provide(localWorkspace(dir, {test: ["node", "--test"], tests: typed}))),
			);

		it("vets each snippet against how it says it stands today, and runs the existing test", {
			timeout: 60_000,
		}, async () => {
			const dir = await typedRepo();

			const vetted = await on(dir, (w) => w.vet(ticket));

			expect(vetted.snippets.map((s) => [s.snippet, s.verdict])).toEqual([
				[1, "fails"],
				[2, "holds"],
			]);
			expect(vetted.snippets[0]?.detail).toContain("TS2345");
			expect(vetted.snippets[1]?.detail).toMatch(
				/^is rejected: TS2345: Argument of type 'boolean'/,
			);
			expect(vetted.tests).toEqual([
				{criterion: "shape", test: "shape.test.js", verdict: "passes", detail: ""},
			]);
			expect(vetProblems(ticket, vetted)).toEqual([]);
			// Nothing of the vetting is left in the folder.
			expect(git(dir, "status", "--porcelain")).toBe("");
		});

		it("writes the snippets beside the tests and locks them; the checks run them after a build, and send back a widening", {
			timeout: 60_000,
		}, async () => {
			const dir = await typedRepo();

			const prepared = await on(dir, (w) => w.prepare(ticket));
			expect(prepared.failing).toEqual(["number: snippet 1"]);
			expect([...prepared.passing].sort()).toEqual(["number: snippet 2", "shape: shape.test.js"]);
			// The examples' file is only written for examples; the snippets' file is committed, like the tests.
			expect(git(dir, "ls-tree", "--name-only", "HEAD").split("\n")).toEqual(
				expect.arrayContaining(["greet.test-d.ts"]),
			);
			expect(git(dir, "ls-tree", "--name-only", "HEAD")).not.toContain(TESTS_FILE);

			// The asked change: a number is a name too.
			await writeFile(
				join(dir, "greet.ts"),
				// biome-ignore lint/suspicious/noTemplateCurlyInString: the text of a source file; `${name}` is that file's own template, written out as it is
				"export function greet(name: string | number): string {\n  return `hi ${name}`;\n}\n",
			);
			const asked = await on(dir, (w) => w.check(ticket));
			expect(asked.passed).toBe(true);
			expect(asked.passingTests).toEqual(
				expect.arrayContaining(["number: snippet 1", "number: snippet 2", "shape: shape.test.js"]),
			);
			expect((await on(dir, (w) => w.freshCheck(ticket))).passed).toBe(true);

			// Too wide: a boolean gets in, and the guard says so.
			await writeFile(
				join(dir, "greet.ts"),
				// biome-ignore lint/suspicious/noTemplateCurlyInString: the text of a source file; `${String(name)}` is that file's own template, written out as it is
				"export function greet(name: unknown): string {\n  return `hi ${String(name)}`;\n}\n",
			);
			const wide = await on(dir, (w) => w.check(ticket));
			expect(wide.passed).toBe(false);
			expect(wide.output).toContain("Type snippets that do not hold, in greet.test-d.ts");
			expect(wide.output).toContain("TS2578");

			// And an edited snippet is put back before anything runs.
			await writeFile(join(dir, "greet.test-d.ts"), "export {};\n");
			const touched = await on(dir, (w) => w.check(ticket));
			expect(touched.touched).toEqual(["greet.test-d.ts"]);
			expect(await readFile(join(dir, "greet.test-d.ts"), "utf8")).toContain("greet(true);");
		});

		it("fails the checks when an existing test fails after the change", {
			timeout: 60_000,
		}, async () => {
			const dir = await typedRepo();
			await on(dir, (w) => w.prepare(ticket));
			await writeFile(
				join(dir, "greet.ts"),
				// biome-ignore lint/suspicious/noTemplateCurlyInString: the text of a source file; `${name}` is that file's own template, written out as it is
				"export function greet(name: string | number): string {\n  return `hi ${name}`;\n}\n",
			);
			await writeFile(
				join(dir, "shape.test.js"),
				`import test from "node:test";\ntest("shape", () => { throw new Error("broke"); });\n`,
			);

			const checked = await on(dir, (w) => w.check(ticket));

			expect(checked.passed).toBe(false);
			expect(checked.output).toContain("The existing test shape.test.js fails");
			expect(checked.passingTests).not.toContain("shape: shape.test.js");
		});
	});

	it("reports an example whose call does not parse as neither passing nor failing", async () => {
		const toy = await checkoutToy("slugify");
		const broken: Issue = {
			...toy.issue,
			criteria: [
				...toy.issue.criteria,
				{
					kind: "example",
					id: "broken",
					rule: "x",
					file: "slugify.js",
					name: "slugify",
					uses: [],
					examples: [{call: `slugify("a"`, result: `"a"`}],
				},
			],
		};
		const prepared = await using(toy.dir, (w) => w.prepare(broken));
		const ran = new Set([...prepared.passing, ...prepared.failing]);

		// A call that does not parse takes the whole file down with it.
		expect(testNames(broken).filter((name) => !ran.has(name))).toContain(`broken: slugify("a"`);
	});
});
