// Run the installed oxlint with the real configuration and the new rule enabled.
import {spawnSync} from "node:child_process";
import {mkdtempSync, rmSync, writeFileSync} from "node:fs";
import {join} from "node:path";
import {Schema} from "effect";
import * as fc from "fast-check";
import {expect, it} from "vitest";

const report = Schema.Struct({diagnostics: Schema.Array(Schema.Struct({code: Schema.String}))});
it("wiring-only: branches and decoders fail; registration and the CLI guard pass", () => {
	const folder = mkdtempSync(join(import.meta.dirname, ".p15-wiring-"));
	try {
		const config = join(folder, "config.json");
		writeFileSync(
			config,
			JSON.stringify({
				extends: [join(import.meta.dirname, "../.oxlintrc.json")],
				rules: {"fabrika/wiring-only": "error"},
			}),
		);
		fc.assert(
			fc.property(
				fc.constantFrom(
					"if (bad) refuse();",
					"bad ? refuse() : load();",
					"switch (kind) {case 'bad': refuse();}",
					"Schema.decodeUnknownSync(shape)(raw);",
					"JSON.parse(raw);",
					"throw new Error('bad');",
				),
				(plant) => {
					const path = join(folder, "entry.ts");
					const fires = (text: string) => {
						writeFileSync(path, text);
						const out = spawnSync(
							join(import.meta.dirname, "../node_modules/.bin/oxlint"),
							["--format=json", "--config", config, path],
							{encoding: "utf8"},
						);
						if (out.error) throw out.error;
						return Schema.decodeUnknownSync(Schema.fromJsonString(report))(
							out.stdout,
						).diagnostics.filter((d) => d.code === "fabrika(wiring-only)");
					};
					expect(fires(plant).length).toBeGreaterThan(0);
					expect(
						fires(
							"const programs = [counter]; const layer = Layer.mergeAll(programs); if (import.meta.main) NodeRuntime.runMain(start(layer));",
						),
					).toEqual([]);
				},
			),
			{seed: 119120, numRuns: 6},
		);
	} finally {
		rmSync(folder, {recursive: true, force: true});
	}
});
