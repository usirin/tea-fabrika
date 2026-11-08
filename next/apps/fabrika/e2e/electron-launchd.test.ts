// P19, next/. The real launchd laws, laptop-only (plan "Laws": the launchd rows run on the laptop,
// and CI runs the same sequence with the stand-in in `electron.test.ts`). They load a job under a
// fresh `dev.fabrika.test.p19.<hex>` label from a temp home, never from LaunchAgents, and every
// test boots its label out and checks it is gone before it ends.
//
// p81: the brain's parent dies by SIGKILL, launchd starts one replacement on the same address, an
// Electron window and an admitted Chromium window both come back to the same real counter, and a
// letter held while the brain was down lands once. The app's own SIGKILL leaves the brain and the
// browser working, a reopen attaches to the same service, a foreign job or port is refused, P12's
// brake is not undone by the outer service, and Quit waits until the label and its children are gone.
import {execFileSync} from "node:child_process";
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {createServer} from "node:net";
import {NodeServices} from "@effect/platform-node";
import type {FileSystem, Scope} from "effect";
import {Effect} from "effect";
import {chromium, type Page} from "playwright";
import {afterEach, describe, expect, it} from "vitest";
import {alive, bootoutLabel, launchP19, printLabel, testLabel} from "./p19.test-support.ts";

const LAPTOP = process.platform === "darwin" && process.env["CI"] === undefined;
const labels: Array<string> = [];
const homes: Array<string> = [];
afterEach(() => {
	const left = labels.splice(0).filter((label) => !bootoutLabel(label));
	for (const h of homes.splice(0)) rmSync(h, {recursive: true, force: true});
	expect(left, "a test label is still loaded").toEqual([]);
});
const fresh = () => {
	const home = mkdtempSync("/tmp/fh.");
	const label = testLabel();
	homes.push(home);
	labels.push(label);
	return {home, label};
};
const scoped = <A, E>(effect: Effect.Effect<A, E, Scope.Scope | FileSystem.FileSystem>) =>
	Effect.runPromise(Effect.scoped(effect).pipe(Effect.provide(NodeServices.layer)));
const waitFor = async (check: () => boolean | Promise<boolean>, ms = 30_000) => {
	const end = Date.now() + ms;
	while (Date.now() < end) {
		if (await check()) return true;
		await new Promise((done) => setTimeout(done, 100));
	}
	return false;
};
const found = async (page: Page, name: string) => {
	await page.getByRole("textbox").fill(name);
	await page.getByRole("button", {name: /start/i}).click();
	await page.waitForURL(/\/electron$/, {timeout: 60_000});
};
/** The pids of a process's whole tree, from `ps`. */
const tree = (root: number): ReadonlyArray<number> => {
	const rows = execFileSync("ps", ["-axo", "pid=,ppid="], {encoding: "utf8"})
		.split("\n")
		.flatMap((row) => {
			const m = /^\s*(\d+)\s+(\d+)/.exec(row);
			return m ? [{pid: Number(m[1]), parent: Number(m[2])}] : [];
		});
	const pids = new Set([root]);
	for (let n = 0; n < rows.length; n++)
		for (const row of rows) if (pids.has(row.parent)) pids.add(row.pid);
	return [...pids];
};
/** The counter's number as the window draws it. */
const count = async (page: Page) =>
	Number((await page.getByTestId("counter-count").textContent())?.trim());

