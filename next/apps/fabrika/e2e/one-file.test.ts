// P16, next/. A disposable package supplies executable window fixtures while P14 is absent.
// Uses only P12's planned build({chaos}) and localStage(built, settings) boundaries. The lead
// must reconcile their final exports once P12 lands, then run through the existing e2e runner.
import assert from "node:assert/strict";
import {createHash, generateKeyPairSync} from "node:crypto";
import {
	cpSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import {createRequire} from "node:module";
import {dirname, join, resolve} from "node:path";
import {pathToFileURL} from "node:url";
import {NodeServices} from "@effect/platform-node";
import {Effect, Exit, Scope} from "effect";
import {afterEach, describe, expect, it, vi} from "vitest";

const APP = resolve(import.meta.dirname, "..");
const ROOT = resolve(APP, "../../..");
const homes: string[] = [];
type Built = {readonly brain: string};
type Build = {
	readonly build: (options: {readonly chaos: boolean}) => Effect.Effect<Built, unknown>;
};
type Settings = {
	readonly name: string;
	readonly person: string;
	readonly founder: string;
	readonly port: number;
	readonly build: string;
};
type Stage = {
	readonly localStage: (
		built: Built,
		settings: Settings,
	) => Effect.Effect<{readonly url: string}, unknown, Scope.Scope>;
};

const field = (value: string | Uint8Array) => {
	const bytes = Buffer.from(value);
	const n = Buffer.alloc(4);
	n.writeUInt32BE(bytes.length);
	return Buffer.concat([n, bytes]);
};
const founder = () => {
	const {publicKey} = generateKeyPairSync("ed25519");
	const key = publicKey.export({format: "jwk"}).x;
	assert(key);
	return `ssh-ed25519 ${Buffer.concat([field("ssh-ed25519"), field(Buffer.from(key, "base64url"))]).toString("base64")}`;
};

const fixture = () => {
	assert(existsSync(join(APP, "src/build.ts")), "P12 not built: next/apps/fabrika/src/build.ts");
	assert(
		existsSync(join(APP, "src/local-stage.ts")),
		"P12 not built: next/apps/fabrika/src/local-stage.ts",
	);
	const home = mkdtempSync("/tmp/fh.");
	homes.push(home);
	const app = join(home, "next/apps/fabrika");
	cpSync(APP, app, {
		recursive: true,
		filter: (path) => !["node_modules", "dist", ".alchemy"].includes(path.split("/").at(-1) ?? ""),
	});
	for (const name of [
		"package.json",
		"compiler-ledger.json",
		"pnpm-workspace.yaml",
		"pnpm-lock.yaml",
	])
		cpSync(join(ROOT, name), join(home, name));
	symlinkSync(join(ROOT, "node_modules"), join(home, "node_modules"), "dir");
	mkdirSync(join(app, "node_modules"), {recursive: true});
	for (const name of readdirSync(join(APP, "node_modules")))
		symlinkSync(join(APP, "node_modules", name), join(app, "node_modules", name), "dir");
	const pkg = join(app, "node_modules/@p16/browser");
	mkdirSync(pkg, {recursive: true});
	writeFileSync(
		join(pkg, "package.json"),
		JSON.stringify({
			name: "@p16/browser",
			type: "module",
			exports: {".": "./program.ts", "./window": "./window.tsx"},
		}),
	);
	writeFileSync(join(pkg, "program.ts"), 'export {counter} from "@kampus/counter";');
	writeFileSync(
		join(pkg, "window.tsx"),
		[
			'import "./window.css";',
			'globalThis.p16Ready = import("./secondary.ts").then(({text}) => {',
			' const out = document.createElement("output"); out.id = "p16"; out.textContent = text;',
			" document.body.append(out); return text;",
			"});",
		].join("\n"),
	);
	writeFileSync(join(pkg, "secondary.ts"), 'export const text = "secondary 雪 </script> \\\\";');
	writeFileSync(join(pkg, "window.css"), "#p16 { color: rgb(12, 34, 56); }");
	writeFileSync(
		join(app, "src/table.ts"),
		'export const programs = [{name: "counter", package: "@p16/browser", export: "counter"}];',
	);
	vi.stubEnv("FABRIKA_HOME", home);
	vi.stubEnv("TYPESAFE_API_KEY", undefined);
	return {home, app, pkg};
};

afterEach(() => {
	vi.unstubAllEnvs();
	vi.resetModules();
	for (const home of homes.splice(0)) rmSync(home, {recursive: true, force: true});
});

describe("P16 browser, actual copied-file local stage", () => {
	it("assets: browser executes the entry and secondary import with embedded CSS; blocked-chunk plant fails", async () => {
		const {home, app, pkg} = fixture();
		const api = await vi.importActual<Build>(pathToFileURL(join(app, "src/build.ts")).href);
		const built = await Effect.runPromise(
			api.build({chaos: false}).pipe(Effect.provide(NodeServices.layer)),
		);
		const alone = join(home, "alone");
		mkdirSync(alone);
		cpSync(resolve(app, built.brain), join(alone, "brain.mjs"));
		rmSync(pkg, {recursive: true});
		const originalOutput = dirname(resolve(app, built.brain));
		assert.notEqual(originalOutput, app, "output must be apart from the stage driver");
		rmSync(originalOutput, {recursive: true, force: true});
		const scope = Effect.runSync(Scope.make());
		const stage = await vi.importActual<Stage>(pathToFileURL(join(app, "src/local-stage.ts")).href);
		try {
			const {url} = await Effect.runPromise(
				stage
					.localStage(
						{...built, brain: join(alone, "brain.mjs")},
						{
							name: "p16-browser",
							person: "p16-test",
							founder: founder(),
							port: 19816,
							build: createHash("sha256")
								.update(readFileSync(join(alone, "brain.mjs")))
								.digest("hex"),
						},
					)
					.pipe(Effect.provideService(Scope.Scope, scope), Effect.provide(NodeServices.layer)),
			);
			// Playwright is already pinned by the app that installed it. This loads that external
			// dependency, never today's app code, and needs no new manifest or lockfile change.
			const {chromium} = createRequire(join(ROOT, "apps/fabrika/package.json"))("playwright");
			const browser = await chromium.launch({headless: true});
			try {
				const page = await browser.newPage();
				await page.goto(`${url}/window.js`);
				await page.setContent('<script type="module" src="/window.js"></script>');
				await page.addStyleTag({url: `${url}/window.css`});
				await page.waitForSelector("#p16");
				expect(await page.locator("#p16").textContent()).toBe("secondary 雪 </script> \\");
				expect(
					await page
						.locator("#p16")
						.evaluate((element: Element) => getComputedStyle(element).color),
				).toBe("rgb(12, 34, 56)");
				const missing = await page.request.get(`${url}/p16-missing.js`);
				expect(missing.status()).toBe(404);
				await page.close();
				// A new context avoids a cached module hiding the planted missing secondary chunk.
				const planted = await browser.newPage();
				await planted.route(
					"**/*.js",
					(route: {
						request: () => {url: () => string};
						continue: () => Promise<void>;
						abort: () => Promise<void>;
					}) =>
						new URL(route.request().url()).pathname === "/window.js"
							? route.continue()
							: route.abort(),
				);
				await planted.goto(`${url}/window.js`);
				await planted.setContent('<script type="module" src="/window.js"></script>');
				await planted.addScriptTag({url: `${url}/window.js`, type: "module"});
				await expect(planted.evaluate("globalThis.p16Ready")).rejects.toThrow();
				await planted.close();
			} finally {
				await browser.close();
			}
		} finally {
			await Effect.runPromise(Scope.close(scope, Exit.void));
		}
	});
});
