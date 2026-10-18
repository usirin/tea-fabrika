import {execFileSync} from "node:child_process";
import {access, mkdtemp, readFile, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join, resolve} from "node:path";
import {Effect} from "effect";
import {Workspace} from "../legacy/src/factory-services";
import {Issue} from "../legacy/src/issue";
import {localWorkspace} from "../legacy/src/local";
import {vitestTests} from "../legacy/src/tests";

// What the lane's checks say about an issue's type snippets and existing
// tests, before a change and after one: the snippets written to their
// .test-d.ts and committed as prepare does, a diff applied as a builder would
// leave it, and the checks run on it. Offline: git, pnpm and the repo's own
// tsc and vitest, no Jev, no agent. Everything happens in a throwaway worktree
// of REPO, removed afterwards.
//   REPO=<folder>     a checkout of the repo
//   ISSUE=<file>      the issue as JSON (the Issue shape)
//   DIFF=<file>       the change, as `git apply` takes it; left out, the checks run on HEAD again
//   PACKAGE=<folder>  the package the tests join (default packages/tea)
//   ID=<n>            names the files src/fabrika-<n>.test(-d).ts (default 558)

const repo = process.env.REPO;
const issueFile = process.env.ISSUE;
if (repo === undefined || issueFile === undefined) throw new Error("REPO and ISSUE are needed");
const pkg = process.env.PACKAGE ?? "packages/tea";
const issue = Issue.parse(JSON.parse(await readFile(issueFile, "utf8")));

const scratch = await mkdtemp(join(tmpdir(), "tea-fabrika-guards-"));
const git = (dir: string, ...args: string[]) =>
	execFileSync("git", args, {cwd: dir, encoding: "utf8"});
git(repo, "worktree", "add", "-q", "--detach", scratch, "HEAD");
try {
	execFileSync("pnpm", ["install", "--frozen-lockfile", "--prefer-offline"], {
		cwd: scratch,
		stdio: "ignore",
	});
	const tsconfig = (await access(join(scratch, pkg, "tsconfig.test.json")).then(
		() => true,
		() => false,
	))
		? "tsconfig.test.json"
		: "tsconfig.json";
	const tests = vitestTests({
		package: pkg,
		file: `src/fabrika-${process.env.ID ?? "558"}.test.ts`,
		tsconfig,
	});
	// Only the issue's own checks: the package's whole run says nothing about them.
	const workspace = localWorkspace(scratch, {test: ["true"], tests});
	const on = <A, E>(call: (w: Workspace["Service"]) => Effect.Effect<A, E>) =>
		Effect.runPromise(
			Effect.gen(function* () {
				return yield* call(yield* Workspace);
			}).pipe(Effect.provide(workspace)),
		);

	const prepared = await on((w) => w.prepare(issue));
	console.log("on HEAD, as prepare runs them:");
	for (const name of prepared.passing) console.log(`  holds  ${name}`);
	for (const name of prepared.failing) console.log(`  fails  ${name}`);

	if (process.env.DIFF !== undefined) git(scratch, "apply", resolve(process.env.DIFF));
	const started = Date.now();
	const checked = await on((w) => w.check(issue));
	const passing = new Set(checked.passingTests);
	console.log(
		`\nafter ${process.env.DIFF ?? "no change"}, as the lane's check runs them (${((Date.now() - started) / 1000).toFixed(1)}s):`,
	);
	for (const name of [...prepared.passing, ...prepared.failing])
		console.log(`  ${passing.has(name) ? "holds" : "fails"}  ${name}`);
	console.log(`  checks ${checked.passed ? "pass" : "fail"}`);
	if (!checked.passed)
		console.log(
			checked.output
				.split("\n")
				.map((l) => `    ${l}`)
				.join("\n"),
		);
} finally {
	git(repo, "worktree", "remove", "--force", scratch);
	await rm(scratch, {recursive: true, force: true});
}
