// T502 PR 2, next/. A test-only door to the actual brain's exported RecordPart bridge.
// The product host Layer and RecordPartLive are loaded by brain.ts, not replaced here.
import { makeRpcStub } from "@alchemy.run/cloudflare/Bridge";
import { Chain, SinkError, SpanRow } from "@kampus/libfabrika/data";
import type { RecordShape } from "@kampus/libfabrika/workers/objects";
import { Effect, Schema } from "effect";

export * from "./brain.ts";

const Call = Schema.Struct({
  name: Schema.String,
  chain: Chain,
  at: Schema.Int,
  operation: Schema.TaggedUnion({
    write: { rows: Schema.Array(Schema.Struct({ span: SpanRow, content: Schema.NullOr(Schema.String) })) },
    read: { after: Schema.Int },
    content: { id: Schema.String },
    deleteContent: {
      id: Schema.String,
      by: Schema.Struct({ by: Schema.String, at: Schema.Int, reason: Schema.String }),
    },
  }),
});

const handle = Effect.fnUntraced(function* (
  request: Request,
  env: { RECORD: { getByName: (name: string) => unknown } },
) {
  if (new URL(request.url).pathname === "/ready") {
    return new Response("ready");
  }

  // oxlint-disable-next-line fabrika/no-promises -- edge: the test HTTP request body enters Effect
  const raw = yield* Effect.promise(() => request.json());
  const { name, chain, at, operation } = yield* Schema.decodeUnknownEffect(Call)(raw);
  const stub = makeRpcStub<RecordShape>(env.RECORD.getByName(name), { errors: [SinkError] });
  const call = (() => {
    switch (operation._tag) {
      case "write":
        return stub.write(chain, at, operation.rows);
      case "read":
        return stub.read(chain, at, operation.after);
      case "content":
        return stub.content(chain, at, operation.id);
      case "deleteContent":
        return stub.deleteContent(chain, at, operation.id, operation.by);
    }
  })();
  // Keep the error's fields. A defect is not turned into a successful test response.
  return yield* call.pipe(
    Effect.match({
      onSuccess: (value) => Response.json({ value }),
      onFailure: (error) => Response.json({ error }),
    }),
  );
});

export default {
  fetch: (request: Request, env: { RECORD: { getByName: (name: string) => unknown } }) =>
    // oxlint-disable-next-line fabrika/no-effect-run-outside-edge -- edge: workerd invokes the fixture's HTTP handler
    Effect.runPromise(handle(request, env)),
};
