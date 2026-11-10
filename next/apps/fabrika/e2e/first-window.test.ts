// P14, next/ (Tier 1, ticket 286): the first browser window, on the real stage with real Chromium
// (check 1, p29 and the key, storage, Strict Mode and shot laws of the plan's "Laws" and "Browser
// checks, measurements and shots"). Written before the window, so each test is red until the built
// page exists. It starts the real `dev.ts` and drives the real buttons; it installs no client in the
// page and fulfils no page. Run it with the command the plan gives:
//   nice -n 19 pnpm exec vitest run --maxWorkers=1 --root next/apps/fabrika/e2e --fileParallelism=false \
//     --testTimeout=120000 --hookTimeout=120000 first-window.test.ts
// Every test here is a scenario: real WebCrypto, IndexedDB, grant signing, reload and a 4003 close
// cannot be had without the built tab and OS processes.
import {readFileSync} from "node:fs";
import {afterAll, beforeAll, describe, expect, it} from "vitest";
import {
	cleanup,
	connection,
	counts,
	grant,
	openProfile,
	otherKey,
	press,
	readWaiting,
	revoke,
	runGrant,
	shot,
	startStage,
	until,
	type Stage,
} from "./p14.test-support.ts";

let stage: Stage;
const profiles: Array<() => Promise<void>> = [];
beforeAll(async () => {
	stage = await startStage("p14-first");
}, 180_000);
afterAll(async () => {
	for (const close of profiles.splice(0)) await close().catch(() => undefined);
	await stage?.stop();
	if (stage !== undefined) cleanup(stage.home);
});
const profile = async (dir?: string) => {
	const p = await openProfile(dir);
	profiles.push(p.close);
	return p;
};
const waiting = (page: import("playwright").Page) => page.getByTestId("grant-code").first();
const counters = (page: import("playwright").Page) => page.getByRole("region", {name: /^counter/i});

