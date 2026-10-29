import {execFile} from "node:child_process";
import {existsSync, mkdtempSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {fileURLToPath} from "node:url";
import {promisify} from "node:util";
import {describe, expect, it} from "vitest";

// tsh as a person and a script meet it: the real launcher (bin/tsh), on a
// real terminal through `expect` (a pty), and from sh and zsh. Each run has
// its own TSH_HOME, so no run sees another's jobs or history. Skipped where
// `expect` is not there.

const run = promisify(execFile);
const TSH = fileURLToPath(new URL("../../bin/tsh", import.meta.url));
const PTY = fileURLToPath(new URL("./pty/", import.meta.url));
const EXPECT = ["/usr/bin/expect", "/usr/local/bin/expect", "/opt/homebrew/bin/expect"].find(
	existsSync,
);
const ZSH = ["/bin/zsh", "/usr/bin/zsh"].find(existsSync);

const home = () => mkdtempSync(join(tmpdir(), "tsh-home-"));
/** Run a shell line with tsh on its PATH-less name `tsh`, answering its output and status. */
const shell = async (sh: string, line: string, env: Record<string, string> = {}) => {
	const result = await run(sh, ["-c", line], {
		env: {...process.env, TSH: TSH, TSH_HOME: home(), ...env},
		timeout: 30_000,
	}).then(
		(ok) => ({...ok, status: 0}),
		(failed: {stdout: string; stderr: string; code: number}) => ({...failed, status: failed.code}),
	);
	return {out: result.stdout, err: result.stderr, status: result.status};
};

describe.skipIf(EXPECT === undefined)("tsh on a terminal", () => {
	const script = (name: string) =>
		run(EXPECT as string, [join(PTY, name), TSH], {
			env: {...process.env, TSH_HOME: home()},
			timeout: 60_000,
		}).then(
			(ok) => ({out: ok.stdout, status: 0}),
			(failed: {stdout: string; code: number}) => ({out: failed.stdout, status: failed.code}),
		);

	it("prompts, completes on Tab, keeps history, searches it on Ctrl-R, stops on Ctrl-C, and ends on Ctrl-D", async () => {
		const {out, status} = await script("session.exp");
		expect(out, out).not.toContain("CHECK FAILED");
		expect(status).toBe(0);
	});

	it("killed with kill -9, opened again: the job is there, and attach by run id goes on from its total", async () => {
		const {out, status} = await script("kept.exp");
		expect(out, out).not.toContain("CHECK FAILED");
		expect(status, out).toBe(0);
	});
});

describe("tsh from a script", () => {
	it("runs -c, a script file and piped stdin, each line in order", async () => {
		expect((await shell("sh", `"$TSH" -c 'seq --to 3 | double'`)).out).toBe(
			"double 2\ndouble 4\ndouble 6\n",
		);
		const file = join(home(), "run.tsh");
		writeFileSync(file, "#!/usr/bin/env tsh\nsay --text one\n\nsay --text two # a comment\n");
		expect((await shell("sh", `"$TSH" ${file}`)).out).toBe("one\ntwo\n");
		expect((await shell("sh", `printf 'say --text a\\nseq --to 2\\n' | "$TSH"`)).out).toBe(
			"a\n1\n2\n",
		);
	});

	it.each([
		["true", 0],
		["false", 1],
		["sqe --to 1", 127],
		["seq --to 1 | upper", 2],
		["false; true", 0],
		["true; false", 1],
		["exit 9", 9],
		["say --text hello | ship --mode read", 1],
	])("exits with the status of its last line: %j is %i", async (line, want) => {
		expect((await shell("sh", `"$TSH" -c '${line}'`)).status).toBe(want);
	});

	it.skipIf(ZSH === undefined)("is a command in zsh: tsh -c 'x' && echo ok", async () => {
		const ok = await shell(ZSH as string, `"$TSH" -c 'seq --to 1' && echo ok || echo no`);
		expect(ok.out).toBe("1\nok\n");
		const no = await shell(ZSH as string, `"$TSH" -c 'false' && echo ok || echo no`);
		expect(no.out).toBe("no\n");
		// The first line says which fabrika.toml was read, and the run's picks under it; then the failure, and nothing else.
		expect(no.err).toMatch(
			/^fabrika\.toml: [^\n]+\n( {2}[^\n]+\n)+tsh: false failed: false always fails\n$/,
		);
	});

	it("refuses a second tsh on the same home while the first runs", async () => {
		const shared = home();
		const first = run("sh", ["-c", `"$TSH" -c 'sleep --ms 1500'`], {
			env: {...process.env, TSH, TSH_HOME: shared},
		});
		await new Promise((done) => setTimeout(done, 600));
		const second = await shell("sh", `"$TSH" -c 'true'`, {TSH_HOME: shared});
		expect(second.status).toBe(2);
		expect(second.err).toContain("One tsh per home");
		await first;
	});
});
