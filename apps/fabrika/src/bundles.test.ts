import {execFileSync} from "node:child_process";
import {mkdtempSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {basename, join} from "node:path";
import {build, type Metafile} from "esbuild";
import {afterAll, describe, expect, it} from "vitest";
import {bundlesOf, common} from "../bundles.ts";

// The app's bundles build, as build.ts builds them, and Node can read the ones it runs.
//
// The window's page is for a browser: a file it imports that reaches Node's own modules (an
// agent, through a stage machine) stops esbuild there, and the app did not start (the window's
// `node:module`, through the tracker's rows and a stage's status line).
//
// A Node bundle can build and still not load: esbuild does not read a banner, so a name the
// banner declares and a bundled file declares too is a syntax error only Node sees (the host's
// `createRequire`, once @effect/platform-node's http client came in). `node --check` reads each
// one without running it.
//
// A host starts on every app start that finds none, and every host started at once loads all of
// this before it can step aside. The pipeline program (#259) brought Stryker, Babel and the agents'
// SDKs into that, for a line most hosts never run: a host took 2.4 times as long to start, and
// `one-host.test.ts` went red on CI. So what is only for a lane stays behind an `import()`.

/** What is only for a lane, or for no host at all. None of it may load as a host starts. */
const NOT_AT_START =
	/(^|\/)(@stryker-mutator|@babel|@anthropic-ai\/claude-agent-sdk|redis|@redis)(\/|$)|stages\/pipeline\//;

/**
 * What `entry` loads as it starts, of what `NOT_AT_START` names: all an `import` statement reaches,
 * in the source files or in the bundle's. An `import()` waits.
 */
const heavyAtStart = (files: Metafile["inputs"] | Metafile["outputs"], entry: string) => {
	const seen = new Set<string>();
	const walk = (file: string) => {
		if (seen.has(file)) return;
		seen.add(file);
		for (const i of files[file]?.imports ?? []) if (i.kind !== "dynamic-import") walk(i.path);
	};
	walk(entry);
	return [...seen].filter((file) => NOT_AT_START.test(file));
};

const here = join(import.meta.dirname, "..");
const at = (...parts: string[]) => join(here, ...parts);
const out = mkdtempSync(join(tmpdir(), "fabrika-bundles-"));
afterAll(() => rmSync(out, {recursive: true, force: true}));

describe("the app's bundles", () => {
	it.each(bundlesOf(at).map((b) => [basename(b.outfile ?? "host.mjs"), b] as const))(
		"%s builds, and Node reads it when Node runs it",
		async (_name, options) => {
			const done = await build({...common(here), ...options, write: false, logLevel: "silent"});
			expect(done.errors).toEqual([]);
			if (options.platform !== "node") return;
			for (const output of done.outputFiles ?? []) {
				const file = join(out, basename(output.path));
				writeFileSync(file, output.text);
				expect(() =>
					execFileSync(process.execPath, ["--check", file], {stdio: "pipe"}),
				).not.toThrow();
			}
		},
	);

	it("a host loads no lane as it starts, from source or from its bundle", async () => {
		const {metafile} = await build({
			...common(here),
			...bundlesOf(at).find((b) => b.outfile === undefined),
			write: false,
			metafile: true,
			logLevel: "silent",
		});
		expect({
			source: heavyAtStart(metafile.inputs, "src/host/main.ts"),
			bundle: heavyAtStart(metafile.outputs, "dist/host.mjs"),
		}).toEqual({source: [], bundle: []});
		// The walk reached the bundle, so an empty answer means what it says.
		expect(Object.keys(metafile.outputs)).toContain("dist/host.mjs");
	});
});
