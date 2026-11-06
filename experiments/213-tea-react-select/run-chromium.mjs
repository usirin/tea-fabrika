// node experiments/213-tea-react-select/run-chromium.mjs [repetitions=20], from the repo root,
// after `npm ci` in this folder. CHROMIUM_BIN optionally selects a Chromium executable; otherwise
// Playwright's cached headless Chromium is used (`npx playwright install chromium`).
// Compiles src.jsx first. Prints one row per distinct answer, with how many trials gave it.
import "./compile.mjs";
import {readFileSync} from "node:fs";
import {build} from "esbuild";
import {chromium} from "playwright";

const times = Number(process.argv[2] ?? 20);
if (!Number.isSafeInteger(times) || times < 1)
	throw new Error("Repetitions must be a positive integer");
const tea = JSON.parse(
	readFileSync(new URL("./node_modules/@demlik/tea/package.json", import.meta.url), "utf8"),
).version;
const out = await build({
	absWorkingDir: import.meta.dirname,
	stdin: {
		contents: 'import {runAll} from "./probes.mjs"; window.runAll = runAll;',
		resolveDir: ".",
	},
	bundle: true,
	format: "iife",
	write: false,
	platform: "browser",
	define: {"process.env.NODE_ENV": '"development"'},
	logLevel: "error",
});
const browser = await chromium.launch({executablePath: process.env.CHROMIUM_BIN || undefined});
try {
	const page = await browser.newPage();
	page.on("pageerror", (e) => console.error("pageerror", e.message));
	await page.setContent("<!doctype html><body></body>");
	await page.addScriptTag({content: out.outputFiles[0].text});
	await page.waitForFunction(() => typeof window.runAll === "function", null, {timeout: 10000});
	const rows = await page.evaluate((t) => window.runAll(t), times);
	console.log(`chromium ${browser.version()}, @demlik/tea ${tea}, ${times} repetitions`);
	for (const r of rows) console.log(JSON.stringify(r));
} finally {
	await browser.close();
}
