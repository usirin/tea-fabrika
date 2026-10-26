import {Duration, Effect, Schema} from "effect";
import {describe, expect, it} from "vitest";
import {ear} from "../program/ear.ts";
import {start, tell} from "../program/program.ts";
import {memoryStorage, type Storage} from "../program/storage.ts";
import {SAVED_BY_OLDER_CODE} from "./execute.ts";
import {JobStorage, Programs, programList} from "./programs.ts";
import {type Printed, type Ready, tsh} from "./shell.ts";
import {SMALL} from "./small.ts";

// A job whose kept state was saved by older code: a new tsh finds it in its table, detached, and
// `attach` cannot open it. tsh says so, and leaves the job in the table as it was, detached, with
// its kept state untouched. Every other job still opens.

const SMALL_LIST = programList(SMALL);

/** tally's total as older code might have kept it: under a key this tally does not have. */
const OlderTotal = Schema.Struct({sum: Schema.Int});

let runs = 0;

/** One tsh on a storage. `line` tells it a line and answers what it printed for it. */
const session = (storage: Storage) =>
	Effect.gen(function* () {
		const printed = ear<Printed>();
		const ready = ear<Ready>();
		runs += 1;
		const started = yield* start(
			tsh,
			{show: "short"},
			{printed: printed.hear, ready: ready.hear},
			{id: `tsh:execute-${runs}`, storage},
		).pipe(Effect.provideService(Programs, SMALL_LIST), Effect.provideService(JobStorage, storage));
		if (started.kind !== "running") return yield* Effect.die("tsh did not start");
		let told = 0;
		const line = (text: string) =>
			Effect.gen(function* () {
				const from = printed.values.length;
				expect(yield* tell(started.run, "line", text)).toBe("queued");
				told += 1;
				yield* ready.upTo(told);
				const said = printed.values.slice(from);
				return {
					out: said.filter((p) => p.to === "out").map((p) => p.text),
					err: said.filter((p) => p.to === "err").map((p) => p.text),
				};
			});
		/** Wait until tsh has printed a line that has `text` in it: a job's end comes when it comes. */
		const heard = (text: string) =>
			Effect.gen(function* () {
				while (!printed.values.some((p) => p.text.includes(text)))
					yield* Effect.sleep(Duration.millis(5));
			});
		const said = () => printed.values.map((p) => p.text);
		return {started, line, heard, said};
	});

describe("tsh: a job saved by older code", () => {
	it("is not opened: tsh says so, keeps it detached and its state as it was, and every other job still opens", async () => {
		const storage = memoryStorage();
		const ids = await Effect.runPromise(
			Effect.gen(function* () {
				const {line, heard, started} = yield* session(storage);
				const first = (yield* line("tally &")).err[0]?.split(" ")[1] ?? "";
				const second = (yield* line("tally &")).err[0]?.split(" ")[1] ?? "";
				yield* line("tell %1 add 2");
				yield* line("tell %2 add 3");
				yield* heard("[1] total 2");
				yield* heard("[2] total 3");
				yield* started.stop;
				return {first, second};
			}).pipe(Effect.scoped),
		);
		// Older code kept job 1's total, in a shape this tally's schema does not take.
		const old = await Effect.runPromise(storage.open(ids.first, null));
		await old.store("count", "total", OlderTotal).save({sum: 2});

		await Effect.runPromise(
			Effect.gen(function* () {
				const {line, heard, said} = yield* session(storage);
				yield* line("");
				yield* line("attach %1 &");
				yield* heard(SAVED_BY_OLDER_CODE);
				yield* heard("stop %1 drops it");
				expect(said()).toEqual(
					expect.arrayContaining([
						`[1] ${SAVED_BY_OLDER_CODE}  tally`,
						"[1] it stays in the table, detached; stop %1 drops it",
					]),
				);
				expect((yield* line("jobs")).out).toEqual(["[1] detached  tally", "[2] detached  tally"]);
				// The other job opens, with its own total.
				expect((yield* line("attach %2 &")).err).toEqual([`[2] attached ${ids.second}`]);
				yield* line("tell %2 add 1");
				yield* heard("[2] total 4");
				expect((yield* line("jobs")).out).toEqual([
					"[1] detached  tally",
					"[2] running   tally",
					"      total 4",
				]);
				// Asked again, it is refused again, and says so again.
				const before = said().filter((text) => text.includes(SAVED_BY_OLDER_CODE)).length;
				yield* line("attach %1 &");
				while (said().filter((text) => text.includes(SAVED_BY_OLDER_CODE)).length === before)
					yield* Effect.sleep(Duration.millis(5));
				// The way out it names.
				expect((yield* line("stop %1")).err).toEqual(["[1] dropped  tally"]);
				expect((yield* line("jobs")).out).toEqual(["[2] running   tally", "      total 4"]);
			}).pipe(Effect.scoped),
		);
		// Never written over: older code finds it as it left it.
		const after = await Effect.runPromise(storage.open(ids.first, null));
		expect(await Effect.runPromise(after.read("count", "total", OlderTotal))).toEqual({sum: 2});
	});
});
