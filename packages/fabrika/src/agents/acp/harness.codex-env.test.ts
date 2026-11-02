import {spawnSync} from "node:child_process";
import {mkdirSync, mkdtempSync, realpathSync, rmSync} from "node:fs";
import {homedir, tmpdir} from "node:os";
import {join} from "node:path";
import {afterAll, describe, expect, it} from "@effect/vitest";
import {codexEnvOf, flagsOf} from "../codex/adapter.ts";
import {codexEnv} from "./harness.ts";

// What a command in Codex's box is handed (self-fix PR 2): the fence's PATH and git settings, as the
// Claude row's commands get them (`fencedEnv`), by Codex's config. Codex itself keeps the host's PATH.

const made: string[] = [];
afterAll(() => {
	for (const path of made) rmSync(path, {recursive: true, force: true});
});
const madeHome = () => {
	const home = realpathSync(mkdtempSync(join(tmpdir(), "codex-env-")));
	made.push(home);
	return home;
};

/** What `codexEnv` hands Codex for a write turn in a made-up home, and its commands' variables. */
const handed = (PATH: string | undefined, tools?: readonly string[]) => {
	const home = madeHome();
	const folder = join(home, "copy");
	mkdirSync(folder);
	const env = codexEnv(
		{PATH, HOME: home, USER: process.env.USER, TMPDIR: tmpdir()},
		folder,
		"write",
		tools,
	);
	const config = JSON.parse(env.CODEX_CONFIG ?? "{}");
	const set: Record<string, string> = config.shell_environment_policy.set;
	return {folder, env, config, set};
};

describe("what a command in Codex's box is handed", () => {
	it("keeps the PATH folders under home the box opens, drops the rest, and leaves Codex's own whole", () => {
		const tool = join(homedir(), ".a-made-up-tool");
		const PATH = [join(homedir(), ".a-made-up-bin"), join(tool, "bin"), "/usr/bin", "/bin"].join(
			":",
		);
		const {env, set} = handed(PATH, [tool]);
		expect(env.PATH).toBe(PATH);
		expect(set.PATH).toBe([join(tool, "bin"), "/usr/bin", "/bin"].join(":"));
	});

	it("points git and npm at no user config, and the config folder at an empty one", () => {
		const {env, set} = handed("/usr/bin:/bin");
		expect(set).toMatchObject({
			GIT_CONFIG_GLOBAL: "/dev/null",
			NPM_CONFIG_USERCONFIG: "/dev/null",
			XDG_CONFIG_HOME: "/var/empty",
		});
		// Codex's own process keeps its keep-list: the settings are for its commands.
		expect(env.GIT_CONFIG_GLOBAL).toBeUndefined();
	});
});

// In Codex's own box, with no model, as "the fence, in Codex's own box" asks (harness.test.ts).
const boxHome = madeHome();
const boxEnv = codexEnvOf(process.env, boxHome);
const tried = spawnSync("codex", ["sandbox", "--", "/bin/sh", "-c", "exit 0"], {
	cwd: boxHome,
	env: boxEnv,
	encoding: "utf8",
	stdio: ["ignore", "ignore", "pipe"],
});
const noCodex =
	tried.error !== undefined &&
	"code" in tried.error &&
	["ENOENT", "EACCES", "EPERM"].includes(String(tried.error.code));
const insideABox = tried.stderr?.includes("sandbox_apply: Operation not permitted") ?? false;
const SLOW = 120_000;

/** One shell line in Codex's box, with what `codexEnv` hands it for the host's PATH. */
const inBox = (line: string) => {
	const {folder, env, config} = handed(process.env.PATH);
	mkdirSync(env.HOME ?? join(folder, "codex-home"), {recursive: true});
	return spawnSync("codex", ["sandbox", ...flagsOf(config), "--", "/bin/sh", "-c", line], {
		cwd: folder,
		env,
		encoding: "utf8",
	});
};

describe.skipIf(process.platform !== "darwin" || noCodex || insideABox || tried.status !== 0)(
	"in Codex's own box",
	() => {
		it(
			"a command's PATH holds no folder the box closes",
			() => {
				// A lookup along the PATH ends at the first folder that answers EPERM.
				const ran = inBox(
					`IFS=:; for d in $PATH; do ls "$d" 2>&1 >/dev/null | grep -q "not permitted" && echo "$d"; done; exit 0`,
				);
				expect(ran.status, ran.stderr).toBe(0);
				expect(ran.stdout).toBe("");
			},
			SLOW,
		);

		it(
			"a command sees the fence's git and npm settings, which core variables alone drop",
			() => {
				const ran = inBox(
					`printf '%s|%s|%s' "$GIT_CONFIG_GLOBAL" "$NPM_CONFIG_USERCONFIG" "$XDG_CONFIG_HOME"`,
				);
				expect(ran.status, ran.stderr).toBe(0);
				expect(ran.stdout).toBe("/dev/null|/dev/null|/var/empty");
			},
			SLOW,
		);
	},
);
