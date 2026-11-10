// Today's app. Source text is an edge-case generator, not domain Schema data.
import {spawnSync} from "node:child_process";
import {
	copyFileSync,
	mkdirSync,
	mkdtempSync,
	realpathSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import {tmpdir} from "node:os";
import {dirname, join} from "node:path";
import * as fc from "fast-check";
import {expect, it} from "vitest";

const ROOT = join(import.meta.dirname, "..");
const Code = "fabrika(e2e-windows)";
const lint = (files: Readonly<Record<string, string>>) => {
	const dir = realpathSync(mkdtempSync(join(tmpdir(), "window-lint-")));
	try {
		copyFileSync(join(ROOT, ".oxlintrc.json"), join(dir, ".oxlintrc.json"));
		symlinkSync(join(ROOT, "oxlint-plugins"), join(dir, "oxlint-plugins"));
		for (const [file, text] of Object.entries(files)) {
			mkdirSync(dirname(join(dir, file)), {recursive: true});
			writeFileSync(join(dir, file), text);
		}
		const ran = spawnSync(
			join(ROOT, "node_modules/.bin/oxlint"),
			[
				"--config",
				join(dir, ".oxlintrc.json"),
				"--disable-nested-config",
				"--no-ignore",
				"--format=json",
				...Object.keys(files),
			],
			{cwd: dir, encoding: "utf8", maxBuffer: 2 ** 22},
		);
		const report = JSON.parse(ran.stdout) as {
			number_of_files: number;
			diagnostics: Array<{
				code?: string;
				filename: string;
				message: string;
				labels?: Array<{span: {line: number}}>;
			}>;
		};
		expect(report.number_of_files, ran.stderr).toBe(Object.keys(files).length);
		return (code: string, file: string) =>
			report.diagnostics
				.filter((d) => d.code === code && d.filename === file)
				.map((d) => d.labels?.[0]?.span.line ?? 0);
	} finally {
		rmSync(dir, {recursive: true, force: true});
	}
};

it("tracks supported native bindings, permits DOM focus and shadows, and reserves all launch forms", () => {
	// fast-check: edge cases -- generated source spellings, aliases and lexical scopes have no domain Schema.
	fc.assert(
		fc.property(
			fc.record({
				name: fc.stringMatching(/^[a-z]{2,9}$/).map((s) => `w_${s}`),
				optional: fc.boolean(),
				computed: fc.boolean(),
			}),
			({name, optional, computed}) => {
				const call = (method: string, args = "") =>
					`${name}${optional ? "?." : computed ? "" : "."}${computed ? `["${method}"]` : method}${optional ? "?." : ""}(${args});`;
				const forms = [
					`import {BrowserWindow as W} from "electron"; const ${name} = new W();`,
					`import * as E from "electron"; const ${name} = E.BrowserWindow.getAllWindows()[0];`,
					`import {BrowserWindow as W} from "electron"; const [first] = W.getAllWindows(); const ${name} = first;`,
					`import E from "electron"; const ${name} = E.BrowserWindow.fromId(1);`,
					`import {BrowserWindow as W} from "electron"; const ${name} = W.getFocusedWindow();`,
					`declare const app: unknown; app.evaluate(({BrowserWindow: W}) => { const ${name} = W.getAllWindows()[0]; CALLS });`,
					`import {launchElectron} from "./src/testing/electron-launch.ts"; const app = await launchElectron({}); const h = await app.browserWindow(page); h.evaluate((${name}) => { CALLS });`,
					`const E = require("electron"); const ${name} = E.BrowserWindow.fromWebContents(contents);`,
				];
				const banned = [
					"show",
					"focus",
					"setOpacity",
					"setIgnoreMouseEvents",
					"capturePage",
					"setPosition",
					"center",
				];
				const calls = [
					...banned.map((m) => call(m)),
					call("setBounds", "{x: 0, width: 900}"),
					call("setBounds", "{y: -20, height: 900}"),
					`const position = {x: 0}; ${call("setBounds", "{...position, width: 900}")}`,
				].join("\n");
				const allowed = [
					call("setBounds", "{width: 20000, height: 15000}"),
					call("setContentSize", "1600, 1000"),
					`function shadow(${name}) { ${name}.focus(); ${name}.setBounds({x: 0}); }`,
					`{ const ${name} = page.locator("input"); ${name}.focus(); }`,
					`page.evaluate((element) => element.focus()); page.locator("input").focus();`,
					`function localRequire(require) { const E = require("electron"); E.BrowserWindow.fromId(1).focus(); }`,
					`function shadowBrowser(W) { const local = new W(); local.focus(); }`,
				].join("\n");
				const files: Record<string, string> = {};
				for (const [i, form] of forms.entries()) {
					const path = `apps/fabrika/src/testing/case-${i}.ts`;
					files[path] = form.includes("CALLS")
						? form.replace("CALLS", `${calls}\n${allowed}`)
						: `${form}\n${calls}\n${allowed}`;
				}
				const launches = [
					'import {_electron as E} from "playwright"; E.launch({});',
					'import * as P from "playwright"; P._electron.launch({});',
					'const {_electron: E} = require("playwright"); E.launch({});',
					'const P = await import("playwright"); const E = P._electron; E.launch({});',
					'(await import("playwright-core"))._electron["launch"]?.({});',
					'const P = require("@playwright/test"); P["_electron"].launch({});',
				];
				// Imports must be top-level. Each driver gets each launch style in its own lexical namespace.
				files["apps/fabrika/e2e.ts"] = launches[0] ?? "";
				files["apps/fabrika/lane-e2e.ts"] = launches[1] ?? "";
				files["apps/fabrika/summon-e2e.ts"] = launches
					.slice(2)
					.map((s) => `{ ${s} }`)
					.join("\n");
				files["apps/fabrika/src/testing/electron-launch.ts"] =
					`${launches[0]}\nimport colors from "@radix-ui/colors";`;
				files["apps/fabrika/src/testing/electron-hook.cjs"] =
					`const {BrowserWindow: W} = require("electron"); const ${name} = new W(); ${calls}`;
				files["apps/fabrika/src/main.ts"] =
					`import {BrowserWindow as W} from "electron"; const ${name} = new W(); ${calls}`;
				files["apps/fabrika/ruler-e2e.ts"] =
					'import {chromium} from "playwright"; const browser = await chromium.launch({headless:true}); const page = await browser.newPage(); page.locator("input").focus();';
				files["apps/fabrika/src/testing/types.ts"] =
					'import type {_electron, Page, ElectronApplication} from "playwright";';
				files["apps/fabrika/src/testing/tokens.ts"] =
					'import colors from "@radix-ui/colors"; import blue from "@radix-ui/colors/blue";';
				const fires = lint(files);
				for (let i = 0; i < forms.length; i++)
					expect(fires(Code, `apps/fabrika/src/testing/case-${i}.ts`)).toHaveLength(10);
				expect(fires(Code, "apps/fabrika/e2e.ts")).toHaveLength(1);
				expect(fires(Code, "apps/fabrika/lane-e2e.ts")).toHaveLength(1);
				expect(fires(Code, "apps/fabrika/summon-e2e.ts")).toHaveLength(4);
				for (const path of [
					"src/testing/electron-launch.ts",
					"src/testing/electron-hook.cjs",
					"src/main.ts",
					"ruler-e2e.ts",
					"src/testing/types.ts",
				])
					expect(fires(Code, `apps/fabrika/${path}`)).toEqual([]);
				expect(fires("eslint(no-restricted-imports)", "apps/fabrika/e2e.ts")).toHaveLength(1);
				expect(fires("eslint(no-restricted-imports)", "apps/fabrika/src/testing/types.ts")).toEqual(
					[],
				);
				expect(
					fires("eslint(no-restricted-imports)", "apps/fabrika/src/testing/tokens.ts"),
				).toHaveLength(2);
				expect(
					fires("eslint(no-restricted-imports)", "apps/fabrika/src/testing/electron-launch.ts"),
				).toHaveLength(1);
			},
		),
		{seed: 119120, numRuns: 12},
	);
});
