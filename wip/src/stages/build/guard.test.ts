import {type ChildProcess, execFileSync, spawn} from "node:child_process";
import {mkdtempSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {fileURLToPath} from "node:url";
import {afterEach, describe, expect, it} from "vitest";
import {HELD, parseArgs, rowOf, toStop, under} from "./guard";

// The guard, on real processes. `fixtures/builder-stop/parent.ts` stands in
// for the run's process: it starts the guard the way the Agent SDK does with
// the builder's `spawnClaudeCodeProcess`. `fixtures/builder-stop/agent.mjs`
// stands in for `claude`: it starts a child in a session of its own (as
// `claude` starts a Bash command), which starts a grandchild, and says the
// three pids.

const PARENT = fileURLToPath(new URL("../../../fixtures/builder-stop/parent.ts", import.meta.url));

interface Started {
	readonly proc: ChildProcess;
	readonly lines: string[];
	/** The first line that starts with `word`, split on spaces, waited for. */
	readonly line: (word: string, ms?: number) => Promise<string[]>;
}

const started: ChildProcess[] = [];
const left: number[] = [];

const start = (lock: string, wait: number, mode: "wait" | "end" = "wait"): Started => {
	const proc = spawn(
		process.execPath,
		["--disable-warning=ExperimentalWarning", PARENT, lock, String(wait), mode],
		{stdio: ["ignore", "pipe", "inherit"]},
	);
	started.push(proc);
	const lines: string[] = [];
	let rest = "";
	proc.stdout?.on("data", (chunk: Buffer) => {
		const parts = (rest + chunk.toString("utf8")).split("\n");
		rest = parts.pop() ?? "";
		lines.push(...parts);
	});
	const line = async (word: string, ms = 15_000) => {
		const until = Date.now() + ms;
		while (Date.now() < until) {
			const found = lines.find((l) => l.startsWith(`${word} `) || l === word);
			if (found !== undefined) return found.split(" ");
			await new Promise((r) => setTimeout(r, 25));
		}
		throw new Error(`no "${word}" line in ${ms}ms; saw: ${lines.join(" | ")}`);
	};
	return {proc, lines, line};
};

/** process.kill throws for a process that is gone; that is the answer. */
const alive = (pid: number) => {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
};

const until = async (check: () => boolean, ms: number) => {
	const end = Date.now() + ms;
	while (Date.now() < end) {
		if (check()) return true;
		await new Promise((r) => setTimeout(r, 50));
	}
	return check();
};

/** The agent's three pids: itself, its child in a session of its own, and that child's child. */
const agentOf = async (s: Started) => {
	const [, ...pids] = await s.line("agent");
	const all = pids.map(Number);
	left.push(...all);
	return all;
};

const parentOf = (pid: number) =>
	Number(execFileSync("ps", ["-o", "ppid=", "-p", String(pid)], {encoding: "utf8"}).trim());

const lockIn = () => join(mkdtempSync(join(tmpdir(), "guard-")), "1.lock");

afterEach(() => {
	for (const p of started.splice(0)) p.kill("SIGKILL");
	for (const pid of left.splice(0)) if (alive(pid)) process.kill(pid, "SIGKILL");
});

describe("the builder stops with its run", () => {
	it("kill -9 of the run's process stops the agent and everything it started, and frees the copy", async () => {
		const lock = lockIn();
		const a = start(lock, 5);
		const pids = await agentOf(a);
		expect(pids.every(alive)).toBe(true);
		a.proc.kill("SIGKILL");
		expect(await until(() => !pids.some(alive), 8_000)).toBe(true);

		// The copy is free: a new builder starts without waiting.
		const b = start(lock, 0);
		expect((await agentOf(b)).every(alive)).toBe(true);
	}, 30_000);

	it("the SDK's own stop (SIGTERM to the guard) stops all three", async () => {
		const a = start(lockIn(), 5);
		const pids = await agentOf(a);
		a.proc.kill("SIGTERM");
		expect(await until(() => !pids.some(alive), 8_000)).toBe(true);
		expect((await a.line("guard-exit"))[1]).not.toBe("0");
	}, 30_000);

	it("an agent that ends by itself leaves nothing behind", async () => {
		const a = start(lockIn(), 5, "end");
		const pids = await agentOf(a);
		expect((await a.line("guard-exit"))[1]).toBe("0");
		expect(await until(() => !pids.some(alive), 8_000)).toBe(true);
	}, 30_000);
});

describe("one builder per working copy", () => {
	it("a second builder on a held copy is refused, and the first runs on", async () => {
		const lock = lockIn();
		const a = start(lock, 5);
		const pids = await agentOf(a);

		const b = start(lock, 1);
		const [, code, ...said] = await b.line("guard-exit");
		expect(Number(code)).toBe(HELD);
		expect(said.join(" ")).toContain("held by another live builder");
		expect(b.lines.some((l) => l.startsWith("agent"))).toBe(false);
		expect(pids.every(alive)).toBe(true);
	}, 30_000);

	it("after kill -9, a new builder takes the copy over once the old one is gone, never beside it", async () => {
		const lock = lockIn();
		const a = start(lock, 5);
		const old = await agentOf(a);
		a.proc.kill("SIGKILL");

		// Started at once, while the old guard is still stopping: it waits for the copy.
		const b = start(lock, 30);
		await b.line("agent");
		// The moment the new agent stands, none of the old processes does.
		expect(old.filter(alive)).toEqual([]);
		await agentOf(b);
	}, 40_000);

	it("a lock left by a crash does not wedge: a dead holder holds nothing, whatever the file says", async () => {
		const lock = lockIn();
		writeFileSync(lock, "4242\nleft by a run on another machine\n");
		const a = start(lock, 5);
		const pids = await agentOf(a);
		// Everything dies at once, guard included: no one cleans up.
		const guard = parentOf(pids[0] ?? 0);
		for (const pid of [guard, ...pids]) process.kill(pid, "SIGKILL");
		a.proc.kill("SIGKILL");

		const b = start(lock, 1);
		expect((await agentOf(b)).every(alive)).toBe(true);
	}, 30_000);

	it("the lock goes with the agent: with its guard killed alone, the agent still holds the copy", async () => {
		const lock = lockIn();
		const a = start(lock, 5);
		const [agent = 0] = await agentOf(a);
		process.kill(parentOf(agent), "SIGKILL");
		await until(() => false, 300);
		expect(alive(agent)).toBe(true);

		const b = start(lock, 1);
		expect(Number((await b.line("guard-exit"))[1])).toBe(HELD);
	}, 30_000);
});

describe("the guard's parts", () => {
	it("reads its line", () => {
		expect(parseArgs(["/w/1.lock", "30", "--", "claude", "-p"])).toEqual({
			lock: "/w/1.lock",
			wait: 30,
			command: "claude",
			args: ["-p"],
		});
		expect(parseArgs(["/w/1.lock", "30", "claude"])).toBeNull();
		expect(parseArgs(["/w/1.lock", "soon", "--", "claude"])).toBeNull();
	});

	it("finds every process under a root, and nothing beside it", () => {
		const rows = [
			{pid: 10, ppid: 1, group: 10, started: "a"},
			{pid: 11, ppid: 10, group: 11, started: "a"},
			{pid: 12, ppid: 11, group: 11, started: "a"},
			{pid: 13, ppid: 1, group: 13, started: "a"},
		];
		expect(under(10, rows).map((r) => r.pid)).toEqual([10, 11, 12]);
		expect(under(99, rows)).toEqual([]);
	});

	it("stops what it saw under the root before, only while it is the same process", () => {
		const seen = [
			{pid: 11, ppid: 10, group: 11, started: "Sat Oct 17 20:55:08 2026"},
			{pid: 12, ppid: 11, group: 11, started: "Sat Oct 17 20:55:08 2026"},
		];
		const now = [
			// 11 ended; 12 was left, its parent now init. 13 is a new process given an old pid.
			{pid: 12, ppid: 1, group: 11, started: "Sat Oct 17 20:55:08 2026"},
			{pid: 11, ppid: 1, group: 11, started: "Sat Oct 17 21:40:00 2026"},
		];
		expect(toStop(10, now, seen).map((r) => r.pid)).toEqual([12]);
	});

	it("reads a line of ps", () => {
		expect(rowOf("  4242   1 4242 Sat Oct 17 20:55:08 2026")).toEqual({
			pid: 4242,
			ppid: 1,
			group: 4242,
			started: "Sat Oct 17 20:55:08 2026",
		});
		expect(rowOf("")).toBeNull();
	});
});
