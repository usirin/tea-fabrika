import {layer as nodeServices} from "@effect/platform-node/NodeServices";
import {runEnv} from "@kampus/fabrika/agents/sandbox";
import {Effect, FileSystem, Path, Stream} from "effect";
import type {ChildProcessSpawner} from "effect/process";
import {afterAll, beforeAll, describe, expect, it} from "vitest";
import {runChild} from "./child.ts";
import {changeChecksOf, type LocalChecks, shipChecksOf, withLocalChecks} from "./local-checks.ts";
import type {CodeHost} from "./services.ts";
import type {Change, Checks} from "./stages/review/pack.ts";
import type {PrFacts} from "./stages/ship/facts.ts";

// A repository's own checks, run by fabrika at a pull request's head: a bare
// origin that holds the pull request's head the way GitHub does
// (`refs/pull/<n>/head`), the build stage's clone of it, and a GitHub reader
// stood in by one that answers fixed facts.

const green: Checks = {state: "green", required: [{name: "test", state: "green"}]};
const pending: Checks = {state: "pending", required: [{name: "test", state: "pending"}]};

describe("GitHub's checks and the repository's own, as one", () => {
	it("for the ship gate: the worst of the two; GitHub's left out when not counted", () => {
		expect(shipChecksOf("green", green)).toBe("green");
		expect(shipChecksOf("pending", green)).toBe("pending");
		expect(shipChecksOf("green", pending)).toBe("pending");
		expect(shipChecksOf("red", green)).toBe("red");
		expect(shipChecksOf(null, green)).toBe("green");
		// No check of GitHub's ever reports, and they are not counted: the local run decides.
		expect(shipChecksOf(null, {state: "red", required: []})).toBe("red");
		// A local list that could not be read is never green.
		expect(shipChecksOf("green", {state: "unknown", required: []})).toBe("stuck");
	});

	it("for a review: the worst state, and every check by name", () => {
		const github: Checks = {state: "green", required: [{name: "ci", state: "green"}]};
		expect(changeChecksOf(github, pending)).toEqual({
			state: "pending",
			required: [
				{name: "ci", state: "green"},
				{name: "test", state: "pending"},
			],
		});
		expect(changeChecksOf(null, green)).toEqual(green);
	});
});

const FIXTURE_ENV = {
	...runEnv(),
	GIT_CONFIG_GLOBAL: "/dev/null",
	GIT_CONFIG_NOSYSTEM: "1",
	GIT_AUTHOR_NAME: "builder",
	GIT_AUTHOR_EMAIL: "builder@example.com",
	GIT_COMMITTER_NAME: "builder",
	GIT_COMMITTER_EMAIL: "builder@example.com",
};
const onNode = <A, E>(
	effect: Effect.Effect<
		A,
		E,
		FileSystem.FileSystem | Path.Path | ChildProcessSpawner.ChildProcessSpawner
	>,
) => Effect.runPromise(effect.pipe(Effect.provide(nodeServices)));
const sh = (cwd: string, file: string, args: readonly string[]) =>
	runChild(file, args, {cwd, env: FIXTURE_ENV}).pipe(
		Effect.flatMap((ran) =>
			ran.code === 0
				? Effect.succeed(ran.out.trim())
				: Effect.die(new Error(`${file} ${args.join(" ")} failed: ${ran.err}`)),
		),
	);

const PR = "https://github.com/acme/widgets/pull/1";

interface World {
	readonly root: string;
	readonly work: string;
	/** A head whose `ok` file is there, and one whose is not. */
	readonly passing: string;
	readonly failing: string;
}
let world: World;

