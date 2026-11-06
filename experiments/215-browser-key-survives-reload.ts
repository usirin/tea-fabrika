// Experiment 215: does a non-extractable Ed25519 key kept in IndexedDB survive a page reload and a
// full browser restart in Chromium, on a page served from http://127.0.0.1:<port>? (`next/`, Tier 1
// row P3, the plan's T5: a browser tab's own key.)
//
// One static page (experiments/215-browser-key-survives-reload/index.html) makes the key with
// `generateKey({name: "Ed25519"}, false, ["sign", "verify"])`, keeps the CryptoKeyPair in
// IndexedDB, and can sign with it and try to export it. This script serves the page on 127.0.0.1,
// opens Playwright's Chromium with a persistent profile in a fresh temp folder (never a real
// profile), and checks, for each case, that the same key is there, that it signs, and that every
// way to export it rejects:
//
//   first      the page's first visit: a key is made
//   reload     page.reload() in the same browser
//   restart    the browser closed and started again on the same profile folder
//   other-port the same page on a second port: a different origin, so it must see no key
//   localhost  the same page as http://localhost:<port>: also a different origin
//
// It runs twice, one browser at a time: Playwright's default headless shell, and channel
// "chromium" (Chromium's new headless mode, the full browser). The server stays up across the
// restart, so the origin, port included, never changes.
//
// No model, no key of ours, no network beyond 127.0.0.1, $0. Never prints key bytes: only names,
// flags, and whether two public fingerprints are equal.
//
//   env -u TYPESAFE_API_KEY nice -n 19 node experiments/215-browser-key-survives-reload.ts
//
// Playwright comes from apps/fabrika's own dependencies. Saves
// experiments/results/215-browser-key-survives-reload.json.

import {mkdtemp, readFile, rm, writeFile} from "node:fs/promises";
import {createServer, type Server} from "node:http";
import {createRequire} from "node:module";
import type {AddressInfo} from "node:net";
import {tmpdir} from "node:os";
import {join} from "node:path";

const root = join(import.meta.dirname, "..");
const require = createRequire(join(root, "apps/fabrika/package.json"));
const {chromium} = require("playwright") as typeof import("playwright");
const playwrightVersion = (require("playwright/package.json") as {version: string}).version;

const PAGE = join(import.meta.dirname, "215-browser-key-survives-reload/index.html");
const RESULTS = join(root, "experiments/results/215-browser-key-survives-reload.json");

type Ensure = {
	made: boolean;
	fingerprint: string;
	extractable: boolean;
	type: string;
	algorithm: string;
	usages: string[];
};
type Signed = {kept: boolean; bytes?: number; ok?: boolean};
type Exported = {kept: boolean; pkcs8?: string; jwk?: string; raw?: string; wrap?: string};
type Peek = {kept: boolean; fingerprint?: string};

// What the page puts on `window`, as the script calls it inside page.evaluate.
declare global {
	interface Window {
		exp215: {
			page: () => {secure: boolean; origin: string; ua: string};
			storage: () => Promise<{persisted: boolean}>;
			ensure: () => Promise<Ensure>;
			peek: () => Promise<Peek>;
			sign: (text: string) => Promise<Signed>;
			tryExport: () => Promise<Exported>;
		};
	}
}

const serve = (html: string): Promise<{server: Server; port: number}> =>
	new Promise((resolve) => {
		const server = createServer((_req, res) => {
			res.writeHead(200, {"content-type": "text/html; charset=utf-8"});
			res.end(html);
		});
		server.listen(0, "127.0.0.1", () =>
			resolve({server, port: (server.address() as AddressInfo).port}),
		);
	});

const close = (server: Server) => new Promise<void>((resolve) => server.close(() => resolve()));

const runMode = async (mode: "headless-shell" | "chromium", html: string) => {
	const profile = await mkdtemp(join(tmpdir(), "exp215-"));
	const a = await serve(html);
	const b = await serve(html);
	const url = `http://127.0.0.1:${a.port}/`;
	const launch = () =>
		chromium.launchPersistentContext(profile, {
			headless: true,
			...(mode === "chromium" ? {channel: "chromium"} : {}),
		});
	const cases: Record<string, unknown> = {};
	let browserVersion = "";
	let ua = "";
	try {
		// first visit
		let context = await launch();
		browserVersion = context.browser()?.version() ?? "";
		let page = context.pages()[0] ?? (await context.newPage());
		await page.goto(url);
		const info = await page.evaluate(() => window.exp215.page());
		ua = info.ua;
		const first = await page.evaluate(() => window.exp215.ensure());
		const check = async (name: string) => {
			const now = await page.evaluate(() => window.exp215.ensure());
			const signed = await page.evaluate(() => window.exp215.sign(`exp215 ${Date.now()}`));
			const exported = await page.evaluate(() => window.exp215.tryExport());
			const storage = await page.evaluate(() => window.exp215.storage());
			cases[name] = {
				madeNow: now.made,
				sameKey: now.fingerprint === first.fingerprint,
				extractable: now.extractable,
				type: now.type,
				algorithm: now.algorithm,
				usages: now.usages,
				signs: signed.ok === true,
				signatureBytes: signed.bytes,
				exportPkcs8: exported.pkcs8,
				exportJwk: exported.jwk,
				exportRaw: exported.raw,
				wrapKey: exported.wrap,
				persisted: storage.persisted,
			};
		};
		await check("first");
		cases["first"] = {...(cases["first"] as object), madeNow: first.made, secure: info.secure};

		await page.reload();
		await check("reload");

		await context.close();
		context = await launch();
		page = context.pages()[0] ?? (await context.newPage());
		await page.goto(url);
		await check("restart");

		// Two more origins in the same profile: they must not see the 127.0.0.1:<a> key.
		for (const [name, other] of [
			["other-port", `http://127.0.0.1:${b.port}/`],
			["localhost", `http://localhost:${a.port}/`],
		] as const) {
			try {
				await page.goto(other);
				const peek = await page.evaluate(() => window.exp215.peek());
				cases[name] = {keptHere: peek.kept};
			} catch (e) {
				cases[name] = {error: (e as Error).message.split("\n")[0]};
			}
		}
		await context.close();
	} finally {
		await close(a.server);
		await close(b.server);
		await rm(profile, {recursive: true, force: true});
	}
	return {mode, browserVersion, ua, cases};
};

const html = await readFile(PAGE, "utf8");
const runs = [];
for (const mode of ["headless-shell", "chromium"] as const) {
	const run = await runMode(mode, html);
	console.log(JSON.stringify(run, null, 2));
	runs.push(run);
}
await writeFile(
	RESULTS,
	`${JSON.stringify({experiment: 215, at: new Date().toISOString(), playwrightVersion, runs}, null, "\t")}\n`,
);
console.log(`saved ${RESULTS.slice(root.length + 1)}`);
