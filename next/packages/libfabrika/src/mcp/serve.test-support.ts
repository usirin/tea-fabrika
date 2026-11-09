// Executed only as a disposable stdio test child. Product serveBridge owns the SDK.
import {appendFileSync, existsSync, writeFileSync} from "node:fs";
import {join} from "node:path";
import {NodeFileSystem} from "@effect/platform-node";
import {Effect} from "effect";
import * as Id from "../id.ts";
import {ClientState, Delivery, clientFixture, notesFixture} from "./mcp.test-support.ts";

const main = Effect.gen(function* () {
	// oxlint-disable-next-line fabrika/no-promises -- edge: Node loads the actual server in a disposable test child
	const {serveBridge} = yield* Effect.promise(() => import("./serve.ts"));
	// oxlint-disable-next-line fabrika/no-promises -- edge: Node loads the actual store in a disposable test child
	const {agentStore} = yield* Effect.promise(() => import("../node/agent-store.ts"));
	const home = process.env.FABRIKA_HOME ?? "";
	const f = yield* clientFixture();
	const phase = process.argv[2] ?? "normal";
	const client = {
		...f.client,
		state: Effect.sync(() =>
			existsSync(join(home, "approved"))
				? ClientState.cases.online.make({key: "agent", person: "person"})
				: ClientState.cases.waiting.make({code: "482 109", until: Date.now() + 600000}),
		),
		open: (...args: Parameters<typeof f.client.open>) =>
			Effect.gen(function* () {
				writeFileSync(join(home, "opened"), "");
				if (phase === "before") return yield* Effect.never;
				return yield* f.client.open(...args);
			}),
		send: (r: Parameters<typeof f.client.send>[0]) =>
			Effect.gen(function* () {
				appendFileSync(join(home, "requests"), `${JSON.stringify(r)}\n`);
				if (phase === "reserved") return yield* Effect.never;
				writeFileSync(join(home, "appended"), "");
				if (phase === "appended") return yield* Effect.never;
				return Delivery.cases.accepted.make({rev: 1, pos: 1});
			}).pipe(Effect.ensuring(Effect.sync(() => writeFileSync(join(home, "cancelled"), "")))),
		close: Effect.sync(() => writeFileSync(join(home, "closed"), "")),
	};
	yield* serveBridge({programs: [notesFixture()], client}).pipe(Effect.provide(agentStore({home})));
}).pipe(Effect.scoped, Effect.provide(NodeFileSystem.layer), Effect.provide(Id.Generator.layer));
// oxlint-disable-next-line fabrika/no-effect-run-outside-edge, fabrika/no-promises -- edge: this disposable test server owns its runtime
Effect.runPromise(main).catch(() => {
	process.exitCode = 1;
});