describe("check 1 and p29: one code, a real grant, entry without a reload, a stable key", () => {
	it("scenario: two tabs show one code, one command grants both, a reload asks nothing, a wrong signer is refused, a removed key says so and Ask again starts a new wait", async () => {
		const dir = `${stage.home}/profile-a`;
		const p = await profile(dir);
		const one = await p.tab(stage.url);
		const two = await p.tab(stage.url);
		const w1 = await readWaiting(stage, one);
		const w2 = await readWaiting(stage, two);
		expect(w2.code, "both tabs share the profile key, so one code").toBe(w1.code);
		expect(w2.fingerprint).toBe(w1.fingerprint);
		expect(w1.command).toContain(`grant.ts client`);
		expect(w1.command).toContain(w1.fingerprint);
		expect(w1.command).toContain(w1.code);

		// A signer the person never trusted is refused, and the tabs stay waiting.
		const stranger = otherKey(stage.home, "stranger");
		await expect(runGrant(stage, w1.fingerprint, w1.code, stranger)).rejects.toThrow();
		await expect(waiting(one.page)).toBeVisible();

		// The real command grants both tabs at once, with no reload.
		let navigations = 0;
		one.page.on("framenavigated", () => navigations++);
		two.page.on("framenavigated", () => navigations++);
		const granted = await grant(stage, one);
		await counters(two.page).first().waitFor({timeout: 30_000});
		expect(navigations, "entry needs no reload").toBe(0);
		expect(await counts(one.page)).toEqual([0, 0]);
		expect(await connection(one.page)).toMatch(/online/i);

		// A reload shows no approval screen and keeps the same key.
		await one.page.reload();
		await counters(one.page).first().waitFor({timeout: 30_000});
		await expect(waiting(one.page)).toHaveCount(0);

		// The removed key: a close 4003 shows the words and stops reconnecting with that key.
		await revoke(stage, granted);
		await one.page.getByText("This window was removed").waitFor({timeout: 30_000});
		const sockets = one.urls.filter((u) => u.startsWith("ws")).length;
		await new Promise((done) => setTimeout(done, 3_000));
		expect(
			one.urls.filter((u) => u.startsWith("ws")).length,
			"no reconnect with a removed key",
		).toBe(sockets);
		await shot(one.page, "frame", "removed", "one");

		// Ask again replaces only the rejected identity and starts a fresh wait with a new fingerprint.
		await one.page.getByRole("button", {name: /ask again/i}).click();
		const fresh = await readWaiting(stage, one);
		expect(fresh.fingerprint).not.toBe(granted.fingerprint);
		await two.page.reload();
		expect(
			(await readWaiting(stage, two)).fingerprint,
			"a concurrent tab reuses the replacement",
		).toBe(fresh.fingerprint);
		await grant(stage, one);
		expect(await counts(one.page)).toEqual([0, 0]);
	});

	it("scenario: the key survives a browser restart, and it is not extractable or wrappable", async () => {
		const dir = `${stage.home}/profile-b`;
		const first = await openProfile(dir);
		const tab = await first.tab(stage.url);
		const granted = await grant(stage, tab);
		// Read-only inspection of whatever the page stored: one key pair, and the private half refuses export.
		const report = await tab.page.evaluate(async () => {
			const found: Array<{
				db: string;
				store: string;
				extractable: boolean | null;
				exportRefused: boolean;
				wrapRefused: boolean;
			}> = [];
			for (const info of await indexedDB.databases()) {
				const db = await new Promise<IDBDatabase>((done, fail) => {
					const open = indexedDB.open(info.name ?? "");
					open.onsuccess = () => done(open.result);
					open.onerror = () => fail(open.error);
				});
				for (const store of Array.from(db.objectStoreNames)) {
					const rows = await new Promise<Array<unknown>>((done, fail) => {
						const all = db.transaction(store).objectStore(store).getAll();
						all.onsuccess = () => done(all.result);
						all.onerror = () => fail(all.error);
					});
					for (const row of rows) {
						const pair = [
							row,
							...(typeof row === "object" && row !== null ? Object.values(row) : []),
						].find(
							(v): v is CryptoKeyPair => typeof v === "object" && v !== null && "privateKey" in v,
						);
						if (pair === undefined) continue;
						const refuse = (work: () => Promise<unknown>) =>
							work().then(
								() => false,
								() => true,
							);
						found.push({
							db: info.name ?? "",
							store,
							extractable: pair.privateKey.extractable,
							exportRefused: await refuse(() => crypto.subtle.exportKey("pkcs8", pair.privateKey)),
							wrapRefused: await refuse(async () =>
								crypto.subtle.wrapKey(
									"raw",
									pair.privateKey,
									await crypto.subtle.generateKey("AES-KW", false, ["wrapKey"]),
									"AES-KW",
								),
							),
						});
					}
				}
				db.close();
			}
			return found;
		});
		expect(report, "exactly one key pair is stored").toHaveLength(1);
		expect(report[0]).toMatchObject({extractable: false, exportRefused: true, wrapRefused: true});
		await first.close();
		// A new browser on the same profile directory: same key, no approval.
		const second = await profile(dir);
		const again = await second.tab(stage.url);
		await counters(again.page).first().waitFor({timeout: 30_000});
		await expect(waiting(again.page)).toHaveCount(0);
		void granted;
	});

	it("scenario: a failed key store is a visible blocked screen, and no key is made or kept in readable storage", async () => {
		const p = await profile();
		await p.context.addInitScript(() => {
			Object.defineProperty(window, "indexedDB", {
				value: {
					open: () => {
						throw new DOMException("denied", "SecurityError");
					},
					databases: () => Promise.resolve([]),
				},
			});
		});
		const tab = await p.tab(stage.url);
		await tab.page
			.getByText(/blocked/i)
			.first()
			.waitFor({timeout: 30_000});
		const stored = await tab.page.evaluate(() =>
			JSON.stringify({
				local: {...localStorage},
				session: {...sessionStorage},
				cookie: document.cookie,
			}),
		);
		expect(stored).not.toMatch(/PRIVATE|pkcs8|"d":/);
		await expect(waiting(tab.page)).toHaveCount(0);
	});
});

describe("Strict Mode and the selector hook", () => {
	it("scenario: one live client per tab under Strict Mode, current typed counts, and a clean console", async () => {
		const p = await profile();
		const tab = await p.tab(stage.url);
		await grant(stage, tab);
		const sockets = tab.urls.filter((u) => u.startsWith("ws")).length;
		expect(sockets, "Strict Mode starts one socket, not two").toBe(1);
		await press(tab.page, "Add one", 0);
		await press(tab.page, "Add one", 0);
		await press(tab.page, "Take one away", 1);
		await until("the counts to settle", async () =>
			(await counts(tab.page)).join() === "2,-1" ? true : undefined,
		);
		await press(tab.page, "Back to zero", 0);
		await until("the reset", async () =>
			(await counts(tab.page)).join() === "0,-1" ? true : undefined,
		);
		for (const n of await counts(tab.page)) expect(Number.isInteger(n)).toBe(true);
		expect(
			tab.console.filter((l) => /^(error|warning|pageerror)/.test(l)),
			"no console failure",
		).toEqual([]);
		expect(tab.urls.filter((u) => u.startsWith("ws")).length).toBe(1);
	});
});

