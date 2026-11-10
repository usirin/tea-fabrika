import { Effect } from "effect";
import { expect, it } from "vitest";
import { HostJobs, openJobs } from "../host/host-jobs.ts";
import { ear } from "../program/ear.ts";
import { start, tell } from "../program/program.ts";
import { memoryStorage } from "../program/storage.ts";
import { Programs, programList } from "./programs.ts";
import { type Printed, type Ready, tsh } from "./shell.ts";

// T237 review 2, finding 3. Today's host exists and has jobs, but knows no repo yet.
// The refusal must give the person an action that supplies one, rather than denying the host exists.
it("T237-R2-3: summon with no repo explains how to choose one inside the app", async () => {
  const seen = await Effect.runPromise(
    Effect.gen(function* () {
      const storage = memoryStorage();
      const jobs = yield* openJobs(storage);
      const printed = ear<Printed>();
      const ready = ear<Ready>();
      const started = yield* start(
        tsh,
        { show: "short" },
        { printed: printed.hear, ready: ready.hear },
        { id: "tsh:no-repo", storage },
      ).pipe(
        Effect.provideService(HostJobs, { ...jobs, owner: "t1", by: "user:owner" }),
        Effect.provideService(Programs, programList([])),
      );

      if (started.kind !== "running") {
        return yield* Effect.die("tsh did not start");
      }

      yield* tell(started.run, "line", "summon fake as scout");
      const [done] = yield* ready.upTo(1);
      return { status: done?.status, text: printed.values.map((p) => p.text).join("\n") };
    }).pipe(Effect.scoped),
  );
  expect(seen.status).not.toBe(0);
  expect.soft(seen.text).not.toContain("no host");
  expect(seen.text).toMatch(/(?:open|choose|select|set|FABRIKA_REPO).*(?:repo|folder|directory)|FABRIKA_REPO/i);
});
