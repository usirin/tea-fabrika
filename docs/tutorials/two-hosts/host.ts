// A host: a process that serves both names. Start two. Each name runs on one host at a time.
import {NodeRuntime} from "@effect/platform-node";
import {type HostEvent, serve} from "@kampus/fabrika-old";
import {layerAttach} from "@kampus/fabrika-old/local";
import {Console, Effect} from "effect";
import {glassProgram, kettleProgram} from "./programs.ts";

const me = process.argv[2] ?? "host-a";
// Unique per start: a restarted host is a new holder, never the old one come back.
const holder = `${me}@${Date.now()}`;

const say = (name: string) => (e: HostEvent) => {
	if (e.ev === "claim" && e.answer === "claimed")
		console.log(`${me}  ${name.padEnd(6)}  claimed   fence ${e.fence}`);
	if (e.ev === "program" && e.phase === "started")
		console.log(
			`${me}  ${name.padEnd(6)}  running   replayed ${e.backlog} in ${Math.round(e.replayMs)} ms`,
		);
	if (e.ev === "program" && e.phase === "ended") console.log(`${me}  ${name.padEnd(6)}  ${e.how}`);
};

const main = Effect.gen(function* () {
	yield* serve({name: "kettle", holder, program: kettleProgram, listen: say("kettle")});
	yield* serve({name: "glass", holder, program: glassProgram, listen: say("glass")});
	yield* Console.log(`${me}  serving kettle and glass as ${holder}`);
	return yield* Effect.never;
}).pipe(Effect.scoped);

NodeRuntime.runMain(
	main.pipe(Effect.provide(layerAttach({persist: ".teahouse", ledger: "teahouse", port: 8790}))),
);
