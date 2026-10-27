import {join} from "node:path";
import {build} from "esbuild";
import {describe, expect, it} from "vitest";
import {bundlesOf, common} from "../bundles.ts";

// The app's bundles build, as build.ts builds them, written nowhere. The window's page is for a
// browser: a file it imports that reaches Node's own modules (an agent, through a stage machine)
// stops esbuild there. Nothing else checked it, and the app did not start (the window's
// `node:module`, through the tracker's rows and a stage's status line).

const here = join(import.meta.dirname, "..");
const at = (...parts: string[]) => join(here, ...parts);

describe("the app's bundles", () => {
	it.each(bundlesOf(at).map((b) => [String(b.outfile).slice(here.length + 1), b] as const))(
		"%s builds",
		async (_, options) => {
			const done = await build({...common(here), ...options, write: false, logLevel: "silent"});
			expect(done.errors).toEqual([]);
		},
	);
});
