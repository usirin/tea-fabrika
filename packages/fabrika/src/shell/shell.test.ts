import {Effect, Schema} from "effect";
import {describe, expect, it} from "vitest";
import {HostJobs, openJobs, TABLE} from "../host/host-jobs.ts";
import {ear} from "../program/ear.ts";
import {start, tell} from "../program/program.ts";
import {memoryStorage} from "../program/storage.ts";
import {Programs, programList} from "./programs.ts";
import {type Printed, type Ready, TABLE_REFUSED, tsh} from "./shell.ts";
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
				const jobs = yield* openJobs(storage);
				const started = yield* start(
					tsh,
					{show: "short"},
					{printed: printed.hear, ready: ready.hear},
					{id: "tsh:old-table", storage},
				).pipe(
					Effect.provideService(Programs, programList(SMALL)),
					Effect.provideService(HostJobs, jobs),
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

// tsh's `background` input (tracker 185b, PR 3). Today's version. A line told there runs beside the
// one in the foreground, so it may hold only programs' lines, each ending with &: a built-in may
// wait, write the table or end tsh, and that is the foreground line's to do. Any other line is
// refused with status 2 and runs nothing; a line that does not read is refused as a typed one is.
//
//   line "sleep --ms 60000"         holds the line
//   background "tally &"            [1] tally: ...; backgrounded {status: 0}
//   background "exit"               tsh: exit must run in the foreground: ...; backgrounded {status: 2}

const BESIDE = "a line told beside one runs only programs, each ending with &";

describe("tsh: a line told beside the foreground", () => {
	it("starts a program's line with & beside the foreground job, refuses any other with status 2, and runs on", async () => {
		const seen = await Effect.runPromise(
			Effect.gen(function* () {
				const printed = ear<Printed>();
				const ready = ear<Ready>();
				const beside = ear<Ready>();
				const jobs = yield* openJobs(memoryStorage());
				const started = yield* start(
					tsh,
					{show: "short"},
					{printed: printed.hear, ready: ready.hear, backgrounded: beside.hear},
					{id: "tsh:beside", storage: memoryStorage()},
				).pipe(
					Effect.provideService(Programs, programList(SMALL)),
					Effect.provideService(HostJobs, jobs),
				);
				if (started.kind !== "running") return yield* Effect.die("tsh did not start");
				const table = () => jobs.table.getState().jobs;
				yield* tell(started.run, "line", "sleep --ms 60000");
				for (let i = 0; i < 300 && table().length === 0; i += 1) yield* Effect.sleep("10 millis");
				let told = 0;
				/** One line on `background`: what it printed on err, its status, and the jobs after it. */
				const besideOne = (text: string) =>
					Effect.gen(function* () {
						const from = printed.values.length;
						expect(yield* tell(started.run, "background", text)).toBe("queued");
						told += 1;
						const all = yield* beside.upTo(told).pipe(
							Effect.timeoutOrElse({
								duration: "3 seconds",
								orElse: () => Effect.die(`no answer to ${text}`),
							}),
						);
						return {
							status: all[told - 1]?.status,
							err: printed.values.slice(from).flatMap((p) => (p.to === "err" ? [p.text] : [])),
							jobs: table().length,
						};
					});
				const refused = [];
				for (const text of ["jobs", "exit", "tally", "tally & ; jobs"])
					refused.push(yield* besideOne(text));
				const unread = yield* besideOne("| x");
				const taken = yield* besideOne("tally &");
				const both = table().map((j) => [j.text, j.background]);
				// tsh is not ended: Ctrl-C stops the foreground line, and the next line runs.
				yield* tell(started.run, "signal", "interrupt");
				yield* ready.upTo(1);
				yield* tell(started.run, "line", "say --text still");
				const [, after] = yield* ready.upTo(2);
				return {refused, unread, taken, both, after, said: printed.values.map((p) => p.text)};
			}).pipe(Effect.scoped),
		);
		expect(seen.refused).toEqual([
			{status: 2, err: [`tsh: jobs must run in the foreground: ${BESIDE}`], jobs: 1},
			{status: 2, err: [`tsh: exit must run in the foreground: ${BESIDE}`], jobs: 1},
			{status: 2, err: [`tsh: tally must run in the foreground: ${BESIDE}`], jobs: 1},
			{status: 2, err: [`tsh: jobs must run in the foreground: ${BESIDE}`], jobs: 1},
		]);
		expect(seen.unread.status).toBe(2);
		expect(seen.unread.err.length).toBeGreaterThan(0);
		expect(seen.unread.jobs).toBe(1);
		// tsh says the job it began on err, as bash says `[2] 4121`.
		expect(seen.taken).toEqual({status: 0, err: [expect.stringMatching(/^\[2\] tally:/)], jobs: 2});
		// A job's text is its pipeline's, with no &: `jobs` lists it so.
		expect(seen.both).toEqual([
			["sleep --ms 60000", false],
			["tally", true],
		]);
		expect(seen.after?.status).toBe(0);
		expect(seen.said).toContain("still");
	});
});
