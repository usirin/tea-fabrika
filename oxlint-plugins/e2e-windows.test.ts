// Today's app. Source text is an edge-case generator, not domain Schema data.
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import * as fc from "fast-check";
import { expect, it } from "vitest";

const ROOT = join(import.meta.dirname, "..");
const Code = "fabrika(e2e-windows)";

const lint = (files: Readonly<Record<string, string>>) => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "window-lint-")));

  try {
    copyFileSync(join(ROOT, ".oxlintrc.json"), join(dir, ".oxlintrc.json"));
    symlinkSync(join(ROOT, "oxlint-plugins"), join(dir, "oxlint-plugins"));

    for (const [file, text] of Object.entries(files)) {
      mkdirSync(dirname(join(dir, file)), { recursive: true });
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
      { cwd: dir, encoding: "utf8", maxBuffer: 2 ** 22 },
    );
    const report = JSON.parse(ran.stdout) as {
      number_of_files: number;
      diagnostics: Array<{
        code?: string;
        filename: string;
        message: string;
        labels?: Array<{ span: { line: number } }>;
      }>;
    };
    expect(report.number_of_files, ran.stderr).toBe(Object.keys(files).length);
    return (code: string, file: string) =>
      report.diagnostics
        .filter((d) => d.code === code && d.filename === file)
        .map((d) => d.labels?.[0]?.span.line ?? 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
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
      ({ name, optional, computed }) => {
        const call = (method: string, args = "") =>
          `${name}${optional ? "?." : computed ? "" : "."}${computed ? `["${method}"]` : method}${optional ? "?." : ""}(${args});`;
        // Bindings created or changed by assignment, not by a declarator initializer.
        const assigned = [
          `import {BrowserWindow as W} from "electron"; let ${name}; ${name} = W.fromId(1);`,
          `import {BrowserWindow as W} from "electron"; let ${name}; let other = page.locator("a"); ${name} = other; ${name} = W.getFocusedWindow();`,
          `import {BrowserWindow as W} from "electron"; let first; [first] = W.getAllWindows(); const ${name} = first;`,
          `import {BrowserWindow as W} from "electron"; let ${name} = page; ${name} = new W();`,
        ];
        const forms = [
          `import {BrowserWindow as W} from "electron"; const ${name} = new W();`,
          `import * as E from "electron"; const ${name} = E.BrowserWindow.getAllWindows()[0];`,
          `import {BrowserWindow as W} from "electron"; const [first] = W.getAllWindows(); const ${name} = first;`,
          `import E from "electron"; const ${name} = E.BrowserWindow.fromId(1);`,
          `import {BrowserWindow as W} from "electron"; const ${name} = W.getFocusedWindow();`,
          `declare const app: unknown; app.evaluate(({BrowserWindow: W}) => { const ${name} = W.getAllWindows()[0]; CALLS });`,
          `import {launchElectron} from "./src/testing/electron-launch.ts"; const app = await launchElectron({}); const h = await app.browserWindow(page); h.evaluate((${name}) => { CALLS });`,
          `const E = require("electron"); const ${name} = E.BrowserWindow.fromWebContents(contents);`,
          ...assigned,
        ];
        const banned = ["show", "focus", "setOpacity", "setIgnoreMouseEvents", "capturePage", "setPosition", "center"];
        const calls = [
          ...banned.map((m) => call(m)),
          call("setBounds", "{x: 0, width: 900}"),
          call("setBounds", "{y: -20, height: 900}"),
          `const position = {x: 0}; ${call("setBounds", "{...position, width: 900}")}`,
          `let moved; moved = {y: 3}; ${call("setBounds", "{...moved, width: 900}")}`,
          `let alias = {width: 5}; let again; again = {x: 1}; alias = again; ${call("setBounds", "alias")}`,
        ].join("\n");
        const allowed = [
          call("setBounds", "{width: 20000, height: 15000}"),
          call("setContentSize", "1600, 1000"),
          `function shadow(${name}) { ${name}.focus(); ${name}.setBounds({x: 0}); }`,
          `{ const ${name} = page.locator("input"); ${name}.focus(); }`,
          `page.evaluate((element) => element.focus()); page.locator("input").focus();`,
          `function localRequire(require) { const E = require("electron"); E.BrowserWindow.fromId(1).focus(); }`,
          `let sized = {x: 1}; sized = {width: 5}; ${call("setBounds", "sized")}`,
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
          'let P; P = await import("playwright"); P._electron.launch({});',
          'let E; E = require("playwright")._electron; E.launch({});',
        ];
        // Imports must be top-level. Each driver gets each launch style in its own lexical namespace.
        files["apps/fabrika/e2e.ts"] = launches[0] ?? "";
        files["apps/fabrika/lane-e2e.ts"] = launches[1] ?? "";
        files["apps/fabrika/summon-e2e.ts"] = launches
          .slice(2)
          .map((s) => `{ ${s} }`)
          .join("\n");
        files["apps/fabrika/src/testing/electron-launch.ts"] = `${launches[0]}\nimport colors from "@radix-ui/colors";`;
        files["apps/fabrika/src/testing/electron-hook.cjs"] =
          `const {BrowserWindow: W} = require("electron"); const ${name} = new W(); ${calls}`;
        // A reassignment to a page or locator drops native status.
        files["apps/fabrika/src/testing/dropped.ts"] =
          `import {BrowserWindow as W} from "electron"; let ${name} = new W(); ${name} = page.locator("input"); ${call("focus")}\nlet other = W.fromId(1); other = page; other.focus();`;
        files["apps/fabrika/src/main.ts"] =
          `import {BrowserWindow as W} from "electron"; const ${name} = new W(); ${calls}`;
        files["apps/fabrika/ruler-e2e.ts"] =
          'import {chromium} from "playwright"; const browser = await chromium.launch({headless:true}); const page = await browser.newPage(); page.locator("input").focus();';
        files["apps/fabrika/src/testing/types.ts"] =
          'import type {_electron, Page, ElectronApplication} from "playwright";';
        files["apps/fabrika/src/testing/tokens.ts"] =
          'import colors from "@radix-ui/colors"; import blue from "@radix-ui/colors/blue";';
        // Writes that may not run keep the earlier value beside their own; a plain write in the use's own block replaces.
        const write = [
          `${name} ??= page;`,
          `${name} ||= page;`,
          `${name} &&= page;`,
          `if (cond) ${name} = page;`,
          `if (cond) { ${name} = page; } else { other = 1; }`,
          `for (const item of items) { ${name} = page; }`,
          `while (cond) ${name} = page;`,
          `switch (kind) { case 1: ${name} = page; }`,
          `try { ${name} = page; } catch {}`,
          `try { risky(); } catch { ${name} = page; }`,
          `cond ? (${name} = page) : 0;`,
          `cond ? 0 : (${name} = page);`,
          `cond && (${name} = page);`,
          `cond || (${name} = page);`,
          `cond ?? (${name} = page);`,
        ];
        const conditional = write.map((w) => `{ let ${name} = W.fromId(1); ${w} ${call("focus")} }`);
        const position = write.map(
          (w) =>
            `{ let ${name} = W.fromId(1); let b = {x: 1}; ${w.replaceAll(name, "b").replaceAll("page", "{width: 900}")} ${name}.setBounds(b); }`,
        );
        const launcher = write.map(
          (w) =>
            `{ let ${name} = require("playwright")._electron; ${w.replaceAll("page", "other")} ${name}.launch({}); }`,
        );
        const replaced = [
          `{ let ${name} = W.fromId(1); ${name} = page; ${call("focus")} }`,
          `{ let ${name} = W.fromId(1); if (cond) ${name} = other; ${name} = page; ${call("focus")} }`,
          `{ let ${name} = W.fromId(1); ${name} ??= other; ${name} = page; ${call("focus")} }`,
          `{ let ${name} = W.fromId(1); if (cond) { ${name} = page; ${call("focus")} } }`,
          `{ let ${name} = W.fromId(1); cond ? 0 : 1; ${name} = page.locator("a"); ${call("focus")} }`,
          `{ let b = {x: 1}; b = {width: 900}; W.fromId(1).setBounds(b); }`,
          `{ let ${name} = page; ${name} ??= page.locator("a"); ${call("focus")} }`,
        ];
        files["apps/fabrika/src/testing/may-not-run-window.ts"] =
          `const {BrowserWindow: W} = require("electron");\n${conditional.join("\n")}\n${replaced.join("\n")}`;
        files["apps/fabrika/src/testing/may-not-run-position.ts"] =
          `const {BrowserWindow: W} = require("electron");\n${position.join("\n")}`;
        files["apps/fabrika/lane-e2e.ts"] = `${launches[1]}\n${launcher.join("\n")}`;
        // Competing recognized kinds: every kind that can reach a use counts, wherever it sits among the arms.
        const n = name;
        const competing = [
          `{ let ${n} = W.fromId(1); ${n} ??= W; ${n}.focus(); }`,
          `{ let ${n} = W.fromId(1); ${n} ||= W; ${n}.show(); }`,
          `{ let ${n} = W; ${n} = cond ? ${n} : W.fromId(1); ${n}.setOpacity(0); }`,
          `{ const ${n} = cond ? W : W.fromId(1); ${n}.focus(); }`,
          `{ const ${n} = W ?? W.fromId(1); ${n}.show(); }`,
          `{ const ${n} = (cond && W) || W.getFocusedWindow(); ${n}.setIgnoreMouseEvents(true); }`,
          `{ const a = cond ? W : W.fromId(1); const b = a; const ${n} = b; ${n}.capturePage(); }`,
          `{ const o = cond ? P : E; o.BrowserWindow.fromId(1).focus(); }`,
          `{ const o = cond ? E : P; const ${n} = o.BrowserWindow.fromId(1); ${n}?.center(); }`,
          `{ const {BrowserWindow: B} = cond ? P : E; const ${n} = B.fromId(1); ${n}.focus(); }`,
          `{ const {BrowserWindow: B = W} = cond ? E : P; const ${n} = new B(); ${n}.setPosition(1, 2); }`,
          `{ const [${n}] = cond ? W : W.getAllWindows(); ${n}.focus(); }`,
          `{ let ${n}; [${n}] = cond ? W : W.getAllWindows(); ${n}.focus(); }`,
          `{ const h = cond ? app : await app.browserWindow(page); h.evaluate((${n}) => ${n}.focus()); }`,
          `{ const h = (await app.browserWindow(page)) ?? app; h.evaluate((${n}) => { ${n}.setBounds({x: 1}); }); }`,
          `{ let ${n} = require("playwright")._electron; ${n} ??= require("electron"); ${n}.launch({}); }`,
          `{ const ${n} = cond ? require("electron") : require("playwright")._electron; ${n}.launch({}); }`,
          `{ const {_electron: ${n}} = cond ? E : P; ${n}.launch({}); }`,
          `{ const o = cond ? E : P; const ${n} = o._electron; ${n}["launch"]?.({}); }`,
          `{ const a = cond ? E : P; const b = a; const ${n} = b._electron; ${n}.launch({}); }`,
        ];
        const competingAllowed = [
          `{ const ${n} = cond ? page.locator("a") : page; ${n}.focus(); }`,
          `{ const o = cond ? P : E; o.other.focus(); o.other.launch({}); }`,
          `{ const h = cond ? app : page; h.evaluate((el) => el.focus()); }`,
          `{ const {chromium: C} = cond ? E : P; C.launch({headless: true}); }`,
          `{ const ${n} = cond ? W : page; ${n}.focus(); const ${n}2 = cond ? W : W.fromId(1); ${n}2.setBounds({width: 5}); }`,
          `{ let ${n} = cond ? W : W.fromId(1); ${n} = page; ${n}.focus(); }`,
        ];
        files["apps/fabrika/src/testing/competing.ts"] =
          `import {BrowserWindow as W} from "electron";\nimport * as E from "electron";\nimport * as P from "playwright";\nimport {launchElectron} from "./electron-launch.ts";\nconst app = await launchElectron({});\n${competing.join("\n")}\n${competingAllowed.join("\n")}`;
        // Every binding form the rule recognizes (README, "Binding forms"): one plant per line, red at 7aa8ad2f.
        let count = 0;
        const u = (prefix: string) => `${prefix}${count++}`;
        const header = [
          'import {BrowserWindow as W} from "electron";',
          'import * as E from "electron";',
          'import * as P from "playwright";',
          'import type {ElectronApplication, Page} from "playwright";',
          'import {launchElectron} from "./electron-launch.ts";',
          "declare const page: any, cond: any, items: any[], other: any, url: string, risky: () => void;",
          "const app = await launchElectron({});",
        ];
        const evalApp = "app.evaluate((M) => new M.BrowserWindow().focus())";
        const plants = [
          // Declarator and assignment patterns.
          `{ const {BrowserWindow: ${n}} = E; new ${n}().focus(); }`,
          `{ const {["BrowserWindow"]: ${n}} = E; new ${n}().focus(); }`,
          `{ const {_electron: {launch: ${n}}} = P; ${n}({}); }`,
          `{ const [, , ${n}] = W.getAllWindows(); ${n}.focus(); }`,
          `{ const [, [${n}] = W.getAllWindows()] = W.getAllWindows(); ${n}.focus(); }`,
          `{ const {BrowserWindow: ${n} = E.BrowserWindow} = P; new ${n}().focus(); }`,
          `{ const {_electron: ${n} = P._electron} = E; ${n}.launch({}); }`,
          `{ let ${n}; ({BrowserWindow: ${n} = E.BrowserWindow} = P); new ${n}().focus(); }`,
          `{ let ${n}; ({_electron: ${n} = P._electron} = E); ${n}.launch({}); }`,
          `{ let ${n}; [${n} = W.fromId(1)] = []; ${n}.focus(); }`,
          `{ const [${n} = W.fromId(1)] = other; ${n}.focus(); }`,
          `{ const {...${n}} = E; new ${n}.BrowserWindow().focus(); }`,
          `{ let ${n}; ({...${n}} = E); new ${n}.BrowserWindow().focus(); }`,
          `{ const [...${n}] = W.getAllWindows(); ${n}[0].focus(); }`,
          `{ let ${n}; [, ...${n}] = W.getAllWindows(); ${n}[0].focus(); }`,
          // Writes to every binding kind.
          ...["=", "||=", "??=", "&&="].map((op) => `function ${u("w")}(${n}) { ${n} ${op} new W(); ${n}.focus(); }`),
          `function ${u("w")}(${n}) { [${n}] = W.getAllWindows(); ${n}.focus(); }`,
          `function ${u("w")}(${n}) { ({w: ${n} = W.fromId(1)} = {}); ${n}.focus(); }`,
          `function ${u("w")}(${n}) { [...${n}] = W.getAllWindows(); ${n}[0].focus(); }`,
          `{ let ${n} = page; ${n} = new W(); ${n}.focus(); }`,
          `function ${u("w")}() { var ${n}; ${n} = new W(); ${n}.focus(); }`,
          `function ${u("w")}() { var ${n} = page; ${n} ??= W.fromId(1); ${n}.focus(); }`,
          `try { risky(); } catch (${n}) { ${n} = new W(); ${n}.focus(); }`,
          `{ function ${n}() {} ${n} = new W(); ${n}.focus(); }`,
          `{ class ${n} {} ${n} = new W(); ${n}.focus(); }`,
          `{ let ${n} = page; const f = () => ${n}.focus(); ${n} = new W(); }`,
          `{ let ${n} = new W(); const f = () => ${n}.focus(); }`,
          // Parameters.
          `((a, ${n} = E.BrowserWindow) => new ${n}().focus());`,
          `function ${u("p")}(a, ${n} = W.fromId(1)) { ${n}.focus(); }`,
          `const ${u("t")} = (s: string, app: ElectronApplication) => ${evalApp};`,
          `function ${u("t")}(s: string, app: ElectronApplication) { ${evalApp}; }`,
          `const ${u("t")} = function (s: string, app: ElectronApplication) { ${evalApp}; };`,
          `class ${u("K")} { m(s: string, app: ElectronApplication) { ${evalApp}; } }`,
          `class ${u("K")} { constructor(s: string, app: ElectronApplication) { ${evalApp}; } }`,
          `((app: ElectronApplication = other) => ${evalApp});`,
          `{ const app2: ElectronApplication = other; ${evalApp.replace("app.", "app2.")}; }`,
          "app.evaluateHandle((M) => new M.BrowserWindow().focus());",
          `{ const h = await app.browserWindow(page); h.evaluateHandle((${n}) => ${n}.focus()); }`,
          `{ const h = await app.evaluateHandle((M) => M); h.evaluate((${n}) => ${n}.focus()); }`,
          `launchElectron({}).then((${n}) => ${n}.evaluate((M) => new M.BrowserWindow().focus()));`,
          `app.browserWindow(page).then((h) => h.evaluate((${n}) => ${n}.focus()));`,
          // Loop heads.
          `for (const ${n} of W.getAllWindows()) { ${n}.focus(); }`,
          `for await (const ${n} of W.getAllWindows()) { ${n}.focus(); }`,
          `{ let ${n}; for (${n} of W.getAllWindows()) { ${n}.focus(); } }`,
          // Array methods on windows.
          ...["at(0)", "find((x) => x.id === 1)", "findLast((x) => x.id === 1)", "pop()", "shift()"].map(
            (m) => `W.getAllWindows().${m}?.focus();`,
          ),
          ...[
            "filter(Boolean)",
            "slice(1)",
            "toSorted()",
            "toReversed()",
            "concat([])",
            "reverse()",
            "sort()",
            "splice(0)",
            "toSpliced(0)",
            "with(0, other)",
            "flat()",
          ].map((m) => `W.getAllWindows().${m}[0].focus();`),
          "[...W.getAllWindows()][0].focus();",
          `{ const ${n} = [...W.getAllWindows(), ...other]; ${n}[0].focus(); }`,
          ...[
            "forEach",
            "map",
            "filter",
            "find",
            "findLast",
            "findIndex",
            "findLastIndex",
            "some",
            "every",
            "flatMap",
          ].map((m) => `W.getAllWindows().${m}((${n}) => ${n}.focus());`),
          `W.getAllWindows().forEach((a, i, ${n}) => ${n}[0].focus());`,
          // Expression wrappers.
          `{ const ${n} = (page, W.fromId(1)); ${n}.focus(); }`,
          `{ const ${n} = W.fromId(1) satisfies unknown; ${n}.focus(); }`,
          `{ const ${n} = <unknown>W.fromId(1); ${n}.focus(); }`,
          `{ const ${n} = W<string>; new ${n}().focus(); }`,
          `{ const ${n} = (W.fromId(1)); ${n}.focus(); }`,
          "(W.fromId(1)).focus();",
          "(W.fromId(1)!.focus)();",
          `{ const ${n} = W.fromId(1); (${n}?.focus)(); }`,
          "(P._electron satisfies unknown).launch({});",
        ];
        const twins = [
          `{ const {chromium: ${n} = page.locator("a")} = P; ${n}.focus(); }`,
          `{ const [${n} = page.locator("a")] = other; ${n}.focus(); }`,
          `{ const {...${n}} = other; ${n}.focus(); }`,
          `{ const [...${n}] = items; ${n}[0].focus(); }`,
          `function ${u("a")}(${n}) { ${n} = page.locator("a"); ${n}.focus(); }`,
          `function ${u("a")}(${n}) { ${n} = new W(); ${n} = page; ${n}.focus(); }`,
          `try { risky(); } catch (${n}) { ${n} = page.locator("a"); ${n}.focus(); }`,
          `{ function ${n}() {} ${n} = page.locator("a"); ${n}.focus(); }`,
          `{ class ${n} {} ${n} = page.locator("a"); ${n}.focus(); }`,
          `{ let ${n} = new W(); ${n} = page; const f = () => ${n}.focus(); }`,
          `((a, ${n} = page.locator("a")) => ${n}.focus());`,
          `((s: string, pg: Page) => pg.evaluate((el) => el.focus()));`,
          "page.evaluateHandle((el) => el.focus());",
          `{ const h = await page.evaluateHandle((M) => M); h.evaluate((${n}) => ${n}.focus()); }`,
          `fetch(url).then((${n}) => ${n}.focus());`,
          `page.locator("a").then((${n}) => ${n}.focus());`,
          `for (const ${n} in W.getAllWindows()) { ${n}.focus(); }`,
          `for (const ${n} of items) { ${n}.focus(); }`,
          `for (const ${n} of page.locator("a").all()) { ${n}.focus(); }`,
          `for await (const ${n} of items) { ${n}.focus(); }`,
          `{ let ${n}; for (${n} of items) ${n}.focus(); }`,
          `items.forEach((${n}) => ${n}.focus());`,
          "items.at(0)?.focus();",
          "items.filter(Boolean)[0].focus();",
          "[...items][0].focus();",
          `page.locator("a").all().then((all) => all[0].focus());`,
          `{ const ${n} = (page, page.locator("a")); ${n}.focus(); }`,
          `{ const ${n} = page.locator("a") satisfies unknown; ${n}.focus(); }`,
          `{ const ${n} = <unknown>page.locator("a"); ${n}.focus(); }`,
          `{ const ${n} = page<string>; new ${n}().focus(); }`,
          `(page.locator("a")).focus();`,
          `(page.locator("a")!.focus)();`,
          "(other satisfies unknown).launch({});",
        ];
        const imports = [
          'import E = require("electron"); new E.BrowserWindow().focus();',
          'import {default as E} from "electron"; new E.BrowserWindow().focus();',
          'import * as P from "playwright"; import L = P._electron; L.launch({});',
          'import E = require("electron"); import B = E.BrowserWindow; new B().focus();',
          'import {createRequire} from "node:module"; createRequire(import.meta.url)("electron").BrowserWindow.fromId(1).focus();',
          'import {createRequire} from "node:module"; const r = createRequire(import.meta.url); r("electron").BrowserWindow.fromId(1).focus();',
          'import {createRequire as cr} from "module"; const {BrowserWindow: B} = cr(import.meta.url)("electron"); new B().focus();',
          'import * as M from "node:module"; M.createRequire(import.meta.url)("electron").BrowserWindow.fromId(1).focus();',
          'import M from "node:module"; const r = M.createRequire(import.meta.url); const E = r("electron"); E.BrowserWindow.fromId(1).focus();',
          'const {createRequire: cr} = await import("node:module"); cr(import.meta.url)("electron").BrowserWindow.fromId(1).focus();',
          '(await import("electron")).default.BrowserWindow.fromId(1).focus();',
          'import {createRequire} from "node:module"; const {_electron: E} = createRequire(import.meta.url)("playwright"); E.launch({});',
        ];
        const importTwins = [
          'import E = require("./local.cjs"); E.BrowserWindow.fromId(1).focus();',
          'import {default as D} from "./x.ts"; D.BrowserWindow.fromId(1).focus();',
          'import {createRequire} from "node:module"; createRequire(import.meta.url)("./other.cjs").BrowserWindow.fromId(1).focus();',
          'import {createRequire} from "node:module"; const r = createRequire(import.meta.url); r("sharp").BrowserWindow.fromId(1).focus();',
          'import {createRequire} from "./mine.ts"; createRequire(import.meta.url)("electron").BrowserWindow.fromId(1).focus();',
          'import E = require("playwright"); E.chromium.launch({headless: true});',
        ];
        files["apps/fabrika/src/testing/forms.ts"] = [...header, ...plants].join("\n");
        files["apps/fabrika/src/testing/forms-allowed.ts"] = [...header, ...twins].join("\n");

        for (const [i, text] of imports.entries()) {
          files[`apps/fabrika/src/testing/import-${i}.ts`] = text;
        }

        for (const [i, text] of importTwins.entries()) {
          files[`apps/fabrika/src/testing/import-twin-${i}.ts`] = text;
        }

        const fires = lint(files);

        // One report per plant line, so a lost kind names its row.
        expect(fires(Code, "apps/fabrika/src/testing/forms.ts")).toEqual(plants.map((_, i) => header.length + i + 1));
        expect(fires(Code, "apps/fabrika/src/testing/forms-allowed.ts")).toEqual([]);

        for (let i = 0; i < imports.length; i++) {
          expect(fires(Code, `apps/fabrika/src/testing/import-${i}.ts`), imports[i]).toHaveLength(1);
        }

        for (let i = 0; i < importTwins.length; i++) {
          expect(fires(Code, `apps/fabrika/src/testing/import-twin-${i}.ts`), importTwins[i]).toEqual([]);
        }

        expect(fires(Code, "apps/fabrika/src/testing/competing.ts")).toHaveLength(competing.length);
        expect(fires(Code, "apps/fabrika/src/testing/may-not-run-window.ts")).toHaveLength(write.length);
        expect(fires(Code, "apps/fabrika/src/testing/may-not-run-position.ts")).toHaveLength(write.length);
        expect(fires(Code, "apps/fabrika/lane-e2e.ts")).toHaveLength(1 + write.length);

        for (let i = 0; i < forms.length; i++) {
          expect(fires(Code, `apps/fabrika/src/testing/case-${i}.ts`)).toHaveLength(12);
        }

        expect(fires(Code, "apps/fabrika/src/testing/dropped.ts")).toEqual([]);
        expect(fires(Code, "apps/fabrika/e2e.ts")).toHaveLength(1);
        expect(fires(Code, "apps/fabrika/summon-e2e.ts")).toHaveLength(6);

        for (const path of [
          "src/testing/electron-launch.ts",
          "src/testing/electron-hook.cjs",
          "src/main.ts",
          "ruler-e2e.ts",
          "src/testing/types.ts",
        ]) {
          expect(fires(Code, `apps/fabrika/${path}`)).toEqual([]);
        }

        expect(fires("eslint(no-restricted-imports)", "apps/fabrika/e2e.ts")).toHaveLength(1);
        expect(fires("eslint(no-restricted-imports)", "apps/fabrika/src/testing/types.ts")).toEqual([]);
        expect(fires("eslint(no-restricted-imports)", "apps/fabrika/src/testing/tokens.ts")).toHaveLength(2);
        expect(fires("eslint(no-restricted-imports)", "apps/fabrika/src/testing/electron-launch.ts")).toHaveLength(1);
      },
    ),
    { seed: 119120, numRuns: 12 },
  );
});
