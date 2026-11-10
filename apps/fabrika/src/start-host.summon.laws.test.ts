import {execFileSync} from "node:child_process";
import {mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import * as NodePath from "@effect/platform-node/NodePath";
import {Effect} from "effect";
import {afterEach, expect, it, vi} from "vitest";
import {pathsOf} from "./host/socket.ts";
import {startHost} from "./start-host.ts";

const made: string[] = [];

afterEach(() => {
	vi.unstubAllEnvs();

	for (const folder of made.splice(0)) {
		rmSync(folder, {recursive: true, force: true});
	}
});

// T237 review 2, finding 3. Today's app opened from the Dock has no shell's FABRIKA_REPO.
// The folder chosen by the app must reach the actual child process, even with that variable absent.
it.each([
	{source: "selected", selected: true},
	{source: "inherited", selected: false},
])("T237-R2-3: the host gets the $source repo", async ({selected}) => {
	const root = realpathSync(mkdtempSync(join(tmpdir(), "summon-start-")));
	made.push(root);
	const repo = join(root, "selected-repo");
	mkdirSync(repo);
	execFileSync("git", ["init", "-q"], {cwd: repo});
	vi.stubEnv("FABRIKA_REPO", selected ? undefined : repo);
	const entry = join(root, "host.mjs");
	writeFileSync(entry, "process.stderr.write(JSON.stringify({repo: process.env.FABRIKA_REPO}));\n");
	const seen = await Effect.runPromise(
		Effect.gen(function* () {
			const home = join(root, "home");
			const paths = yield* pathsOf(home);
			const exited = yield* startHost({
				binary: process.execPath,
				entry,
				home,
				paths,
				...(selected ? {repo} : {}),
			});
			return {code: yield* exited, paths};
		}).pipe(Effect.provide(NodePath.layer)),
	);
	expect(seen.code).toBe(0);
	expect(JSON.parse(readFileSync(seen.paths.log, "utf8"))).toEqual({repo});
});
