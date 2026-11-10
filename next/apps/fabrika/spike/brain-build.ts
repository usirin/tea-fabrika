// Experiment 248 spike: build the brain once and print what was written.
import {readdirSync, statSync} from "node:fs";
import {join} from "node:path";
import {NodeServices} from "@effect/platform-node";
import {Effect} from "effect";
import {build} from "../src/build.ts";

const out = process.argv[2]!;
const t0 = Date.now();
const built = await Effect.runPromise(build({out}).pipe(Effect.provide(NodeServices.layer)));

console.log(
	JSON.stringify({
		ms: Date.now() - t0,
		build: built.build.slice(0, 12),
		files: readdirSync(out)
			.filter((f) => f.endsWith(".mjs"))
			.map((f) => [f, statSync(join(out, f)).size]),
	}),
);
