// P19, next/. The Electron app with the stand-in seal and launchctl's stand-in (plan "Laws", the
// Electron rows CI runs): founding then reopen keeps the person, the page holds no private key and
// no signer over its own bytes, a request binds the top frame, window and URL, the window's
// security settings and navigation limits hold, capabilities come from real calls, close keeps the
// app and brain while Cmd-Q stops both, and broken options are refused, not crashed on.
//
// Each run gets its own `mktemp -d /tmp/fh.XXXX` home. One Electron app at a time.
import {mkdtempSync, readFileSync, rmSync} from "node:fs";
import {NodeServices} from "@effect/platform-node";
import type {FileSystem, Scope} from "effect";
import {Effect} from "effect";
import * as fc from "fast-check";
import type {Page} from "playwright";
import {afterEach, describe, expect, it} from "vitest";
import {alive, launchP19, testLabel} from "./p19.test-support.ts";

const SEED = 119120;
const homes: Array<string> = [];
afterEach(() => {
	for (const h of homes.splice(0)) rmSync(h, {recursive: true, force: true});
});
const home = () => {
	const h = mkdtempSync("/tmp/fh.");
	homes.push(h);
	return h;
};
const scoped = <A, E>(effect: Effect.Effect<A, E, Scope.Scope | FileSystem.FileSystem>) =>
	Effect.runPromise(Effect.scoped(effect).pipe(Effect.provide(NodeServices.layer)));
const brainPid = (h: string): number => {
	try {
		return Number(JSON.parse(readFileSync(`${h}/p19-brain.json`, "utf8")).pid);
	} catch {
		return 0;
	}
};
const waitFor = async (check: () => boolean | Promise<boolean>, ms = 15_000) => {
	const end = Date.now() + ms;
	while (Date.now() < end) {
		if (await check()) return true;
		await new Promise((done) => setTimeout(done, 100));
	}
	return false;
};

/** The names the preload put on the page: the top window's own names a fresh same-origin frame lacks. */
const exposedNames = (page: Page) =>
	page.evaluate(() => {
		const frame = document.createElement("iframe");
		document.body.append(frame);
		const plain = new Set(Object.getOwnPropertyNames(frame.contentWindow));
		frame.remove();
		return Object.getOwnPropertyNames(window).filter((n) => !plain.has(n));
	});

/** Found through the real founding page: type a name, press Start, wait for the connected page. */
const found = async (page: Page, name: string) => {
	await page.getByRole("textbox").fill(name);
	await page.getByRole("button", {name: /start/i}).click();
	await page.waitForURL(/\/electron$/, {timeout: 30_000});
};

