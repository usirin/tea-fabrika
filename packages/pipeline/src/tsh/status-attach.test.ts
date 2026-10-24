import {type ChildProcess, spawn} from "node:child_process";
import {existsSync, mkdtempSync, readFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {fileURLToPath} from "node:url";
import {describe, expect, it} from "vitest";

// Status lines across a kill, as a person meets them: the real launcher
// (bin/tsh) with `build-scripted` (./scripted-build.ts), three tickets, the
// input closed. `jobs` mid build, kill -9, a new tsh on the same home,
// `attach %1 &`, and `jobs` again: the lines come back from what was kept.

const TSH = fileURLToPath(new URL("../../bin/tsh", import.meta.url));
const TICKETS = [1, 2, 3].map((n) => `https://github.com/acme/widgets/issues/${n}`);

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

const logOf = (folder: string): string[] => {
	const at = join(folder, "log");
	return existsSync(at) ? readFileSync(at, "utf8").split("\n").filter(Boolean) : [];
};

/** Wait until `found` holds. */
const until = async (found: () => boolean) => {
	while (!found()) {
		await new Promise((resolve) => setTimeout(resolve, 50));
	}
};

/** The rows `jobs` printed under the job: the indented ones. */
const rowsOf = (out: string) => out.split("\n").filter((l) => l.startsWith("      "));

describe("status lines across a kill", () => {
	it("jobs shows the queue and the build mid run; after kill -9 and attach, the same rows come back from the kept state", async () => {
		const home = mkdtempSync(join(tmpdir(), "tsh-home-"));
		const folder = mkdtempSync(join(tmpdir(), "tsh-scripted-"));
		const told = TICKETS.map((t) => `ticket=${t}`).join(" ");

		const a = life(
			home,
			folder,
			`build-scripted --model m --effort medium --budget 1 ${told} & close %1 ticket; sleep --ms 800; jobs; attach %1`,
		);
		await until(() => rowsOf(a.out()).length >= 2);
		await until(() => logOf(folder).some((l) => l.startsWith("start 2")));
		a.child.kill("SIGKILL");
		await a.exited;

		// The builder takes 1500 ms: 800 ms in, the resumed one is at work.
		const b = life(home, folder, "attach %1 & sleep --ms 800; jobs; attach %1");
		await until(() => rowsOf(b.out()).length >= 2);
		b.child.kill("SIGKILL");
		await b.exited;

		expect(rowsOf(a.out())).toEqual([
			"      queue  #1 now, 2 waiting",
			"      build  #1 round 1: builder at work",
		]);
		// Ticket 1 was built and dropped before the kill; nobody told 2 and 3 again, and the input is
		// closed. The build of 2 goes on from where it was kept: its builder cut off by the kill is run
		// again, as run 2 of the same round.
		expect(rowsOf(b.out())).toEqual([
			"      queue  #2 now, 1 waiting",
			"      build  #2 round 1: builder at work, run 2",
		]);
	});
});
