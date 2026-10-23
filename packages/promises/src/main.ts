import {runMain} from "@effect/platform-node/NodeRuntime";
import {layer as nodeServices} from "@effect/platform-node/NodeServices";
import {Effect, Exit, FileSystem, type Path, type PlatformError} from "effect";
import type {ChildProcessSpawner} from "effect/process";
import {confirm, judgeAll, type Refused} from "./node.ts";
import {detailText, gateText, listText} from "./show.ts";

// `pnpm promises`, from the top of the repo (experiment 117).
//
//   pnpm promises                       the list, then each promise in full; exit 1 if any is red
//   pnpm promises gate [--base <ref>]   for CI: fails on stale, red or uncatchable checks, and
//                                       marks exam changes against <ref> for the owner
//   pnpm promises confirm <id>          run the check and the plant at the head, and if both
//                                       go right, write the head commit and the prints
//
// In CI, with GITHUB_STEP_SUMMARY set, the gate also writes its answer there.

const root = process.cwd();
const say = (s: string) => Effect.sync(() => process.stdout.write(`${s}\n`));

const list = Effect.gen(function* () {
	const {judged} = yield* judgeAll(root, null);
	yield* say(listText(judged));
	for (const j of judged) yield* say(`\n${detailText(j)}`);
	return judged.every((j) => j.green) ? 0 : 1;
});

const gate = (base: string | null) =>
	Effect.gen(function* () {
		const {judged, removed} = yield* judgeAll(root, base);
		const out = gateText(judged, removed, base);
		yield* say(out);
		const summary = process.env.GITHUB_STEP_SUMMARY;
		if (summary !== undefined && summary !== "") {
			const fs = yield* FileSystem.FileSystem;
			yield* fs.writeFileString(summary, `## Promises\n\n\`\`\`\n${out}\n\`\`\`\n`, {flag: "a"});
		}
		return judged.every((j) => j.green) ? 0 : 1;
	});

const confirmOne = (id: string) =>
	Effect.gen(function* () {
		const {written, judged} = yield* confirm(root, id);
		yield* say(detailText(judged));
		yield* say(
			written
				? `\nConfirmed ${id} at ${judged.entry.confirmed.commit.slice(0, 7)}.`
				: `\nNot confirmed: ${id} is red.`,
		);
		return written ? 0 : 1;
	});

type Verb = Effect.Effect<
	number,
	Refused | PlatformError.PlatformError,
	ChildProcessSpawner.ChildProcessSpawner | FileSystem.FileSystem | Path.Path
>;

function main(argv: readonly string[]): Verb {
	const [verb, ...rest] = argv;
	if (verb === undefined) return list;
	if (verb === "gate") {
		const at = rest.indexOf("--base");
		return gate(at < 0 ? null : (rest[at + 1] ?? null));
	}
	if (verb === "confirm" && rest[0] !== undefined) return confirmOne(rest[0]);
	return say("usage: pnpm promises [gate [--base <ref>] | confirm <id>]").pipe(Effect.as(2));
}

if (import.meta.main) {
	runMain(
		main(process.argv.slice(2)).pipe(
			Effect.catch((e) => say(`refused: ${"why" in e ? e.why : String(e)}`).pipe(Effect.as(2))),
			Effect.provide(nodeServices),
		),
		{
			teardown: (exit, onExit) =>
				onExit(Exit.isSuccess(exit) && typeof exit.value === "number" ? exit.value : 2),
		},
	);
}