describe("P19 Electron, stand-in seal and brain", () => {
	it("plant, generate on every open or rewrite founded: a founded home reopens on the same person and window key, with no founding page", async () => {
		await fc.assert(
			fc.asyncProperty(
				fc.string({minLength: 1, maxLength: 24}).filter((s) => s.trim().length > 0),
				fc.array(fc.constantFrom("reopen", "close-reopen"), {minLength: 1, maxLength: 2}),
				async (name, ops) => {
					const h = home();
					const label = testLabel();
					await scoped(
						Effect.gen(function* () {
							const first = yield* launchP19({home: h, label, seal: "stand-in", brain: "stand-in"});
							expect(new URL(first.url).protocol, "founding loads from a packaged local file").toBe(
								"file:",
							);
							yield* Effect.promise(() => found(first.page, name));
							const names = yield* Effect.promise(() => exposedNames(first.page));
							const before = yield* Effect.promise(() =>
								first.page.evaluate((n) => Reflect.get(window, n[0]!).identity(), names),
							);
							yield* first.stop;
							for (const op of ops) {
								const again = yield* launchP19({
									home: h,
									label,
									seal: "stand-in",
									brain: "stand-in",
									built: first.built,
								});
								expect(again.url).toMatch(/\/electron$/);
								const now = yield* Effect.promise(() =>
									again.page.evaluate((n) => Reflect.get(window, n[0]!).identity(), names),
								);
								expect(now.key, op).toBe(before.key);
								if (op === "close-reopen") yield* Effect.promise(() => again.page.close());
								yield* again.stop;
							}
						}),
					);
				},
			),
			{seed: SEED, numRuns: 2},
		);
	});

	it("plant, expose generic sign, export, a path or IPC: the page gets one narrow object, and any call it makes yields no private key and no signature over its bytes", async () => {
		const h = home();
		await scoped(
			Effect.gen(function* () {
				const app = yield* launchP19({
					home: h,
					label: testLabel(),
					seal: "stand-in",
					brain: "stand-in",
				});
				yield* Effect.promise(() => found(app.page, "p30"));
				const names = yield* Effect.promise(() => exposedNames(app.page));
				expect(names, "one exposed bridge object").toHaveLength(1);
				const members = yield* Effect.promise(() =>
					app.page.evaluate((n) => Object.keys(Reflect.get(window, n) as object).sort(), names[0]!),
				);
				expect(
					members.filter((m) => /private|export|path|file|ipc|raw|bytes|grant|launch/i.test(m)),
				).toEqual([]);
				const node = yield* Effect.promise(() =>
					app.page.evaluate(() => [
						typeof Reflect.get(window, "require"),
						typeof Reflect.get(window, "process"),
						typeof Reflect.get(window, "ipcRenderer"),
					]),
				);
				expect(node).toEqual(["undefined", "undefined", "undefined"]);
				const attempts = fc.sample(
					fc.tuple(fc.constantFrom(...members), fc.jsonValue(), fc.string()),
					{seed: SEED, numRuns: 40},
				);
				const answers = yield* Effect.promise(() =>
					app.page.evaluate(
						async ([n, tries]) => {
							const api = Reflect.get(window, n) as Record<string, unknown>;
							const out: Array<string> = [];
							for (const [member, arg, text] of tries) {
								const fn = api[member];
								if (typeof fn !== "function") continue;
								try {
									out.push(JSON.stringify(await fn(arg)));
									out.push(JSON.stringify(await fn({text, bytes: text, nonce: text})));
								} catch (error) {
									out.push(String(error));
								}
							}
							return out;
						},
						[names[0]!, attempts] as const,
					),
				);
				for (const a of answers) expect(a).not.toMatch(/PRIVATE KEY|"d":|-----BEGIN|P19-TEST-SEAL/);
			}),
		);
	});

	it("plant, trust the page URL or accept a child frame: only the bound top frame gets a hello proof, for its bound URL and tab", async () => {
		const h = home();
		await scoped(
			Effect.gen(function* () {
				const app = yield* launchP19({
					home: h,
					label: testLabel(),
					seal: "stand-in",
					brain: "stand-in",
				});
				yield* Effect.promise(() => found(app.page, "binding"));
				const names = yield* Effect.promise(() => exposedNames(app.page));
				const fromChild = yield* Effect.promise(() =>
					app.page.evaluate(async (n) => {
						const child = (document.getElementById("child") as HTMLIFrameElement).contentWindow;
						const api =
							child === null
								? undefined
								: (Reflect.get(child, n) as {identity?: () => Promise<unknown>} | undefined);
						if (api?.identity === undefined) return "absent";
						try {
							return JSON.stringify(await api.identity());
						} catch {
							return "refused";
						}
					}, names[0]!),
				);
				expect(["absent", "refused"]).toContain(fromChild);
				const top = yield* Effect.promise(() =>
					app.page.evaluate(async (n) => {
						const api = Reflect.get(window, n) as {
							identity: () => Promise<{tab: string; key: string}>;
							sign: (h: unknown) => Promise<string>;
						};
						const id = await api.identity();
						const wrongTab = await api.sign({nonce: "n1", tab: `${id.tab}x`}).then(
							() => "signed",
							() => "refused",
						);
						return {id, wrongTab, good: await api.sign({nonce: "n1", tab: id.tab})};
					}, names[0]!),
				);
				expect(top.wrongTab).toBe("refused");
				expect(top.good).toContain("BEGIN SSH SIGNATURE");
			}),
		);
	});

	it("plant, enable Node or allow a popup or foreign navigation: sandboxed, isolated, no Node, no new window, no leaving the bound page", async () => {
		const h = home();
		await scoped(
			Effect.gen(function* () {
				const app = yield* launchP19({
					home: h,
					label: testLabel(),
					seal: "stand-in",
					brain: "stand-in",
				});
				const founding = yield* Effect.promise(() =>
					app.app.evaluate(({BrowserWindow}) =>
						BrowserWindow.getAllWindows().map((w) => w.webContents.getLastWebPreferences()),
					),
				);
				yield* Effect.promise(() => found(app.page, "flags"));
				const connected = yield* Effect.promise(() =>
					app.app.evaluate(({BrowserWindow}) =>
						BrowserWindow.getAllWindows().map((w) => w.webContents.getLastWebPreferences()),
					),
				);
				for (const prefs of [...founding, ...connected])
					expect(prefs).toMatchObject({
						sandbox: true,
						contextIsolation: true,
						nodeIntegration: false,
					});
				const bound = app.page.url();
				yield* Effect.promise(() =>
					app.page.evaluate(() => void window.open("https://example.com/", "_blank")),
				);
				yield* Effect.promise(() =>
					app.page
						.evaluate(() => (window.location.href = "https://example.com/"))
						.catch(() => undefined),
				);
				yield* Effect.promise(() => new Promise((done) => setTimeout(done, 500)));
				expect(app.app.windows()).toHaveLength(1);
				expect(app.page.url()).toBe(bound);
			}),
		);
	});

	it("plant, hardcode seal and verify: the capability list matches the seal's answer and Touch ID's", async () => {
		for (const available of ["1", "0"]) {
			const h = home();
			await scoped(
				Effect.gen(function* () {
					const app = yield* launchP19({
						home: h,
						label: testLabel(),
						seal: "stand-in",
						brain: "stand-in",
						env: {P19_SEAL_AVAILABLE: available},
					});
					const touch = yield* Effect.promise(() =>
						app.app.evaluate(
							({systemPreferences}) =>
								process.platform === "darwin" && systemPreferences.canPromptTouchID(),
						),
					);
					if (available === "1") yield* Effect.promise(() => found(app.page, "caps"));
					const names = yield* Effect.promise(() => exposedNames(app.page));
					const caps = yield* Effect.promise(() =>
						app.page.evaluate(async (n) => {
							const api = Reflect.get(window, n) as {
								capabilities?: () => Promise<ReadonlyArray<string>> | ReadonlyArray<string>;
							};
							return api.capabilities === undefined ? null : await api.capabilities();
						}, names[0]!),
					);
					expect(caps, "the preload hands the checked capability list").not.toBeNull();
					expect(caps!.includes("seal")).toBe(available === "1");
					expect(caps!.includes("verify")).toBe(touch);
				}),
			);
		}
	});

	it("plant, quit on last window or tie the brain to the window: close keeps app and brain, activate reopens, Cmd-Q stops the brain before the app ends", async () => {
		const h = home();
		await scoped(
			Effect.gen(function* () {
				const app = yield* launchP19({
					home: h,
					label: testLabel(),
					seal: "stand-in",
					brain: "stand-in",
				});
				yield* Effect.promise(() => found(app.page, "life"));
				const pid = brainPid(h);
				expect(alive(pid)).toBe(true);
				yield* Effect.promise(() => app.page.close());
				yield* Effect.promise(() => new Promise((done) => setTimeout(done, 500)));
				expect(
					yield* Effect.promise(() =>
						app.app.evaluate(({BrowserWindow}) => BrowserWindow.getAllWindows().length),
					),
				).toBe(0);
				expect(alive(pid), "closing the window stopped the brain").toBe(true);
				yield* Effect.promise(() => app.app.evaluate(({app: a}) => void a.emit("activate")));
				const back = yield* Effect.promise(() => app.app.waitForEvent("window"));
				yield* Effect.promise(() => back.waitForURL(/\/electron$/));
				const appPid = app.app.process().pid ?? 0;
				yield* app.stop;
				expect(yield* Effect.promise(() => waitFor(() => !alive(appPid)))).toBe(true);
				expect(alive(pid), "the app ended with its brain still up").toBe(false);
			}),
		);
	});

	it("plant, let a bad option crash the app: each broken top-level option is refused, and the app stays up", async () => {
		for (const key of ["home", "pages", "localBrain", "window"]) {
			const h = home();
			await scoped(
				Effect.gen(function* () {
					const app = yield* launchP19({
						home: h,
						label: testLabel(),
						seal: "stand-in",
						brain: "stand-in",
						env: {P19_CORRUPT: key},
					});
					yield* Effect.promise(() => new Promise((done) => setTimeout(done, 1000)));
					expect(app.app.process().exitCode, key).toBeNull();
					expect(brainPid(h), `${key}: a broken option started a brain`).toBe(0);
				}),
			);
		}
	});
});
