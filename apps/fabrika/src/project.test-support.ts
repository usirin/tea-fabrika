import {execFileSync} from "node:child_process";
import {mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync} from "node:fs";
import {join} from "node:path";
import * as NodeChildProcessSpawner from "@effect/platform-node/NodeChildProcessSpawner";
import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import * as NodePath from "@effect/platform-node/NodePath";
import {Effect, Layer, type Scope} from "effect";
import * as fc from "fast-check";
import {afterEach, expect, it, vi} from "vitest";

// Today's app, T276 PR 1. These are fixtures and checks, never substitute product behavior.
export const options = {seed: 119120, numRuns: 25};
export const word = fc.stringMatching(/^[a-z][a-z0-9-]{0,14}$/);
export const source = fc.constantFrom("welcome", "box", "button", "menu", "sheet", "dock");
const homes: string[] = [];
afterEach(() => {
	vi.unstubAllEnvs();
	for (const home of homes.splice(0)) rmSync(home, {recursive: true, force: true});
});
export const home = () => {
	const folder = realpathSync(mkdtempSync("/tmp/fh."));
	homes.push(folder);
	vi.stubEnv("FABRIKA_HOME", folder);
	vi.stubEnv("FABRIKA_FOREGROUND", undefined);
	vi.stubEnv("TYPESAFE_API_KEY", undefined);
	return folder;
};
export const git = (folder: string, ...args: string[]) =>
	execFileSync("git", args, {
		cwd: folder,
		env: {...process.env, TYPESAFE_API_KEY: undefined},
		stdio: "pipe",
	})
		.toString()
		.trim();
export const repo = (folder: string, name: string) => {
	const root = join(folder, name);
	mkdirSync(root, {recursive: true});
	git(root, "init", "-q");
	writeFileSync(join(root, "a.txt"), `${name}\n`);
	writeFileSync(join(root, "b.txt"), "fixture\n");
	return root;
};
export const platform = NodeChildProcessSpawner.layer.pipe(
	Layer.provideMerge(Layer.mergeAll(NodeFileSystem.layer, NodePath.layer)),
);
export const go = <A, E>(body: Effect.Effect<A, E, Layer.Success<typeof platform> | Scope.Scope>) =>
	Effect.runPromise(body.pipe(Effect.scoped, Effect.provide(platform)));

// Run the same assertion on a deliberately bad answer. fc.check must reach that assertion;
// a missing product import never counts as catching a plant.
export const plant = <A>(name: string, input: fc.Arbitrary<A>, check: (input: A) => void) => {
	it(`plant: ${name}`, () => {
		const result = fc.check(fc.property(input, check), {...options, endOnFailure: true});
		expect(result.failed).toBe(true);
		expect(result.counterexample).not.toBeNull();
	});
};
