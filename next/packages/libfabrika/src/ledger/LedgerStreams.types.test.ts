// A13, next/. Type checks keep the ledger discovery contract independent of its callers.
import { expect, expectTypeOf, it } from "@effect/vitest";
import { type Context, Schema, type Stream } from "effect";
import type { LedgerStreams } from "./LedgerStreams.ts";
import { BadRow, LedgerStreamsError, Storage } from "./LedgerStreams.ts";

const checkTypes = () => {
  expectTypeOf<Context.Service.Shape<typeof LedgerStreams>>().toEqualTypeOf<{
    readonly list: (prefix: string) => Stream.Stream<string, LedgerStreamsError>;
  }>();
  expectTypeOf<LedgerStreamsError["reason"]>().toEqualTypeOf<Storage | BadRow>();
  expectTypeOf<Storage["cause"]>().toEqualTypeOf<unknown>();
  expectTypeOf<BadRow["cause"]>().toEqualTypeOf<unknown>();
  expectTypeOf<typeof LedgerStreams>().not.toHaveProperty("layer");
};

it.prop(
  "A13: discovery errors retain their tagged reason and cause",
  { cause: Schema.String },
  ({ cause }) => {
    expectTypeOf(checkTypes).toBeFunction();

    for (const reason of [new Storage({ cause }), new BadRow({ cause })]) {
      const error = new LedgerStreamsError({ reason });
      expect(error.reason).toBe(reason);
      expect(error.reason.cause).toBe(cause);
    }
  },
  { arbitrary: { seed: 119120, runs: 100 } },
);
