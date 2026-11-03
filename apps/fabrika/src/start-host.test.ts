import {mkdtempSync, readFileSync, rmSync, statSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import * as NodePath from "@effect/platform-node/NodePath";
import {Effect} from "effect";
import {afterAll, describe, expect, it} from "vitest";
import {pathsOf} from "./host/socket.ts";
import {startHost} from "./start-host.ts";

// A host that dies before its logger is up still says why: its stderr goes to <home>/host/log.
// Node stands in for the app's Electron binary, and a small file for host.mjs.

const root = mkdtempSync(join(tmpdir(), "fabrika-start-"));
afterAll(() => rmSync(root, {recursive: true, force: true}));

const entry = (name: string, text: string) => {
	const file = join(root, name);
	writeFileSync(file, text);
	return file;
};

const started = (home: string, file: string) =>
	Effect.runPromise(
		Effect.gen(function* () {
			const paths = yield* pathsOf(home);
			const exited = yield* startHost({binary: process.execPath, entry: file, home, paths});
			return {code: yield* exited, paths};
		}).pipe(Effect.provide(NodePath.layer)),
	);

describe("starting the host", () => {
	it("keeps the stderr of a host that does not load, in its log, the user's alone", async () => {
		const home = join(root, "a");
		const {code, paths} = await started(home, entry("bad.mjs", "const x = 1;\nconst x = 2;\n"));
		expect(code).not.toBe(0);
		expect(readFileSync(paths.log, "utf8")).toContain("SyntaxError");
		expect(statSync(paths.dir).mode & 0o777).toBe(0o700);
		expect(statSync(paths.log).mode & 0o777).toBe(0o600);
	});

	it("appends: a second start keeps what the first wrote, and the host gets its home", async () => {
		const home = join(root, "b");
		const says = entry(
			"says.mjs",
			'const e = process.env;\nprocess.stderr.write("home " + e.FABRIKA_HOME + " node " + e.ELECTRON_RUN_AS_NODE + "\\n");\n',
		);
		await started(home, says);
		const {code, paths} = await started(home, says);
		expect(code).toBe(0);
		expect(readFileSync(paths.log, "utf8")).toBe(`home ${home} node 1\n`.repeat(2));
	});
});
