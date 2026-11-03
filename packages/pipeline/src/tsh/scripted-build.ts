import {layer as nodeFileSystem} from "@effect/platform-node/NodeFileSystem";
import {defineProgram, type Entry, listed} from "@kampus/fabrika-old";
import {Effect, FileSystem, Layer} from "effect";
import {criterionId} from "../ids.ts";
import {buildProgram} from "../stages/build/program.ts";
import {built, builtBy, scriptedBuilder} from "../stages/build/scripted.ts";
import {BuildHost, BuildWrites} from "../stages/build/services.ts";
import {numberOf as numberIn} from "../stages/build/ticket.ts";

// `build-scripted`: the build program with nothing real under it, for a test
// that kills tsh mid build. Every ticket reads with its plan approved, the
// builder is a script that takes a while and answers built, and the three
// writes go nowhere. Each is noted, one line each, in the file `log` in a folder:
//
//   copy 2 | push 2 | open 2 | start 2 <conversation> | answer 2
//
// so a test reads, across lives of tsh, what ran and how often. It is listed
// only when tsh is started with TSH_SCRIPTED=<folder>. It writes nothing on
// GitHub. The log is written with Effect's `FileSystem`, as Node gives it here.

/** How long a scripted builder takes: long enough to kill tsh mid build. */
const TAKES = "1500 millis";

export const buildScripted = defineProgram({
	...buildProgram,
	name: "build-scripted",
	description:
		"The build program with a scripted builder and writes that go nowhere: each is noted in a log. For a test that kills tsh mid build.",
});

/** `build-scripted`, noting what it does in `<folder>/log`. */
export function scriptedBuildEntry(folder: string): Entry {
	const note = (line: string) =>
		Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem;
			yield* fs.writeFileString(`${folder}/log`, `${line}\n`, {flag: "a"});
		}).pipe(Effect.provide(nodeFileSystem), Effect.orDie);
	const host = Layer.succeed(BuildHost, {
		ticket: (url, number) =>
			Effect.succeed({
				url,
				number,
				state: "open" as const,
				title: `scripted ${number}`,
				body: "- [ ] it is built",
				plan: "approved" as const,
				criteria: [
					{id: criterionId("c1"), version: 1, text: "it is built", checked: false, evidence: null},
				],
				prs: [],
				rules: [],
			}),
	});
	const writes = Layer.succeed(BuildWrites, {
		copy: (_, n) =>
			note(`copy ${n}`).pipe(
				Effect.as({tree: `/nowhere/${n}`, branch: `build/${n}`, base: "b".repeat(40)}),
			),
		push: (ticket) =>
			note(`push ${numberIn(ticket)}`).pipe(Effect.as({head: "h".repeat(40), changed: true})),
		open: (ticket) =>
			note(`open ${numberIn(ticket)}`).pipe(
				Effect.as(
					`${ticket.slice(0, ticket.lastIndexOf("/issues/"))}/pull/${numberIn(ticket) + 1000}`,
				),
			),
	});
	const builder = () =>
		scriptedBuilder((brief) =>
			note(`start ${brief.number} ${brief.session}`).pipe(
				Effect.andThen(Effect.sleep(TAKES)),
				Effect.andThen(note(`answer ${brief.number}`)),
				Effect.as(built(builtBy(`Scripted: built ${brief.number}.`))),
			),
		).layer;
	return listed(
		buildScripted,
		Layer.suspend(() => Layer.mergeAll(host, writes, builder())),
	);
}