beforeAll(async () => {
	world = await onNode(
		Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem;
			const path = yield* Path.Path;
			const root = yield* fs.makeTempDirectory({prefix: "local-checks-"});
			const origin = path.join(root, "origin.git");
			const dev = path.join(root, "dev");
			yield* sh(root, "git", ["init", "-q", "--bare", origin]);
			yield* sh(root, "git", ["init", "-q", dev]);
			const commitWith = (files: Readonly<Record<string, string>>, message: string) =>
				Effect.gen(function* () {
					for (const [name, text] of Object.entries(files))
						yield* fs.writeFileString(path.join(dev, name), text);
					yield* sh(dev, "git", ["add", "-A"]);
					yield* sh(dev, "git", ["commit", "-q", "--no-verify", "--allow-empty", "-m", message]);
					return yield* sh(dev, "git", ["rev-parse", "HEAD"]);
				});
			const failing = yield* commitWith({"README.md": "widgets\n"}, "no ok yet");
			const passing = yield* commitWith({ok: "yes\n"}, "ok");
			yield* sh(dev, "git", ["push", "-q", "--no-verify", origin, `${passing}:refs/pull/1/head`]);
			// The build stage's clone, where it keeps it: `<work>/<owner>/<name>/clone`.
			const work = path.join(root, "work");
			const clone = path.join(work, "acme", "widgets", "clone");
			yield* fs.makeDirectory(path.dirname(clone), {recursive: true});
			yield* sh(root, "git", ["clone", "-q", "--no-checkout", origin, clone]);
			return {root, work, passing, failing};
		}),
	);
});

afterAll(async () => {
	await onNode(
		Effect.gen(function* () {
			yield* (yield* FileSystem.FileSystem).remove(world.root, {recursive: true});
		}),
	);
});

/** GitHub as it reads a repository with no CI: no check has ever reported, so pending. */
const factsOf = (head: string): PrFacts => ({
	head,
	state: "open",
	ours: true,
	ticket: "none",
	approval: "not_needed",
	reviews: null,
	checks: "pending",
	mergeable: "clean",
	comments: [],
	main: {tested: "base", tip: "base"},
});
const changeOf = (head: string): Change => ({
	pr: "https://github.com/acme/widgets/pull/1",
	head,
	replay: false,
	state: "open",
	ticket: "none",
	criteria: null,
	files: null,
	kinds: null,
	diff: null,
	deviations: {state: "absent"},
	checks: {state: "pending", required: []},
	rules: [],
});
const noCi = (head: string): CodeHost["Service"] => ({
	prFacts: () => Effect.succeed(factsOf(head)),
	change: () => Effect.succeed(changeOf(head)),
	checksSettled: () => Stream.never,
	leftQueue: () => Stream.never,
});

const settings = (over: Partial<LocalChecks> = {}): LocalChecks => ({
	work: world.work,
	install: ["sh", "-c", "touch installed"],
	checks: [{name: "test", run: ["sh", "-c", "test -f ok && test -f installed"]}],
	github: "none",
	...over,
});

/** The facts read before the checks settle, and after. */
const around = (head: string, over: Partial<LocalChecks> = {}) =>
	onNode(
		Effect.gen(function* () {
			const host = yield* withLocalChecks(noCi(head), settings(over));
			const before = yield* host.prFacts(PR);
			yield* Stream.runDrain(host.checksSettled(PR, head, []));
			const after = yield* host.prFacts(PR);
			const change = yield* host.change(PR, null);
			return {before: before.checks, after: after.checks, change: change.checks};
		}),
	);

describe("a repository's own checks, run at a pull request's head", () => {
	it("a head no run stood at is pending; once settled, its run's answer, after the install in the same copy", async () => {
		const got = await around(world.passing);
		expect(got.before).toBe("pending");
		expect(got.after).toBe("green");
		expect(got.change).toEqual({
			state: "green",
			required: [
				{name: "install", state: "green"},
				{name: "test", state: "green"},
			],
		});
	});

	it("a check that fails at the head is red", async () => {
		const got = await around(world.failing);
		expect(got.after).toBe("red");
	});

	it("an install that fails runs no check: each is red, never pending", async () => {
		const got = await around(world.passing, {install: ["sh", "-c", "exit 3"]});
		expect(got.change).toEqual({
			state: "red",
			required: [
				{name: "install", state: "red"},
				{name: "test", state: "red"},
			],
		});
	});

	it("GitHub's checks counted, with no CI that ever reports: pending, whatever the local run says", async () => {
		const got = await onNode(
			Effect.gen(function* () {
				const host = yield* withLocalChecks(
					{...noCi(world.passing), checksSettled: () => Stream.succeed(undefined)},
					settings({github: "every"}),
				);
				yield* Stream.runDrain(host.checksSettled(PR, world.passing, []));
				return (yield* host.prFacts(PR)).checks;
			}),
		);
		expect(got).toBe("pending");
	});

	it("a head the clone cannot find stood at no commit: still pending, never green", async () => {
		const got = await around("0".repeat(40));
		expect(got.after).toBe("pending");
	});
});
