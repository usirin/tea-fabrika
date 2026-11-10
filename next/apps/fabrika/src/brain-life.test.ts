// P12, next/. Unit checks own the outbox and memory sampling. Child cleanup uses the real dev.ts.
import {spawn, execFileSync, type ChildProcess} from "node:child_process";
import {existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {createServer} from "node:net";
import {tmpdir} from "node:os";
import {join, resolve} from "node:path";
import {NodeServices} from "@effect/platform-node";
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
		// A child killed by a signal keeps `exitCode` null; `signalCode` says it already ended.
		if (child.exitCode === null && child.signalCode === null) {
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

const launch = async (startupGate = false) => {
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
	const env: NodeJS.ProcessEnv = {...process.env, FABRIKA_HOME: folder, DO_NOT_TRACK: "1"};
	delete env.TYPESAFE_API_KEY;
	delete env.FABRIKA_FOREGROUND;
	delete env.CLOUDFLARE_API_TOKEN;
	if (startupGate) {
		const preload = join(folder, "startup.mjs");
		// Delay only the detached child. Kill its parent before startup can finish.
		// This is a test-only Node import, not a product startup flag.
		writeFileSync(
			preload,
			`import {existsSync,writeFileSync} from "node:fs"; if (process.argv.includes("--child")) {writeFileSync(${JSON.stringify(join(folder, "starting"))}, String(process.pid)); while (!existsSync(${JSON.stringify(join(folder, "startup-release"))})) await new Promise(done => setTimeout(done, 25));}`,
		);
		env.NODE_OPTIONS = `${env.NODE_OPTIONS ?? ""} --import=${preload}`;
	}
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
	const observed: Array<{at: number; pids: number[]; ready: boolean}> = [];
	if (startupGate) {
		while (!existsSync(join(folder, "starting"))) {
			if (child.exitCode !== null || child.signalCode !== null)
				throw new Error("stage ended before startup gate");
			await pause();
		}
		return {child, folder, url, output: () => output, observed};
	}
	for (;;) {
		if (child.exitCode !== null) throw new Error(`P12 dev.ts did not start: ${output}`);
		try {
			if ((await fetch(url)).ok) break;
		} catch {
			/* Listener is not ready. */
		}
		await pause();
	}
	return {child, folder, url, output: () => output, observed};
};

const workerd = async (stage: Awaited<ReturnType<typeof launch>>, excluding = 0) => {
	const until = performance.now() + 10_000;
	const details = () =>
		`excluding=${excluding}, observed=${JSON.stringify(stage.observed)}\nstage output:\n${stage.output()}`;
	const {brainOutbox} = await import("@kampus/libfabrika/node/local-stage");
	const outbox = await Effect.runPromise(
		brainOutbox(stage.folder).pipe(Effect.provide(NodeServices.layer)),
	);
	for (;;) {
		const pending = await Effect.runPromise(
			outbox.pending.pipe(Effect.provide(NodeServices.layer)),
		);
		const stopped = pending.find((event) => event._tag === "braked");
		if (stopped !== undefined)
			throw new Error(`P12 workerd unavailable: ${stopped._tag} (${stopped.reason})\n${details()}`);
		if (stage.child.exitCode !== null || stage.child.signalCode !== null)
			throw new Error(
				`P12 dev.ts exited while waiting for workerd: exitCode=${stage.child.exitCode}, signal=${stage.child.signalCode}\n${details()}`,
			);
		if (performance.now() >= until)
			throw new Error(`P12 workerd did not become ready within 10 seconds\n${details()}`);
		const children = tree(stage.child.pid!).filter((r) => /\/workerd(?:\s|$)/.test(r.command));
		const observation = {at: performance.now(), pids: children.map((row) => row.pid), ready: false};
		stage.observed.push(observation);
		if (children.length === 0 || children[0]!.pid === excluding) {
			await pause();
			continue;
		}
		expect(children, details()).toHaveLength(1);
		// Alchemy retries SystemError spawns. A PID in ps may die before it ever listens.
		// Accept it only after HTTP answers and a fresh ps still shows that sole PID.
		try {
			const response = await fetch(stage.url, {signal: AbortSignal.timeout(250)});
			observation.ready = response.ok;
			await response.body?.cancel();
		} catch {
			/* Spawn attempt has not reached its listener. */
		}
		const current = tree(stage.child.pid!).filter((r) => /\/workerd(?:\s|$)/.test(r.command));
		if (observation.ready && current.length === 1 && current[0]!.pid === children[0]!.pid)
			return children[0]!.pid;
		await pause();
	}
};

describe("P12 local brain life", () => {
	// Outside only: real dev.ts, process groups and TCP. This sandbox cannot bind sockets.
	it("scenario: parent death before listener readiness leaves no stage group", async () => {
		const s = await launch(true);
		const leader = Number(readFileSync(join(s.folder, "starting"), "utf8"));
		groups.push(leader);
		expect(living(leader)).toBe(true);
		await expect(fetch(s.url)).rejects.toThrow();
		s.child.kill("SIGKILL");
		await new Promise<void>((done) => s.child.once("exit", () => done()));
		writeFileSync(join(s.folder, "startup-release"), "");
		const until = performance.now() + 10_000;
		while (living(leader) && performance.now() < until) await pause();
		expect(
			living(leader),
			"the detached child must notice its original parent died during startup",
		).toBe(false);
		expect(tree(leader).filter((row) => living(row.pid))).toEqual([]);
		await expect(fetch(s.url)).rejects.toThrow();
	});
	// Outside only: cleanup must address the process group after its leader already exited.
	it("scenario: stage group cleanup still reaches descendants after the leader exits", async () => {
		const s = await launch();
		const rows = tree(s.child.pid!),
			leader = rows.find((row) => row.parent === s.child.pid && row.command.includes("--child"));
		expect(leader).toBeDefined();
		groups.push(leader!.pid);
		const descendants = tree(leader!.pid)
			.filter((row) => row.pid !== leader!.pid)
			.map((row) => row.pid);
		expect(descendants.length).toBeGreaterThan(0);
		process.kill(leader!.pid, "SIGKILL");
		const until = performance.now() + 5_000;
		while (descendants.some(living) && performance.now() < until) await pause();
		expect(descendants.filter(living)).toEqual([]);
		await expect(fetch(s.url)).rejects.toThrow();
	});
	it("scenario: p81 plant: an outer retry loop defeats Alchemy's three-replacement brake", async () => {
		const s = await launch();
		let prior = 0;
		const pids: Array<number> = [];
		const delays: Array<number> = [];
		const details = () =>
			`pids=${JSON.stringify(pids)}, delays=${JSON.stringify(delays)}, observed=${JSON.stringify(s.observed)}\nstage output:\n${s.output()}`;
		try {
			for (let n = 0; n < 4; n++) {
				const pid = await workerd(s, prior);
				pids.push(pid);
				const began = performance.now();
				process.kill(pid, "SIGKILL");
				if (n < 3) {
					prior = await workerd(s, pid);
					delays.push(performance.now() - began);
					prior = pid;
				}
			}
			expect(new Set(pids).size, details()).toBe(4);
			// Installed compatibility policy, not a new fabrika default.
			for (const [n, ms] of delays.entries())
				expect(ms, details()).toBeGreaterThanOrEqual(250 * 2 ** n);
			await pause();
			expect(
				tree(s.child.pid!).filter((r) => /\/workerd(?:\s|$)/.test(r.command)),
				details(),
			).toEqual([]);
			const {brainOutbox} = await import("@kampus/libfabrika/node/local-stage");
			const pending = await Effect.runPromise(
				Effect.flatMap(brainOutbox(s.folder), (o) => o.pending).pipe(
					Effect.provide(NodeServices.layer),
				),
			);
			expect(pending, details()).toEqual(
				expect.arrayContaining([expect.objectContaining({_tag: "braked"})]),
			);
			// Wait past every installed backoff. No new child or outer HTTP restart is allowed.
			await new Promise<void>((done) => setTimeout(done, 2000));
			expect(
				tree(s.child.pid!).filter((r) => /\/workerd(?:\s|$)/.test(r.command)),
				details(),
			).toEqual([]);
		} catch (cause) {
			throw new Error(`P12 replacement/brake failure\n${details()}`, {cause});
		}
	});
	it.each(["SIGTERM", "SIGKILL"] as const)(
		"scenario: group cleanup plant: killing only Node leaves a listener after %s",
		async (signal) => {
			const s = await launch();
			await workerd(s);
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
