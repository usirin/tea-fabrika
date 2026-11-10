import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { layer as nodeFileSystem } from "@effect/platform-node/NodeFileSystem";
import { layer as nodePath } from "@effect/platform-node/NodePath";
import { Effect, Layer } from "effect";
import { afterAll, describe, expect, it } from "vitest";
import { memoryStorage } from "../program/storage.ts";
import { openJobs } from "./host-jobs.ts";
import { migrateJob } from "./job-rules.ts";
import { type JobsMsg, traceIdOf } from "./jobs.ts";
import { keepJobs, layerRecordTraces } from "./records.ts";
import { connect } from "./sqlite-driver.ts";
import { sqliteRecords } from "./sqlite-records.ts";
import { Traces } from "./traces.ts";

// A job's record keeps who started the job and who stopped it, and why (tracker 185). The host's
// records are written by one writer, the host's person (`sqliteRecords`' `by`), but a job an agent
// started is the agent's: its record's `job.by` is the job's own `by`, from the table. A stop
// keeps who asked and why in two new columns, `ended_by` and `why`. A job that ended on its own
// keeps both null, and so does a record file kept before the columns were: "not known", never
// "nobody". Today's version, on node:sqlite, with the SQL the Durable Object runs.
//
//   began     {by: "agent:claude for:github:7", ...}     record.job.by = "agent:claude for:github:7"
//   stopping  {n: 1, by: "user:github:7", why: "wrong"}  then its end: ended_by, why = the stop's

const dir = mkdtempSync(join(tmpdir(), "rec-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const node = Layer.mergeAll(nodeFileSystem, nodePath);

/** The host's person: the one writer of the host's records. */
const PERSON = "user:github:7";
const CLAUDE = "agent:claude for:github:7";

const began = (run: string, by: string): JobsMsg => ({
  type: "began",
  text: "counter",
  stages: [{ program: "counter", flags: {}, run, wire: null, ended: false }],
  background: false,
  owner: "t1",
  by,
});

/**
 * A host's table on records in `at`, told `msgs`; then the record of the job the first `began`
 * made, read through `Traces`, and its `job` row as SQL holds it.
 */
const recordAfter = (at: string, msgs: readonly JobsMsg[]) =>
  Effect.gen(function* () {
    const records = yield* sqliteRecords({ dir: at, by: PERSON });
    const jobs = keepJobs(yield* openJobs(memoryStorage()), records, "laptop");
    let trace: string | null = null;

    for (const msg of msgs) {
      yield* jobs.table.dispatch(msg);
      const first = jobs.table.getState().jobs[0];

      if (trace === null && first !== undefined) {
        trace = traceIdOf(first);
      }
    }

    if (trace === null) {
      return yield* Effect.die("no job began");
    }

    const read = yield* Effect.gen(function* () {
      return yield* (yield* Traces).read(trace ?? "");
    }).pipe(Effect.provide(layerRecordTraces(records)));
    const file = connect(join(at, `${trace}.sqlite`));
    const row = file.db.all(`SELECT * FROM job`)[0];
    file.close();
    return { read, row };
  }).pipe(Effect.scoped, Effect.provide(node));

describe("a job's record keeps who started it and who stopped it", () => {
  it("keeps the job's own writer, not the host's person", async () => {
    const { read, row } = await Effect.runPromise(
      recordAfter(join(dir, "agent"), [
        began("counter-agent-1", CLAUDE),
        { type: "stage_ended", run: "counter-agent-1", how: "done" },
      ]),
    );
    expect(read.job).toMatchObject({ n: 1, text: "counter", by: CLAUDE, ended: { how: "done" } });
    expect(row?.by).toBe(CLAUDE);
  });

  it("keeps the person as the writer of a job the person started", async () => {
    const { read } = await Effect.runPromise(recordAfter(join(dir, "person"), [began("counter-person-1", PERSON)]));
    expect(read.job?.by).toBe(PERSON);
  });

  it("keeps who asked a stop and why in ended_by and why", async () => {
    const { read, row } = await Effect.runPromise(
      recordAfter(join(dir, "stopped"), [
        began("counter-stop-1", CLAUDE),
        { type: "stopping", n: 1, by: PERSON, why: "wrong ticket" },
        { type: "stage_ended", run: "counter-stop-1", how: "stopped" },
      ]),
    );
    expect(read.job?.ended?.how).toBe("stopped");
    expect(row).toMatchObject({ by: CLAUDE, how: "stopped", ended_by: PERSON, why: "wrong ticket" });
  });

  it("keeps a person's own stop with ended_by the person and why null", async () => {
    const { row } = await Effect.runPromise(
      recordAfter(join(dir, "own-stop"), [
        began("counter-own-1", PERSON),
        { type: "stopping", n: 1, by: PERSON, why: null },
        { type: "stage_ended", run: "counter-own-1", how: "stopped" },
      ]),
    );
    expect(row).toMatchObject({ how: "stopped", ended_by: PERSON, why: null });
  });

  it("keeps both null for a job that ended on its own", async () => {
    const { row } = await Effect.runPromise(
      recordAfter(join(dir, "own-end"), [
        began("counter-done-1", CLAUDE),
        { type: "stage_ended", run: "counter-done-1", how: "done" },
      ]),
    );
    expect(row).toHaveProperty("ended_by", null);
    expect(row).toHaveProperty("why", null);
    expect(row?.how).toBe("done");
  });

  it("keeps both null for a detached job that was dropped: nobody asked it to stop", async () => {
    const { row } = await Effect.runPromise(
      recordAfter(join(dir, "dropped"), [
        began("counter-drop-1", CLAUDE),
        { type: "detached", n: 1 },
        { type: "dropped", n: 1 },
      ]),
    );
    expect(row).toMatchObject({ how: "stopped", ended_by: null, why: null });
  });
});

describe("a record file kept before a job's stop was kept", () => {
  it("gains ended_by and why when it is opened, and keeps its rows with both null", () => {
    const path = join(dir, "old.sqlite");
    const old = connect(path);
    // The job table as records were made before tracker 185.
    old.db.all(`CREATE TABLE job (
			one INTEGER PRIMARY KEY CHECK (one = 1),
			n INTEGER NOT NULL, text TEXT NOT NULL, host TEXT NOT NULL, by TEXT NOT NULL,
			started REAL NOT NULL, how TEXT, ended REAL)`);
    old.db.all(
      `INSERT INTO job (one, n, text, host, by, started, how, ended) VALUES (1, 4, 'seq', 'laptop', ?, 10, 'stopped', 20)`,
      PERSON,
    );
    old.close();

    const file = connect(path);
    migrateJob(file.db);
    // Opened twice, as a host started again opens it: the columns are added once.
    migrateJob(file.db);
    const columns = file.db.all(`PRAGMA table_info(job)`).map((c) => String(c.name));
    const rows = file.db.all(`SELECT * FROM job`);
    file.close();
    expect(columns).toEqual(expect.arrayContaining(["ended_by", "why"]));
    expect(rows).toEqual([
      {
        one: 1,
        n: 4,
        text: "seq",
        host: "laptop",
        by: PERSON,
        started: 10,
        how: "stopped",
        ended: 20,
        ended_by: null,
        why: null,
      },
    ]);
  });
});
