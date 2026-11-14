// Experiment 285, next/. The Worker the source provider builds: one Effect Durable Object, and the
// real program table. Shaped like `brainlike.ts`, with an object added.
import * as Cloudflare from "@alchemy.run/cloudflare";
import { Effect } from "effect";
import { HttpServerRequest, HttpServerResponse } from "effect/http";

interface TallyShape {
  readonly add: (n: number) => Effect.Effect<number>;
}

export class Tally extends Cloudflare.DurableObject<Tally, TallyShape>()("Tally") {}
export class Sourced extends Cloudflare.Worker<Sourced, Record<never, never>, Tally>()("Sourced285") {}

const TallyLive = Tally.make(
  Effect.gen(function* () {
    const state = yield* Cloudflare.DurableObjectState;
    return Effect.succeed({
      // Kept in the object's own SQLite, so the answer shows a real object behind the class.
      add: (n: number) =>
        Effect.sync(() => {
          const sql = state.raw.storage.sql;
          sql.exec(`CREATE TABLE IF NOT EXISTS tally (n INTEGER NOT NULL)`);
          sql.exec(`INSERT INTO tally VALUES (?)`, n);
          return Number(sql.exec(`SELECT SUM(n) AS total FROM tally`).one().total);
        }),
    } satisfies TallyShape);
  }),
);

export default Sourced.make(
  { main: import.meta.url, compatibility: { date: "2026-10-12" } },
  Effect.gen(function* () {
    const tallies = yield* Tally.from(Sourced);
    return {
      fetch: Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest;
        const url = new URL(request.url, "http://sourced");
        // @ts-expect-error -- the module exists only in the bundle, where the table plugin makes it
        const built: typeof import("virtual:fabrika-built") = yield* Effect.promise(
          () => import("virtual:fabrika-built"),
        );

        if (url.pathname === "/tally") {
          return yield* HttpServerResponse.json({ total: yield* tallies.getByName("one").add(2) });
        }

        return yield* HttpServerResponse.json({
          programs: Object.keys(built.programs),
          assets: Object.keys(built.assets).length,
        });
      }).pipe(Effect.orDie),
    };
  }).pipe(Effect.provide(TallyLive)),
);
