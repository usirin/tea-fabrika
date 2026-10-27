import {Effect, Schema} from "effect";
import {describe, expect, it} from "vitest";
import {ear} from "../program/ear.ts";
import {start, tell} from "../program/program.ts";
import {memoryStorage} from "../program/storage.ts";
import {JobStorage, Programs, programList} from "./programs.ts";
import {type Printed, type Ready, TABLE, TABLE_REFUSED, tsh} from "./shell.ts";
import {SMALL} from "./small.ts";

// tsh's own job table, saved by older code: tsh does not open it and does not write over it. It
// says so once, and runs on with a table it does not keep.

/** The job table as older code might have kept it: its jobs under another key. */
const OlderTable = Schema.Struct({list: Schema.Array(Schema.String)});

describe("tsh: a job table saved by older code", () => {
	it("is left as it was: tsh says so first, and runs a line all the same", async () => {
		const storage = memoryStorage();
		const home = await Effect.runPromise(storage.open(TABLE.run, null));
		await home.store(TABLE.machine, TABLE.key, OlderTable).save({list: ["tally"]});

		const seen = await Effect.runPromise(
			Effect.gen(function* () {
				const printed = ear<Printed>();
				const ready = ear<Ready>();
				const started = yield* start(
					tsh,
					{show: "short"},
					{printed: printed.hear, ready: ready.hear},
					{id: "tsh:old-table", storage},
				).pipe(
					Effect.provideService(Programs, programList(SMALL)),
					Effect.provideService(JobStorage, storage),
				);
				if (started.kind !== "running") return yield* Effect.die("tsh did not start");
				expect(yield* tell(started.run, "line", "say --text still")).toBe("queued");
				const [answer] = yield* ready.upTo(1);
				return {status: answer?.status, said: printed.values.map((p) => p.text)};
			}).pipe(Effect.scoped),
		);
		expect(seen.said[0]).toBe(TABLE_REFUSED);
		expect(seen.said).toContain("still");
		expect(seen.status).toBe(0);

		const after = await Effect.runPromise(storage.open(TABLE.run, null));
		expect(await Effect.runPromise(after.read(TABLE.machine, TABLE.key, OlderTable))).toEqual({
			list: ["tally"],
		});
	});
});
