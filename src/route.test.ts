import { Effect, Layer } from "effect";
import { describe, expect, it } from "vitest";
import { jevRouter, ROUTE_FLOOR } from "./route.ts";
import { Jev, Router } from "./services.ts";

/** A Jev that answers each call with the next status, then one `serves` answer. */
function jevReplying(statuses: readonly number[], choice: "serves" | "unrelated", confidence: number) {
  const queue = [...statuses];
  let calls = 0;
  const layer = Layer.succeed(Jev, {
    call: (request) =>
      Effect.sync(() => {
        calls++;
        const status = queue.shift() ?? 200;
        return status !== 200
          ? { status, body: {} }
          : {
              status,
              body: {
                model: request.model,
                answers: {
                  serves: {
                    type: "choice",
                    choice,
                    confidence,
                    probabilities: { serves: choice === "serves" ? confidence : 1 - confidence, unrelated: choice === "serves" ? 1 - confidence : confidence },
                  },
                },
                usage: { input_tokens: 0, output_tokens: 0 },
              },
            };
      }),
  });
  return { layer, calls: () => calls };
}

const ask = (jev: Layer.Layer<Jev>) =>
  Effect.runPromise(
    Effect.gen(function* () {
      return yield* (yield* Router).route({ text: "a trim helper slugify uses", goal: "slugify makes URL slugs" });
    }).pipe(
      Effect.provide(jevRouter.pipe(Layer.provide(jev))),
      Effect.match({ onSuccess: (right) => ({ right }), onFailure: (left) => ({ left }) }),
    ),
  );

describe("Jev as the router", () => {
  it("reads a sure answer as related or unrelated", async () => {
    expect(await ask(jevReplying([], "serves", 0.93).layer)).toMatchObject({ right: { relation: "related" } });
    expect(await ask(jevReplying([], "unrelated", 0.9).layer)).toMatchObject({ right: { relation: "unrelated" } });
  });

  it("reads an answer below the floor as unsure, whichever way it leans", async () => {
    expect(await ask(jevReplying([], "serves", ROUTE_FLOOR - 0.01).layer)).toMatchObject({ right: { relation: "unsure" } });
  });

  it("asks a busy Jev again instead of failing", async () => {
    const jev = jevReplying([429, 529], "serves", 0.9);

    expect(await ask(jev.layer)).toMatchObject({ right: { relation: "related" } });
    expect(jev.calls()).toBe(3);
  });

  it("gives up after its retries, and on an error a retry cannot fix", async () => {
    const busy = jevReplying([429, 429, 429, 429], "serves", 0.9);
    const refused = jevReplying([401], "serves", 0.9);

    expect(await ask(busy.layer)).toMatchObject({ left: { _tag: "router_failed" } });
    expect(busy.calls()).toBe(4);
    expect(await ask(refused.layer)).toMatchObject({ left: { _tag: "router_failed" } });
    expect(refused.calls()).toBe(1);
  });
});
