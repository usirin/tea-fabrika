// A stand-in for the run's process (tsh) on the ACP path, for
// src/stages/build/builder-acp.test.ts. It starts the fake ACP agent under the
// guard the way the ACP builder starts the Claude adapter (`underGuard`), and
// sends it one slow prompt, so a test can kill it mid turn.
//
//   node acp-parent.ts <folder> <lock>
import {layer as nodeServices} from "@effect/platform-node/NodeServices";
import {Effect} from "effect";
import {harnessOf} from "../../wip/src/agents/acp/harness";
import {runTurn, underGuard} from "../../wip/src/stages/build/builder-acp";

const [folder = "", lock = ""] = process.argv.slice(2);
console.log(`parent ${process.pid}`);
await Effect.runPromise(
	runTurn({
		harness: underGuard(harnessOf("fake", folder, null), lock, 30),
		folder,
		meta: undefined,
		model: null,
		effort: null,
		prompt: "slowly write slowly",
		verdict: () => ({allow: true, tool: "Write"}),
	}).pipe(Effect.scoped, Effect.provide(nodeServices)),
);
console.log("turn ended");
