// P12, next/. Outside only: P12_OUTSIDE=1 pnpm exec vitest run --maxWorkers=1 <this file>.
// The managed sandbox cannot bind sockets. These run the real dev.ts and real process groups.
import {spawn, type ChildProcess} from "node:child_process";
import {existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {createServer} from "node:net";
import {tmpdir} from "node:os";
import {join, resolve} from "node:path";
import {pathToFileURL} from "node:url";
import {afterEach, describe, expect, it} from "vitest";

const pause = () => new Promise<void>((done) => setTimeout(done, 20));
const until = async (test: () => boolean, label: string) => {
	const end = Date.now() + 15_000;
	while (!test() && Date.now() < end) await pause();
	expect(test(), label).toBe(true);
};
const alive = (pid: number) => {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
};
const homes: Array<string> = [],
	groups: Array<number> = [],
	children: Array<ChildProcess> = [];
afterEach(async () => {
	for (const group of groups.splice(0)) {
		try {
			process.kill(-group, "SIGKILL");
		} catch {
			/* Gone. */
		}
	}
	for (const child of children.splice(0))
		if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
	for (const home of homes.splice(0)) rmSync(home, {recursive: true, force: true});
});
const launchBeforeReady = async () => {
	const home = mkdtempSync(join(tmpdir(), "p12-early-"));
	homes.push(home);
	const blocked = join(home, "building.json"),
		helper = join(home, "helper.json"),
		release = join(home, "release");
	const preload = join(home, "startup-hook.mjs");
	const build = pathToFileURL(resolve(import.meta.dirname, "build.ts")).href;
	// The hook delays the real build. Its group member holds a real listener. No product file changes.
	const delayed = [
		'import {Effect} from "effect";',
		`import {build as actual} from ${JSON.stringify(`${build}?p12-actual`)};`,
		'import {existsSync, writeFileSync} from "node:fs"; import {spawn} from "node:child_process";',
		'export const build = Effect.fn("test.startup")(function* (options) {',
		`writeFileSync(${JSON.stringify(blocked)}, JSON.stringify({pid: process.pid, parent: process.ppid}));`,
		`spawn(process.execPath, ["--input-type=module", "-e", ${JSON.stringify(`import {createServer} from "node:net"; import {writeFileSync} from "node:fs"; const server = createServer(); server.listen(0, "127.0.0.1", () => writeFileSync(${JSON.stringify(helper)}, JSON.stringify({pid:process.pid,port:server.address().port})));`)}], {stdio:"ignore"});`,
		`while (!existsSync(${JSON.stringify(release)})) yield* Effect.sleep("20 millis");`,
		"return yield* actual(options); });",
	].join("\n");
	writeFileSync(
		preload,
		`import {registerHooks} from "node:module"; registerHooks({load(url, context, next) { if (url === ${JSON.stringify(build)}) return {format:"module", source:${JSON.stringify(delayed)}, shortCircuit:true}; return next(url, context); }});`,
	);
	const listener = createServer();
	await new Promise<void>((done, fail) => {
		listener.once("error", fail);
		listener.listen(0, "127.0.0.1", done);
	});
	const at = listener.address();
	if (at === null || typeof at === "string") throw new Error("no port");
	await new Promise<void>((done) => listener.close(() => done()));
	const env: NodeJS.ProcessEnv = {
		...process.env,
		FABRIKA_HOME: home,
		DO_NOT_TRACK: "1",
		NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --import=${pathToFileURL(preload).href}`,
	};
	delete env.TYPESAFE_API_KEY;
	delete env.FABRIKA_FOREGROUND;
	const parent = spawn(
		process.execPath,
		[
			resolve(import.meta.dirname, "../dev.ts"),
			"--port",
			String(at.port),
			"--name",
			"startup-contract",
			"--person",
			"person_01m6v5270hf3c8x2q7w9z4k5mn",
			"--founder",
			"ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
			"--window",
			"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
		],
		{env, stdio: ["ignore", "pipe", "pipe"]},
	);
	children.push(parent);
	let ready = false;
	parent.stdout!.on("data", (bytes: Buffer) => {
		if (bytes.toString().includes('"ready"')) ready = true;
	});
	parent.stderr!.resume();
	await until(() => existsSync(blocked) && existsSync(helper), "child reached the blocked build");
	const child = JSON.parse(readFileSync(blocked, "utf8")) as {pid: number; parent: number};
	const descendant = JSON.parse(readFileSync(helper, "utf8")) as {pid: number; port: number};
	groups.push(child.pid);
	expect(child.parent).toBe(parent.pid);
	expect(ready).toBe(false);
	return {parent, child, descendant, release, ready: () => ready};
};

describe.skipIf(process.env.P12_OUTSIDE !== "1")("P12 startup group cleanup, outside only", () => {
	it("parent death before readiness stops the whole stage group", async () => {
		const f = await launchBeforeReady();
		f.parent.kill("SIGKILL");
		writeFileSync(f.release, "continue");
		await until(
			() => !alive(f.child.pid) && !alive(f.descendant.pid),
			"no startup child or group member survives its parent",
		);
		await expect(fetch(`http://127.0.0.1:${f.descendant.port}`)).rejects.toThrow();
	});
	it("an exited group leader leaves its descendants covered by cleanup", async () => {
		const f = await launchBeforeReady();
		process.kill(f.child.pid, "SIGKILL");
		await until(
			() => f.parent.exitCode !== null || f.parent.signalCode !== null,
			"dev parent observes the leader exit",
		);
		await until(() => !alive(f.descendant.pid), "group cleanup still kills the remaining listener");
		await expect(fetch(`http://127.0.0.1:${f.descendant.port}`)).rejects.toThrow();
	});
});
