import {NodeRuntime, NodeServices} from "@effect/platform-node";
import {Effect, Path} from "effect";
import {build} from "./src/build.ts";

NodeRuntime.runMain(
	Effect.gen(function* () {
		const path = yield* Path.Path;
		return yield* build({out: path.resolve(process.argv[2] ?? "dist")});
	}).pipe(
		Effect.tap((built) =>
			Effect.sync(() => {
				process.stdout.write(`${built.build}\n`);
			}),
		),
		Effect.provide(NodeServices.layer),
	),
);
