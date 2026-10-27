// The twin as a command, for a demo on one laptop. It asks the real GitHub for keys, so a person
// signs in with their own SSH key. It runs until Ctrl-C.
//
//   pnpm --filter @kampus/ledger-server twin --name acme-ledger --founder github:<your id> \
//     --persist ~/.fabrika-twin --port 8787
//   // twin: http://127.0.0.1:8787   connect with: fabrika connect http://127.0.0.1:8787/acme
import {NodeRuntime, NodeServices} from "@effect/platform-node";
import {Effect} from "effect";
import {Command, Flag} from "effect/cli";
import {decodeConfig} from "./config.ts";
import {startTwin} from "./twin.ts";

const twin = Command.make(
	"twin",
	{
		name: Flag.String("name").pipe(Flag.withDescription("the project's Worker name")),
		founder: Flag.String("founder").pipe(Flag.withDescription("github:<id> of who made it")),
		persist: Flag.String("persist").pipe(Flag.withDescription("the data folder")),
		port: Flag.Int("port").pipe(Flag.withDefault(8787)),
	},
	(f) =>
		Effect.gen(function* () {
			const config = decodeConfig({name: f.name, founder: f.founder});
			const {url} = yield* startTwin({config, persist: f.persist, port: f.port});
			yield* Effect.logInfo(`twin: ${url}   connect with: fabrika connect ${url}/<project>`);
			return yield* Effect.never;
		}).pipe(Effect.scoped),
);

NodeRuntime.runMain(Command.run(twin, {version: "0.0.0"}).pipe(Effect.provide(NodeServices.layer)));
