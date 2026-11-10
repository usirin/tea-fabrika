import {execFileSync} from "node:child_process";
import {
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {Effect, Stream} from "effect";
import {afterEach, expect, it} from "vitest";
import {fileStorage} from "../../program/storage-node.ts";
import {SummonManager} from "../../shell/summon.ts";
import {summonManager} from "./manager.ts";

const PERSON = "user:owner";
const PRIVATE = "T237-dismiss-this-private-prompt";
const KEEP = "T237-keep-the-other-conversation";
const made: string[] = [];

afterEach(() => {
	for (const folder of made.splice(0)) {
		rmSync(folder, {recursive: true, force: true});
	}
});

const bytes = (folder: string): string =>
	readdirSync(folder, {withFileTypes: true})
		.map((entry) => {
			const path = join(folder, entry.name);
			return entry.isDirectory() ? bytes(path) : readFileSync(path, "utf8");
		})
		.join("\n");

// T237 review 2, finding 4. Today's version, real ACP fake and real on-disk summon storage.
// This reads bytes actually written by the conversation, including old storage slots.
it("T237-R2-4: dismiss removes its kept conversation, while another agent and its content survive", async () => {
	const root = realpathSync(mkdtempSync(join(tmpdir(), "summon-dismiss-")));
	made.push(root);
	const folder = join(root, "repo");
	const disk = join(root, "storage");
	mkdirSync(folder);
	execFileSync("git", ["init", "-q"], {cwd: folder});
	writeFileSync(join(folder, "a.txt"), "The river is called Kura.\n");
	const storage = fileStorage(disk);
	const seen = await Effect.runPromise(
		Effect.gen(function* () {
			const manager = yield* SummonManager;

			for (const [name, prompt] of [
				["scout", PRIVATE],
				["researcher", KEEP],
			] as const) {
				yield* manager.summon({agent: "fake", settings: [], name, by: PERSON});
				const news = yield* manager
					.turn(name, `${prompt}: read a.txt`, null)
					.pipe(Stream.runCollect);
				expect(news.at(-1)).toMatchObject({_tag: "result", stop: "end_turn"});
			}

			const scout = (yield* manager.identify!("scout", 1)).run;
			const other = (yield* manager.identify!("researcher", 1)).run;
			const before = bytes(disk);
			expect(before).toContain(PRIVATE);
			expect(before).toContain(KEEP);
			expect(yield* storage.record(scout)).not.toBeNull();
			yield* manager.dismiss("scout", PERSON);
			return {
				after: bytes(disk),
				removed: yield* storage.record(scout),
				other: yield* storage.record(other),
				names: (yield* manager.list).map((a) => a.name),
			};
		}).pipe(Effect.scoped, Effect.provide(summonManager({storage, folder}))),
	);
	expect(seen.names).toEqual(["researcher"]);
	expect(seen.other).not.toBeNull();
	expect(seen.after).toContain(KEEP);
	expect.soft(seen.removed, "dismissed ACP run still has a storage record").toBeNull();
	expect(seen.after, "dismissed prompt remains in storage slots").not.toContain(PRIVATE);
});
