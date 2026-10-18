import {type ChildProcess, spawn} from "node:child_process";
import {existsSync, mkdtempSync, readFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {fileURLToPath} from "node:url";
import {describe, expect, it} from "vitest";
import {SANDBOX_URL} from "../sandbox";

// The job experiment 71 lost, as a person meets it: a build job whose input
// is closed, tsh killed with kill -9 mid build, a new tsh on the same home,
// `attach %1`. The real launcher (bin/tsh), with `build-scripted`
// (./scripted-build.ts): a builder that takes a while, and writes that go
// nowhere and are noted in a log. Three tickets, and two kills.

const TSH = fileURLToPath(new URL("../../bin/tsh", import.meta.url));
const TICKETS = [1, 2, 3].map((n) => `${SANDBOX_URL}/issues/${n}`);

interface Life {
	readonly child: ChildProcess;
	readonly out: () => string;
	readonly exited: Promise<number | null>;
}

/** One tsh, on `home`, running `line`. */
const life = (home: string, folder: string, line: string): Life => {
	const child = spawn(TSH, ["-c", line], {
		env: {...process.env, TSH_HOME: home, TSH_SCRIPTED: folder},
		stdio: ["ignore", "pipe", "pipe"],
	});
	let out = "";
	child.stdout?.on("data", (chunk) => {
		out += String(chunk);
	});
	child.stderr?.on("data", (chunk) => {
		out += String(chunk);
	});
	const exited = new Promise<number | null>((resolve) => child.on("exit", (code) => resolve(code)));
	return {child, out: () => out, exited};
};

/** The scripted build's log, one line per thing it did. */
const logOf = (folder: string): string[] => {
	const at = join(folder, "log");
	return existsSync(at) ? readFileSync(at, "utf8").split("\n").filter(Boolean) : [];
};

/** Wait until the log has `count` lines that start with `prefix`. */
const until = async (folder: string, prefix: string, count: number) => {
	const deadline = Date.now() + 20_000;
	while (logOf(folder).filter((l) => l.startsWith(prefix)).length < count) {
		if (Date.now() > deadline) throw new Error(`no ${count} × "${prefix}" in ${logOf(folder)}`);
		await new Promise((resolve) => setTimeout(resolve, 50));
	}
};

/** kill -9, and wait for it to be gone. */
const kill = async ({child, exited}: Life) => {
	child.kill("SIGKILL");
	await exited;
};

describe("tsh killed mid build, attached again with its input closed", () => {
	it("three tickets, killed mid second and again mid third: every ticket is built to its end, each once, and tsh says why the job ended", async () => {
		const home = mkdtempSync(join(tmpdir(), "tsh-home-"));
		const folder = mkdtempSync(join(tmpdir(), "tsh-scripted-"));
		const told = TICKETS.map((t) => `ticket=${t}`).join(" ");

		const a = life(
			home,
			folder,
			`build-scripted --model m --effort medium --budget 1 ${told} & close %1 ticket; attach %1`,
		);
		await until(folder, "start 2", 1);
		await kill(a);

		const b = life(home, folder, "attach %1");
		await until(folder, "start 3", 1);
		await kill(b);

		const c = life(home, folder, "attach %1");
		expect(await c.exited).toBe(0);

		const log = logOf(folder);
		const times = (line: string) => log.filter((l) => l === line).length;
		// Every write once across the three lives: no copy made again, no second pull request.
		for (const n of [1, 2, 3])
			expect([times(`copy ${n}`), times(`push ${n}`), times(`open ${n}`)], `ticket ${n}`).toEqual([
				1, 1, 1,
			]);
		// The builder cut off by a kill is started again once, on the conversation it had.
		const starts = (n: number) => log.filter((l) => l.startsWith(`start ${n} `));
		expect(starts(1)).toHaveLength(1);
		for (const n of [2, 3]) {
			expect(starts(n)).toHaveLength(2);
			expect(new Set(starts(n)).size, `ticket ${n} keeps its conversation`).toBe(1);
		}
		// Each life sent what it finished; the last says the job ended, and why.
		expect(a.out()).toContain("built #1001");
		expect(b.out()).toContain("built #1002");
		expect(c.out()).toContain("built #1003");
		expect(c.out()).toContain(
			"[1] build-scripted ended: its input ticket was closed, and it finished all it held",
		);
		// Gone from the table once it ended.
		const after = life(home, folder, "jobs");
		expect(await after.exited).toBe(0);
		expect(after.out()).toBe("");
	}, 60_000);
});
