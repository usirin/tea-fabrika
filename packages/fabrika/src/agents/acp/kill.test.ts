import {type ChildProcess, spawn} from "node:child_process";
import {
	existsSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	realpathSync,
	writeFileSync,
} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {fileURLToPath} from "node:url";
import {describe, expect, it} from "@effect/vitest";
import {Deferred, Effect, Exit} from "effect";
import type {Session} from "./session.ts";

// The user's job when a session is cut off: an acp job in tsh, tsh killed
// with kill -9 mid turn, a new tsh on the same home, `attach %1`. The real
// launcher (`runTsh`), listing the small programs and acp
// (fixtures/acp-tsh/tsh.ts: fabrika's small shell lists no acp since
// experiment 114), the fake agent (./fake-agent.ts) as the harness. The session opens
// again, the prompt the kill cut off is sent again, and nobody types it twice.

const TSH = fileURLToPath(new URL("../../../../../fixtures/acp-tsh/tsh.ts", import.meta.url));

interface Life {
	readonly child: ChildProcess;
	readonly out: () => string;
	readonly exited: Effect.Effect<number | null>;
}

/** kill -9, and wait for it to be gone. Nothing happens to one already gone. */
const kill = ({child, exited}: Life) =>
	Effect.sync(() => child.kill("SIGKILL")).pipe(Effect.andThen(exited));

/** One tsh, on `home`, running `line`. Killed when the test ends, so a test stopped mid-wait leaves none. */
const life = (home: string, line: string) =>
	Effect.acquireRelease(
		Effect.sync((): Life => {
			const args = ["--disable-warning=ExperimentalWarning", TSH, "--json", "-c", line];
			const child = spawn(process.execPath, args, {
				env: {...process.env, TSH_HOME: home},
				stdio: ["ignore", "pipe", "pipe"],
			});
			let out = "";
			child.stdout?.on("data", (chunk) => {
				out += String(chunk);
			});
			child.stderr?.on("data", (chunk) => {
				out += String(chunk);
			});
			const exited = Deferred.makeUnsafe<number | null>();
			child.on("exit", (code) => Deferred.doneUnsafe(exited, Exit.succeed(code)));
			return {child, out: () => out, exited: Deferred.await(exited)};
		}),
		kill,
	);

/**
 * The acp run's kept session, read from tsh's storage files as they are: the newest whole slot of
 * its `session` machine. Read from the files, since opening the run would fence the live one.
 * `null`: none written yet, or the one in flight is torn.
 */
const kept = (home: string): Session | null => {
	const dir = join(home, "storage");
	if (!existsSync(dir)) return null;
	let newest: {readonly opened: number; readonly count: number; readonly body: string} | null =
		null;
	for (const name of readdirSync(dir).filter((n) => /%2Fmachine%2Fsession%2F/.test(n))) {
		// oxlint-disable-next-line fabrika/no-raw-try-catch -- a plain read of a file tsh may be writing right now; a torn one is expected, and `null` says so
		try {
			const slot = JSON.parse(readFileSync(join(dir, name), "utf8"));
			if (
				newest === null ||
				slot.opened > newest.opened ||
				(slot.opened === newest.opened && slot.count > newest.count)
			)
				newest = slot;
		} catch {
			return null;
		}
	}
	return newest === null ? null : (JSON.parse(newest.body) as Session);
};

/** What the fake agent noted of each prompt it was sent: `prompt <session> <n> <first word>`. */
const prompts = (folder: string) => {
	const at = join(folder, ".fake-acp", "log");
	return existsSync(at) ? readFileSync(at, "utf8").split("\n").filter(Boolean) : [];
};

/** Wait until `check` holds. Stopped mid-wait (the test's time limit, or a cancel), it says `what`. */
const until = (what: string, check: () => boolean) =>
	Effect.gen(function* () {
		while (!check()) yield* Effect.sleep("25 millis");
	}).pipe(Effect.onInterrupt(() => Effect.logError(`waited for ${what}`)));

describe("acp in tsh, killed mid turn, attached again", () => {
	for (const reopen of ["load", "resume"])
		it.live(
			`kill -9 in the second of three turns, then attach (${reopen}): every prompt answered, the cut one sent again, none retyped`,
			() =>
				Effect.gen(function* () {
					const home = mkdtempSync(join(tmpdir(), "tsh-home-"));
					const folder = realpathSync(mkdtempSync(join(tmpdir(), "acp-kill-")));
					writeFileSync(join(folder, "a.txt"), "The river is called Kura.\n");
					writeFileSync(join(folder, "b.txt"), "The bridge has 7 arches.\n");

					// Each prompt's first word is its own, so a failure names the prompt that went missing.
					const told = ["'Read a.txt'", "'slowly read b.txt'", "'Then slowly say done'"]
						.map((p) => `prompt=${p}`)
						.join(" ");
					const a = yield* life(
						home,
						`acp --agent fake --folder ${folder} --reopen ${reopen} ${told} & close %1 prompt; attach %1`,
					);
					// The kill lands in turn 2 with all three prompts kept. A prompt is kept once acp reads it
					// off its line, at its own pace: on a busy machine prompt 2 can reach the agent before
					// prompt 3 is kept, and a kill then loses prompt 3 (tsh tells a line once). So wait on both.
					yield* until("the second prompt", () => prompts(folder).length === 2);
					yield* until("all three prompts kept, in turn 2", () => {
						const s = kept(home);
						return s !== null && s.told === 3 && s.turns === 1;
					});
					yield* kill(a);

					const b = yield* life(home, "attach %1");
					expect(yield* b.exited).toBe(0);

					const sent = prompts(folder).map((l) => l.split(" "));
					// One session across both lives; the cut prompt twice, the others once.
					expect(new Set(sent.map((p) => p[1])).size).toBe(1);
					expect(sent.map((p) => p[3])).toEqual(["Read", "slowly", "slowly", "Then"]);
					expect(sent.map((p) => p[2])).toEqual(["1", "2", "3", "4"]);

					// `--json`: each value as `<output> <JSON>`, after the job's number.
					const outputs = b
						.out()
						.split("\n")
						.flatMap((l) => {
							const found = /(opened|result) (\{.*\})$/.exec(l);
							return found === null ? [] : [{name: found[1], value: JSON.parse(found[2] ?? "")}];
						});
					const opened = outputs.find((o) => o.name === "opened")?.value;
					// The cut prompt and the one told after it, both waiting: sent from storage, not typed.
					expect(opened).toMatchObject({how: reopen, earlier: 1, resent: 2});
					const results = outputs.filter((o) => o.name === "result").map((o) => o.value);
					expect(results).toMatchObject([
						{turn: 2, stop: "end_turn"},
						{turn: 3, stop: "end_turn"},
					]);
				}),
		);
});
