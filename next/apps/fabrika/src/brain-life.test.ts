// P12, next/. Unit checks own the outbox and memory sampling. Child cleanup uses the real dev.ts.
import {spawn, execFileSync, type ChildProcess} from "node:child_process";
import {mkdtempSync, readFileSync, rmSync} from "node:fs";
import {createServer} from "node:net";
import {tmpdir} from "node:os";
import {join, resolve} from "node:path";
import {describe, expect, it, afterEach} from "@effect/vitest";
import {Effect} from "effect";

const homes: Array<string> = [];
const children: Array<ChildProcess> = [];
const groups: Array<number> = [];
const home = () => {
	const h = mkdtempSync(join(tmpdir(), "p12-l-"));
	homes.push(h);
	return h;
};
const pause = () => new Promise<void>((done) => setTimeout(done, 25));
const living = (pid: number) => {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
};
afterEach(async () => {
	for (const child of children.splice(0))
		if (child.exitCode === null) {
			child.kill("SIGTERM");
			await new Promise<void>((done) => child.once("exit", () => done()));
		}
	for (const pid of groups.splice(0)) {
		try {
			process.kill(-pid, "SIGKILL");
		} catch {
			/* Already stopped. */
		}
	}
	for (const h of homes.splice(0)) rmSync(h, {recursive: true, force: true});
});
const tree = (parent: number) => {
	const rows = execFileSync("ps", ["-axo", "pid=,ppid=,command="], {encoding: "utf8"})
		.split("\n")
		.flatMap((row) => {
			const m = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(row);
			return m ? [{pid: Number(m[1]), parent: Number(m[2]), command: m[3]!}] : [];
		});
	const pids = new Set([parent]);
	for (let n = 0; n < rows.length; n++)
		for (const row of rows) if (pids.has(row.parent)) pids.add(row.pid);
	return rows.filter((r) => pids.has(r.pid));
};
const launch = async () => {
	readFileSync(resolve(import.meta.dirname, "../dev.ts"), "utf8");
	const folder = home();
	const listener = createServer();
	await new Promise<void>((done, fail) => {
		listener.once("error", fail);
		listener.listen(0, "127.0.0.1", done);
	});
	const at = listener.address();
	if (at === null || typeof at === "string") throw new Error("no TCP port");
	await new Promise<void>((done) => listener.close(() => done()));
	const env = {...process.env, FABRIKA_HOME: folder, DO_NOT_TRACK: "1"};
	delete env.TYPESAFE_API_KEY;
	delete env.FABRIKA_FOREGROUND;
	delete env.CLOUDFLARE_API_TOKEN;
	const key = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
	const child = spawn(
		process.execPath,
		[
			resolve(import.meta.dirname, "../dev.ts"),
			"--port",
			String(at.port),
			"--name",
			"p12-life",
			"--person",
			"person_01m6v5270hf3c8x2q7w9z4k5mn",
			"--founder",
			key,
			"--window",
			"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
		],
		{env, detached: true, stdio: ["ignore", "pipe", "pipe"]},
	);
	children.push(child);
	groups.push(child.pid!);
	let output = "";
	child.stdout!.on("data", (b: Buffer) => {
		output += b.toString();
	});
	child.stderr!.on("data", (b: Buffer) => {
		output += b.toString();
	});
	const url = `http://127.0.0.1:${at.port}`;
	for (;;) {
		if (child.exitCode !== null) throw new Error(`P12 dev.ts did not start: ${output}`);
		try {
			if ((await fetch(url)).ok) break;
		} catch {
			/* Listener is not ready. */
		}
		await pause();
	}
	return {child, folder, url, output: () => output};
};
const workerd = async (parent: number, excluding = 0) => {
	for (;;) {
		const children = tree(parent).filter(
			(r) => /\/workerd(?:\s|$)/.test(r.command) && r.pid !== excluding,
		);
		if (children.length === 0) {
			await pause();
			continue;
		}
		expect(children).toHaveLength(1);
		return children[0]!.pid;
	}
};

