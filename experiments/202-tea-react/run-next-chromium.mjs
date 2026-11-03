// DEMLIK=<checkout> node experiments/202-tea-react/run-next-chromium.mjs [repetitions=20].
// DEMLIK must hold the unmerged can/tea-react-send prototype, with packages/tea/src present.
// This reads source, not its built dist. A checkout can also be the second argument.
// CHROMIUM_BIN optionally selects a Chromium executable; otherwise Playwright's cached
// headless Chromium is used. No checkout or browser path is assumed.
import {existsSync} from "node:fs";
import {createRequire} from "node:module";
import {dirname, join, resolve} from "node:path";
import {build} from "esbuild";
import {chromium} from "playwright";

const require = createRequire(import.meta.url);
const checkout = process.env.DEMLIK || process.argv[3];
if (!checkout)
	throw new Error("Set DEMLIK to a checkout of the unmerged can/tea-react-send prototype");
const tea = resolve(checkout, "packages/tea/src");
if (!existsSync(join(tea, "react/send.ts")))
	throw new Error("DEMLIK lacks the send prototype (react/send.ts)");
const times = Number(process.argv[2] ?? 20);
if (!Number.isSafeInteger(times) || times < 1)
	throw new Error("Repetitions must be a positive integer");
const out = await build({
	absWorkingDir: import.meta.dirname,
	entryPoints: ["next-entry.mjs"],
	bundle: true,
	format: "iife",
	write: false,
	platform: "browser",
	define: {"process.env.NODE_ENV": '"development"'},
	logLevel: "error",
	plugins: [
		{
			name: "one-effect",
			setup: (b) => b.onResolve({filter: /^effect$/}, () => ({path: require.resolve("effect")})),
		},
	],
	alias: {
		"@demlik/tea": tea,
		react: dirname(require.resolve("react/package.json")),
		"react-dom": dirname(require.resolve("react-dom/package.json")),
	},
});
const browser = await chromium.launch({
	executablePath: process.env.CHROMIUM_BIN || undefined,
});
try {
	const page = await browser.newPage();
	page.on("pageerror", (e) => console.error("pageerror", e.message));
	await page.setContent("<!doctype html><body></body>");
	await page.addScriptTag({content: out.outputFiles[0].text});
	await page.waitForFunction(() => typeof window.runAll === "function", null, {timeout: 10000});
	const rows = await page.evaluate((t) => window.runAll(t), times);
	console.log(`chromium ${browser.version()}`);
	for (const r of rows) console.log(JSON.stringify(r));
} finally {
	await browser.close();
}
