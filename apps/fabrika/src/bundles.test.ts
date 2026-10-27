import {execFileSync} from "node:child_process";
import {mkdtempSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {basename, join} from "node:path";
import {build} from "esbuild";
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

const here = join(import.meta.dirname, "..");
const at = (...parts: string[]) => join(here, ...parts);
const out = mkdtempSync(join(tmpdir(), "fabrika-bundles-"));
afterAll(() => rmSync(out, {recursive: true, force: true}));

describe("the app's bundles", () => {
	it.each(bundlesOf(at).map((b) => [basename(String(b.outfile)), b] as const))(
		"%s builds, and Node reads it when Node runs it",
		async (name, options) => {
			const done = await build({...common(here), ...options, write: false, logLevel: "silent"});
			expect(done.errors).toEqual([]);
			if (options.platform !== "node") return;
			const file = join(out, name);
			writeFileSync(file, done.outputFiles?.[0]?.text ?? "");
			expect(() =>
				execFileSync(process.execPath, ["--check", file], {stdio: "pipe"}),
			).not.toThrow();
		},
	);
});
