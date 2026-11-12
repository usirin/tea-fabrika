// Experiment 276, part b: the same apply, from inside a Durable Object under workerd. The engine
// (Stack.make, Plan.make, Apply.apply) is bundled into this Worker; the ledger stand-in is a table
// in the object's own SQLite, and Alchemy's state is entries in that same table.
//
// edge: lab code; the brain's object classes still extend cloudflare:workers' DurableObject on main
// (next/apps/fabrika/src/brain.ts), until the Alchemy port (ticket 502) moves them.
import { DurableObject } from "cloudflare:workers";
import { Effect, Layer } from "effect";
import { applyStack, Ledger, stateCalls, touched, type Entry, type Version } from "./resources.ts";

type Env = { readonly BRAIN: DurableObjectNamespace<Brain> };

const sqlLedger = (sql: SqlStorage) => {
  sql.exec("CREATE TABLE IF NOT EXISTS ledger (seq INTEGER PRIMARY KEY AUTOINCREMENT, body TEXT NOT NULL)");
  return Ledger.of({
    append: (entry) =>
      Effect.sync(
        () =>
          sql.exec<{ seq: number }>("INSERT INTO ledger (body) VALUES (?) RETURNING seq", JSON.stringify(entry)).one()
            .seq,
      ),
    entries: Effect.sync(() =>
      sql
        .exec<{ seq: number; body: string }>("SELECT seq, body FROM ledger ORDER BY seq")
        .toArray()
        .map((row) => ({ seq: row.seq, entry: JSON.parse(row.body) as Entry })),
    ),
  });
};

export class Brain extends DurableObject<Env> {
  readonly ledger = sqlLedger(this.ctx.storage.sql);

  apply(version: Version, bare: boolean) {
    const ledger = this.ledger;
    const program = Effect.gen(function* () {
      const before = (yield* ledger.entries).length;
      const calls = { ...stateCalls };
      const started = performance.now();
      // `bare`: no engine service at all, only the state store, the stage and the ledger.
      const result = yield* bare ? applyStack(version, Layer.empty as never) : applyStack(version);
      const ms = performance.now() - started;
      const rows = yield* ledger.entries;
      return {
        version,
        ms,
        actions: result.actions,
        output: result.output,
        newEntries: rows.slice(before).map(({ entry }) => entry._tag),
        stateCalls: Object.fromEntries(
          Object.entries(stateCalls).map(([k, v]) => [k, v - calls[k as keyof typeof calls]]),
        ),
        touched: [...new Set(touched)],
      };
    }).pipe(Effect.provideService(Ledger, ledger));
    // edge: Durable Object RPC returns a Promise
    return Effect.runPromise(program);
  }

  rows() {
    return this.ctx.storage.sql
      .exec<{ seq: number; body: string }>("SELECT seq, body FROM ledger ORDER BY seq")
      .toArray();
  }
}

export default {
  async fetch(request: Request, env: Env) {
    const url = new URL(request.url);
    const brain = env.BRAIN.get(env.BRAIN.idFromName("exp276"));

    try {
      if (url.pathname === "/apply") {
        const version = (url.searchParams.get("v") ?? "v1") as Version;
        return Response.json(await brain.apply(version, url.searchParams.has("bare")));
      }

      if (url.pathname === "/rows") {
        return Response.json(await brain.rows());
      }

      return new Response("not found", { status: 404 });
    } catch (error) {
      return Response.json({ error: String(error), stack: (error as Error).stack }, { status: 500 });
    }
  },
};
