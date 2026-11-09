import {resolve} from "node:path";
import {NodeRuntime, NodeServices} from "@effect/platform-node";
import {Effect} from "effect";
import {build} from "./src/build.ts";

NodeRuntime.runMain(
	build({out: resolve(process.argv[2] ?? "dist")}).pipe(
		Effect.tap((built) =>
			Effect.sync(() => {
				process.stdout.write(`${built.build}\n`);
			}),
		),
		Effect.provide(NodeServices.layer),
	),
);
