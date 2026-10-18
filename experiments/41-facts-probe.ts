import {readFile} from "node:fs/promises";
import {Effect} from "effect";
import {localFacts} from "../legacy/src/code-facts.ts";
import {Facts} from "../legacy/src/factory-services.ts";
import {factsBrief, mentionsOf} from "../legacy/src/facts.ts";

// The facts pack triage would gather for one report, on a repo checked out
// here. Offline: git and code-graph only, no Jev, no agent.
//   REPO=<folder>     the checkout, read at HEAD and never written to
//   TICKET=<file>     a ticket as the folder tracker keeps it: {"title", "body"}
//   JSON=1            print the pack as data too

const repo = process.env.REPO;
const ticketFile = process.env.TICKET;
if (repo === undefined || ticketFile === undefined) throw new Error("REPO and TICKET are needed");

const ticket = JSON.parse(await readFile(ticketFile, "utf8")) as {
	readonly title: string;
	readonly body: string;
};
const mentions = mentionsOf(`${ticket.title}\n\n${ticket.body}`);
console.log(`mentions: ${JSON.stringify(mentions)}`);

const started = Date.now();
const pack = await Effect.runPromise(
	Effect.gen(function* () {
		return yield* (yield* Facts).gather(mentions);
	}).pipe(Effect.provide(localFacts(repo))),
);
const brief = factsBrief(pack);
console.log(
	`gathered in ${((Date.now() - started) / 1000).toFixed(1)}s; the brief is ${brief.length} characters\n`,
);
console.log(brief);
if (process.env.JSON === "1") console.log(`\n${JSON.stringify(pack, null, 2)}`);
