// node experiments/202-tea-react/run-chromium.mjs [repetitions=20], from the repo root.
// CHROMIUM_BIN optionally selects a Chromium executable; otherwise Playwright's cached
// headless Chromium is used. Install it separately with `npx playwright install chromium`.
// Compiles P3 first. Prints observations; P2 and compiled P3 deliberately differ from want.
import "./compile.mjs";
import {build} from "esbuild";
import {chromium} from "playwright";

const times = Number(process.argv[2] ?? 20);
if (!Number.isSafeInteger(times) || times < 1)
	throw new Error("Repetitions must be a positive integer");
const out = await build({
	absWorkingDir: import.meta.dirname,
	entryPoints: ["browser-entry.mjs"],
	bundle: true,
	format: "iife",
	write: false,
	platform: "browser",
	define: {"process.env.NODE_ENV": '"development"'},
	logLevel: "error",
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
