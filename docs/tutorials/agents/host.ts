// A host for the poet and the book, on the same ledger as part one.
import {NodeRuntime} from "@effect/platform-node";
import {type HostEvent, Ledger, serve} from "@kampus/fabrika-old";
import {layerAttach} from "@kampus/fabrika-old/local";
import {Console, Effect} from "effect";
import {bookProgram, poetProgram} from "./programs.ts";

if (!process.env.CLAUDE_CODE_OAUTH_TOKEN && !process.env.ANTHROPIC_API_KEY) {
	console.error("Set CLAUDE_CODE_OAUTH_TOKEN or ANTHROPIC_API_KEY first: the poet needs a login.");
	process.exit(1);
}

const me = process.argv[2] ?? "host-a";
const holder = `${me}@${Date.now()}`;

const say = (name: string) => (e: HostEvent) => {
	if (e.ev === "claim" && e.answer === "claimed")
		console.log(`${holder}  ${name.padEnd(6)}  claimed, fence ${e.fence}`);
	if (e.ev === "program" && e.phase === "started")
		console.log(`${holder}  ${name.padEnd(6)}  running, ${e.backlog} waiting in its inbox`);
	if (e.ev === "program" && e.phase === "ended")
		console.log(`${holder}  ${name.padEnd(6)}  ${e.how}`);
};

const main = Effect.gen(function* () {
	const ledger = yield* Ledger;
	// Registering is idempotent: every host may do it, and the first one counts.
	yield* ledger.register("poet", "setup");
	yield* ledger.register("book", "setup");
	// An agent takes seconds, so the lease is 3 s, not part one's 1 s.
	const lease = {ttlMs: 3000, renewEveryMs: 500};
	yield* serve({name: "poet", holder, program: poetProgram, listen: say("poet"), ...lease});
	yield* serve({name: "book", holder, program: bookProgram, listen: say("book"), ...lease});
	yield* Console.log(`${holder}  serving poet and book`);
	return yield* Effect.never;
}).pipe(Effect.scoped);

NodeRuntime.runMain(
	main.pipe(Effect.provide(layerAttach({persist: ".teahouse", ledger: "teahouse", port: 8790}))),
);
