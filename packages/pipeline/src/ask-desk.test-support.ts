import { it, type Vitest } from "@effect/vitest";
import { Effect, Schema } from "effect";

/** Effect 4.1.1's property runner, with real services for ledger and reader checks. */
export const property = <const Inputs extends Record<string, Schema.Schema<unknown>>>(
  name: string,
  inputs: Inputs,
  check: (input: { [K in keyof Inputs]: Vitest.ArbitraryValue<Inputs[K]> }) => void | Promise<void>,
) =>
  it.live.prop(
    name,
    inputs,
    (input) =>
      Effect.tryPromise({
        try: async () => check(input),
        catch: (error) => (error instanceof Error ? error : new Error("Ask desk property failed", { cause: error })),
      }),
    { arbitrary: { seed: 119120 } },
  );

// RFC 8785 rejects lone UTF-16 surrogates in display text.
export const unicode = Schema.isPattern(/^[^\uD800-\uDFFF]*$/u);
