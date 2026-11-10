// P12, next/. Exercise the real oxlint rule and config at product and exam paths.
import {spawnSync} from "node:child_process";
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from "node:fs";
import {join, relative} from "node:path";
import * as fc from "fast-check";
import {expect, it} from "vitest";

const root = join(import.meta.dirname, "..");

it("every native filesystem import form is refused only in next/ product files", () => {
	const folder = mkdtempSync(join(root, "next/.p12-fs-"));

	try {
		for (const area of ["product", "exam", "e2e"]) {
			mkdirSync(join(folder, area));
		}

		fc.assert(
			fc.property(
				fc.constantFrom(
					"node:fs",
					"node:fs/promises",
					"fs",
					"fs/promises",
					"node:path",
					"path",
					"node:path/posix",
					"node:path/win32",
				),
				(module) => {
					const from = JSON.stringify(module);
					const forms = [
						`import * as native0 from ${from};`,
						`import native1 from ${from};`,
						`import {readFile as read} from ${from};`,
						`import ${from};`,
						`export * from ${from};`,
						`export {readFile as read} from ${from};`,
						`const native6 = await import(${from});`,
						`const native7 = require(${from});`,
						`import native8 = require(${from});`,
						`const native9 = import(\`${module}\`);`,
					];
					const files = [
						["product/plant.ts", true],
						["product/plant.test.ts", false],
						["product/plant.test-support.ts", false],
						["exam/plant.ts", false],
						["e2e/plant.ts", false],
					] as const;

					for (const [name] of files) {
						writeFileSync(join(folder, name), forms.join("\n"));
					}

					const out = spawnSync(
						join(root, "node_modules/.bin/oxlint"),
						["--format=json", ...files.map(([name]) => relative(root, join(folder, name)))],
						{cwd: root, encoding: "utf8"},
					);
					const report = JSON.parse(out.stdout) as {
						diagnostics: Array<{
							code: string;
							filename: string;
							labels: Array<{span: {line: number}}>;
						}>;
					};

					for (const [name, banned] of files) {
						const diagnostics = report.diagnostics.filter(
							(d) => d.code === "fabrika(no-node-filesystem)" && d.filename.endsWith(name),
						);
						expect(diagnostics.map((d) => d.labels[0]!.span.line).sort((a, b) => a - b)).toEqual(
							banned ? forms.map((_, i) => i + 1) : [],
						);
					}
				},
			),
			{seed: 119120, numRuns: 8, examples: [["node:fs"], ["fs/promises"], ["node:path"]]},
		);
	} finally {
		rmSync(folder, {recursive: true, force: true});
	}
});