describe("[secrets] private key data and control credentials stay out of every output", () => {
	// A flow over made-up sentinels: the person's throwaway private key body, its encoded forms, and
	// each output the page and stage produce. The check is planted on each output below.
	const forms = (s: string): ReadonlyArray<string> => [
		s,
		Buffer.from(s).toString("base64"),
		encodeURIComponent(s),
		Buffer.from(s).toString("hex"),
	];
	const leaks = (
		sentinels: ReadonlyArray<string>,
		outputs: Readonly<Record<string, string>>,
	): ReadonlyArray<string> =>
		Object.entries(outputs).flatMap(([name, text]) =>
			sentinels.flatMap((s) =>
				forms(s)
					.filter((f) => f.length >= 12 && text.includes(f))
					.map(() => name),
			),
		);

	it("scenario: the page, script, URLs, console, storage and stage output hold none of the key", async () => {
		const p = await profile();
		const tab = await p.tab(stage.url);
		await grant(stage, tab);
		await press(tab.page, "Add one", 0);
		const body = readFileSync(stage.key, "utf8")
			.split("\n")
			.filter((l) => l.length > 20 && !l.startsWith("-----"));
		const html = await tab.page.content();
		const script = await (await fetch(`${stage.url}/window.js`)).text();
		const storage = await tab.page.evaluate(() =>
			JSON.stringify({local: {...localStorage}, session: {...sessionStorage}}),
		);
		const outputs = {
			html,
			script,
			urls: tab.urls.join("\n"),
			console: tab.console.join("\n"),
			storage,
			stage: stage.output(),
		};
		expect(leaks(body, outputs)).toEqual([]);
		// The planted leak: the same check on each output with one sentinel put into it must name it.
		for (const name of Object.keys(outputs)) {
			expect(
				leaks(body, {
					...outputs,
					[name]: `${outputs[name as keyof typeof outputs]}\n${body[0] ?? ""}`,
				}),
				`a leak planted in ${name}`,
			).toContain(name);
		}
	});
});

describe("shots: the built page at five arrangements", () => {
	const layouts = [
		["one", "one", {width: 1280, height: 800}],
		["side", "row", {width: 1280, height: 800}],
		["stacked", "col", {width: 1280, height: 800}],
		["grid", "grid", {width: 1280, height: 800}],
		["small", "grid", {width: 1024, height: 700}],
	] as const;
	for (const [name, query, size] of layouts) {
		it(`scenario: waiting, granted at zero and after a press, at ${name}`, async () => {
			const p = await profile();
			const tab = await p.tab(`${stage.url}/?layout=${query}`, size);
			await waiting(tab.page).waitFor({timeout: 30_000});
			await shot(tab.page, "frame", "waiting", name);
			await grant(stage, tab);
			expect(await counts(tab.page)).toHaveLength(query === "one" ? 1 : query === "grid" ? 4 : 2);
			await shot(tab.page, "counter", "granted", name);
			await press(tab.page, "Add one", 0);
			await until("the press", async () => ((await counts(tab.page))[0] === 1 ? true : undefined));
			await shot(tab.page, "counter", "pressed", name);
			// Counts, actions and status stay usable at every size: each button is visible and inside the tab.
			for (const button of await tab.page
				.getByRole("button", {name: /Add one|Take one away|Back to zero/})
				.all()) {
				const box = await button.boundingBox();
				expect(box, "a button is on screen").not.toBeNull();
				expect((box?.x ?? -1) + (box?.width ?? 0)).toBeLessThanOrEqual(size.width + 1);
				expect((box?.y ?? -1) + (box?.height ?? 0)).toBeLessThanOrEqual(size.height + 1);
			}
		});
	}
	it("scenario: a light look and forced colors keep the counts and actions in view", async () => {
		const p = await profile();
		const tab = await p.tab(stage.url);
		await grant(stage, tab);
		for (const media of [{colorScheme: "light"}, {forcedColors: "active"}] as const) {
			await tab.page.emulateMedia(media);
			for (const button of await tab.page
				.getByRole("button", {name: /Add one|Take one away|Back to zero/})
				.all())
				await expect(button).toBeVisible();
			await expect(tab.page.getByTestId("count").first()).toBeVisible();
			await shot(tab.page, "frame", `${Object.keys(media)[0]}`, "one");
		}
	});
	it("scenario: a stopped stage shows the disconnected frame with the last count kept", async () => {
		const p = await profile();
		const tab = await p.tab(stage.url);
		await grant(stage, tab);
		await press(tab.page, "Add one", 0);
		await until("the press", async () => ((await counts(tab.page))[0] === 1 ? true : undefined));
		await stage.stop();
		await until("the frame to say so", async () =>
			/offline|reconnecting/i.test(await connection(tab.page)) ? true : undefined,
		);
		expect((await counts(tab.page))[0], "the last checked count stays visible").toBe(1);
		await shot(tab.page, "frame", "disconnected", "one");
		await stage.start();
		await until(
			"the tab to recover",
			async () => (/online/i.test(await connection(tab.page)) ? true : undefined),
			60_000,
		);
	});
});