describe.runIf(LAPTOP)("P19 launchd, laptop-only", () => {
	it("plant, tie service stop to scope cleanup: the app's SIGKILL leaves the brain and Chromium working, and a reopen attaches to the same service", async () => {
		const {home, label} = fresh();
		await scoped(
			Effect.gen(function* () {
				const first = yield* launchP19({home, label, seal: "stand-in", brain: "launchd"});
				yield* Effect.promise(() => found(first.page, "app-kill"));
				const url = first.page.url();
				const before = printLabel(label);
				expect(before.code).toBe(0);
				const browser = yield* Effect.promise(() => chromium.launch());
				const tab = yield* Effect.promise(() => browser.newPage());
				yield* Effect.promise(() => tab.goto(url));
				process.kill(first.app.process().pid ?? 0, "SIGKILL");
				yield* Effect.promise(() => new Promise((done) => setTimeout(done, 1500)));
				expect(printLabel(label).pid, "the brain changed when the app died").toBe(before.pid);
				expect(alive(before.pid)).toBe(true);
				yield* Effect.promise(() => tab.reload());
				expect(tab.url()).toBe(url);
				const again = yield* launchP19({
					home,
					label,
					seal: "stand-in",
					brain: "launchd",
					built: first.built,
				});
				yield* Effect.promise(() => again.page.waitForURL(/\/electron$/));
				expect(printLabel(label).pid, "a reopen started a second brain").toBe(before.pid);
				yield* Effect.promise(() => browser.close());
				yield* again.stop;
			}),
		);
	});

	it("plant, bootstrap twice or attach to any listener: a foreign job on the label and a taken port are refused", async () => {
		const taken = fresh();
		const server = createServer();
		await scoped(
			Effect.gen(function* () {
				const app = yield* launchP19({
					home: taken.home,
					label: taken.label,
					seal: "stand-in",
					brain: "launchd",
				});
				// Hold the fixture's fixed port before Start, as another program would.
				const fixed =
					40_000 +
					([...taken.label].reduce((n, ch) => (n * 31 + ch.charCodeAt(0)) >>> 0, 7) % 20_000);
				yield* Effect.promise(
					() => new Promise<void>((done) => server.listen(fixed, "127.0.0.1", done)),
				);
				yield* Effect.promise(() => app.page.getByRole("textbox").fill("taken"));
				yield* Effect.promise(() => app.page.getByRole("button", {name: /start/i}).click());
				yield* Effect.promise(() => new Promise((done) => setTimeout(done, 3000)));
				expect(app.page.url()).not.toMatch(/\/electron$/);
				expect(printLabel(taken.label).code === 113 || printLabel(taken.label).pid === 0).toBe(
					true,
				);
				yield* app.stop;
			}),
		);
		server.close();
		const foreign = fresh();
		const plist = `${foreign.home}/foreign.plist`;
		writeFileSync(
			plist,
			`<?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><dict><key>Label</key><string>${foreign.label}</string><key>ProgramArguments</key><array><string>/bin/sleep</string><string>600</string></array><key>RunAtLoad</key><true/></dict></plist>`,
		);
		execFileSync("launchctl", ["bootstrap", `gui/${process.getuid?.() ?? 0}`, plist]);
		const foreignPid = await waitFor(() => printLabel(foreign.label).pid > 0).then(
			() => printLabel(foreign.label).pid,
		);
		await scoped(
			Effect.gen(function* () {
				const app = yield* launchP19({
					home: foreign.home,
					label: foreign.label,
					seal: "stand-in",
					brain: "launchd",
				});
				yield* Effect.promise(() => app.page.getByRole("textbox").fill("foreign"));
				yield* Effect.promise(() => app.page.getByRole("button", {name: /start/i}).click());
				yield* Effect.promise(() => new Promise((done) => setTimeout(done, 3000)));
				expect(app.page.url()).not.toMatch(/\/electron$/);
				expect(printLabel(foreign.label).pid, "the foreign job was replaced").toBe(foreignPid);
				yield* app.stop;
			}),
		);
	});

	it("plant, return on bootout: Quit leaves no label, no brain, no child and no plist", async () => {
		const {home, label} = fresh();
		await scoped(
			Effect.gen(function* () {
				const app = yield* launchP19({home, label, seal: "stand-in", brain: "launchd"});
				yield* Effect.promise(() => found(app.page, "quit"));
				const brain = printLabel(label).pid;
				const family = tree(brain);
				expect(family.length).toBeGreaterThan(1);
				const appPid = app.app.process().pid ?? 0;
				yield* app.stop;
				expect(yield* Effect.promise(() => waitFor(() => !alive(appPid)))).toBe(true);
				// The app was gone only after these held.
				expect(printLabel(label).code).toBe(113);
				expect(family.filter(alive)).toEqual([]);
				expect(() => readFileSync(`${home}/brain.plist`)).toThrow();
			}),
		);
	});

	it("plant, no KeepAlive, a new address or a lost resend (p81): a killed brain comes back once, on the same address, and both windows keep every letter once", async () => {
		const {home, label} = fresh();
		await scoped(
			Effect.gen(function* () {
				const app = yield* launchP19({home, label, seal: "stand-in", brain: "launchd"});
				yield* Effect.promise(() => found(app.page, "p81"));
				const url = app.page.url();
				const before = printLabel(label).pid;
				const family = tree(before);
				const browser = yield* Effect.promise(() => chromium.launch());
				const tab = yield* Effect.promise(() => browser.newPage());
				yield* Effect.promise(() => tab.goto(url.replace(/\/electron$/, "/")));
				yield* Effect.promise(() => app.page.getByRole("button", {name: /inc|\+/i}).click());
				expect(yield* Effect.promise(() => waitFor(async () => (await count(tab)) === 1))).toBe(
					true,
				);
				process.kill(before, "SIGKILL");
				// A press while the brain is down: held by the client, sent once on reconnect.
				yield* Effect.promise(() => app.page.getByRole("button", {name: /inc|\+/i}).click());
				expect(
					yield* Effect.promise(() =>
						waitFor(() => printLabel(label).pid > 0 && printLabel(label).pid !== before),
					),
				).toBe(true);
				const after = printLabel(label).pid;
				for (const page of [app.page, tab])
					expect(
						yield* Effect.promise(() => waitFor(async () => (await count(page)) === 2, 60_000)),
					).toBe(true);
				expect(app.page.url()).toBe(url);
				// One replacement, and none of the old group left behind.
				yield* Effect.promise(() => new Promise((done) => setTimeout(done, 2000)));
				expect(printLabel(label).pid).toBe(after);
				expect(family.filter((pid) => pid !== before && alive(pid))).toEqual([]);
				yield* Effect.promise(() => browser.close());
				yield* app.stop;
			}),
		);
	});

	it("plant, turn a braked shutdown into a failed exit: when P12 brakes, launchd starts no new brain", async () => {
		const {home, label} = fresh();
		await scoped(
			Effect.gen(function* () {
				const app = yield* launchP19({home, label, seal: "stand-in", brain: "launchd"});
				yield* Effect.promise(() => found(app.page, "brake"));
				const parent = printLabel(label).pid;
				// Kill workerd over and over, until P12's own brake holds it down.
				for (let i = 0; i < 12; i++) {
					const workers = tree(parent).filter((pid) => pid !== parent);
					for (const pid of workers) if (alive(pid)) process.kill(pid, "SIGKILL");
					yield* Effect.promise(() => new Promise((done) => setTimeout(done, 500)));
				}
				yield* Effect.promise(() => new Promise((done) => setTimeout(done, 5000)));
				const now = printLabel(label);
				expect(
					now.pid === parent || now.pid === 0,
					"launchd started another brain past the brake",
				).toBe(true);
				yield* app.stop;
			}),
		);
	});
});