describe("P12 local brain life", () => {
	it.effect(
		"p81 plant: sample workerd RSS, replace at 500000000, never measure the Node parent",
		() =>
			Effect.gen(function* () {
				const {checkMemory} = yield* Effect.promise(() => import("./local-stage.ts"));
				const sampled: Array<number> = [],
					requests: Array<unknown> = [];
				for (const bytes of [499_999_999, 500_000_000, 500_000_001]) {
					yield* checkMemory({
						pid: 417,
						sample: (pid: number) =>
							Effect.sync(() => {
								sampled.push(pid);
								return bytes;
							}),
						replace: (reason: unknown) =>
							Effect.sync(() => {
								requests.push(reason);
							}),
					});
				}
				expect(sampled).toEqual([417, 417, 417]);
				expect(sampled).not.toContain(process.pid);
				expect(requests).toEqual([
					{why: "memory", pid: 417, bytes: 500_000_000},
					{why: "memory", pid: 417, bytes: 500_000_001},
				]);
			}),
	);
	it.effect(
		"p81/content plant: remove a pending fact before acknowledgement or leak error text",
		() =>
			Effect.gen(function* () {
				const {brainOutbox} = yield* Effect.promise(() => import("./local-stage.ts"));
				const folder = home();
				let outbox = yield* brainOutbox(folder);
				const fact = {
					id: "brain-start-1",
					_tag: "started",
					start: "process_01jc9q4w7z3m8n5r2t6v0xkb4d",
					after: null,
					build: "build-a",
					why: "open",
					pid: 417,
					at: 42,
				};
				yield* outbox.add(fact);
				yield* Effect.exit(outbox.flush(() => Effect.fail(new Error("private control failure"))));
				outbox = yield* brainOutbox(folder);
				expect(yield* outbox.pending).toEqual([fact]);
				const sent: Array<unknown> = [];
				yield* outbox.flush((row: unknown) =>
					Effect.sync(() => {
						sent.push(row);
					}),
				);
				expect(sent).toEqual([fact]);
				expect(yield* outbox.pending).toEqual([]);
				yield* outbox.add(fact);
				yield* outbox.flush((row: unknown) =>
					Effect.sync(() => {
						sent.push(row);
					}),
				);
				expect(sent).toEqual([fact, fact]); // Same stable id lets Project deduplicate a lost reply.
				expect(readFileSync(join(folder, "brain.pending.jsonl"), "utf8")).not.toContain(
					"private control failure",
				);
			}),
	);
	it("p81 plant: an outer retry loop defeats Alchemy's three-replacement brake", async () => {
		const s = await launch();
		let prior = 0;
		const pids: Array<number> = [];
		const delays: Array<number> = [];
		for (let n = 0; n < 4; n++) {
			const pid = await workerd(s.child.pid!, prior);
			pids.push(pid);
			const began = performance.now();
			process.kill(pid, "SIGKILL");
			if (n < 3) {
				prior = await workerd(s.child.pid!, pid);
				delays.push(performance.now() - began);
				prior = pid;
			}
		}
		expect(new Set(pids).size).toBe(4);
		// Installed compatibility policy, not a new fabrika default.
		for (const [n, ms] of delays.entries()) expect(ms).toBeGreaterThanOrEqual(250 * 2 ** n);
		await pause();
		expect(tree(s.child.pid!).filter((r) => /\/workerd(?:\s|$)/.test(r.command))).toEqual([]);
		const {brainOutbox} = await import("./local-stage.ts");
		const pending = await Effect.runPromise(
			Effect.flatMap(brainOutbox(s.folder), (o: any) => o.pending),
		);
		expect(pending).toEqual(expect.arrayContaining([expect.objectContaining({_tag: "braked"})]));
		// Wait past every installed backoff. No new child or outer HTTP restart is allowed.
		await new Promise<void>((done) => setTimeout(done, 2000));
		expect(tree(s.child.pid!).filter((r) => /\/workerd(?:\s|$)/.test(r.command))).toEqual([]);
	});
	it.each(["SIGTERM", "SIGKILL"] as const)(
		"group cleanup plant: killing only Node leaves a listener after %s",
		async (signal) => {
			const s = await launch();
			await workerd(s.child.pid!);
			const descendants = tree(s.child.pid!).map((r) => r.pid);
			s.child.kill(signal);
			for (;;) {
				if (descendants.every((pid) => !living(pid))) break;
				await pause();
			}
			await expect(fetch(s.url)).rejects.toThrow();
			await new Promise<void>((done) => setTimeout(done, 1100));
			expect(descendants.filter(living)).toEqual([]);
		},
	);
});
