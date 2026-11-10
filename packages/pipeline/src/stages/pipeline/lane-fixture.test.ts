import {execFileSync} from "node:child_process";
import {mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {fileURLToPath} from "node:url";
import {Effect} from "effect";
import {afterEach, describe, expect, it} from "vitest";
import {SETTINGS_FILE, settingsFrom} from "../../settings.ts";
import {LANE_REPO, makeFakeGh, makeLaneHome} from "./lane-fixture.ts";

// A lane checks a pull request in a checkout under the app home in Library/Application Support, and
// that path has a space (tracker 190). The toy lane the lane tests run on must hold there too: its
// `[[checks.run]]` is a `sh -c` line, and its stand-in `gh` and `codex` are `sh` scripts, each with
// a path written into it. The folder here has a space in its name on purpose, so this fails on any
// checkout, not only on one whose own path has a space.

const MODULES = fileURLToPath(new URL("../../../node_modules", import.meta.url));

describe("the toy lane, in a folder whose path has a space", () => {
	const dirs: string[] = [];
	afterEach(() => {
		for (const dir of dirs.splice(0)) {
			rmSync(dir, {recursive: true, force: true});
		}
	});

	it("runs its own checks green, and its stand-in gh answers, as a lane under the app home would", () => {
		const dir = realpathSync(mkdtempSync(join(tmpdir(), "lane space-")));
		dirs.push(dir);
		// The install the checks link to, at a path with a space, as a checkout's own would be.
		const modules = join(dir, "node modules");
		symlinkSync(MODULES, modules);
		const {seed, remote} = makeLaneHome({dir, nodeModules: modules});
		const fake = makeFakeGh({dir, remote});

		const settings = Effect.runSync(settingsFrom(readFileSync(join(seed, SETTINGS_FILE), "utf8")));
		const checks = settings.checks?.run ?? [];
		expect(checks.map((check) => check.name)).toEqual(["test"]);

		// Each throws on a non-zero exit, with what it printed.
		for (const {run} of checks) {
			const [program, ...args] = run;
			execFileSync(program, args, {cwd: seed, stdio: "pipe"});
		}

		const ref = execFileSync(fake.gh, ["api", `repos/${LANE_REPO}/git/ref/heads/main`], {
			env: {...process.env, ...fake.env},
			encoding: "utf8",
		});
		expect(JSON.parse(ref)).toEqual({object: {sha: expect.stringMatching(/^[0-9a-f]{40}$/)}});
		expect(fake.calls().map((call) => call.kind)).toEqual(["ref_read"]);
	});
});
