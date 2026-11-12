// L11, next/. These imports are the public contracts a second client needs.
import { it, expectTypeOf } from "@effect/vitest";
import type { BrainControlError } from "@kampus/libfabrika/desktop/BrainControl";
import type { BrainProbeError } from "@kampus/libfabrika/desktop/BrainProbe";
import type {
  BrainService,
  BrainServiceError,
  Conflict,
  Operation,
  Timeout,
} from "@kampus/libfabrika/desktop/BrainService";
import type { Effect } from "effect";

it("format: L11 the public lifecycle has typed errors and needs no app or native types", () => {
  // This is a compile-time contract. CI's typecheck is its runner.
  expectTypeOf<BrainService["Service"]["up"]>().toEqualTypeOf<
    Effect.Effect<{ readonly url: string }, BrainServiceError>
  >();
  expectTypeOf<BrainService["Service"]["stop"]>().toEqualTypeOf<Effect.Effect<void, BrainServiceError>>();
  expectTypeOf<BrainServiceError["reason"]>().toEqualTypeOf<Operation | Timeout | Conflict>();
  expectTypeOf<BrainControlError["reason"]["_tag"]>().toEqualTypeOf<
    "Command" | "Storage" | "Unsupported" | "Conflict"
  >();
  expectTypeOf<BrainProbeError["reason"]["_tag"]>().toEqualTypeOf<"Unreachable" | "Foreign" | "Cleanup">();
  // @ts-expect-error a bare reason loses its failure class
  const invalid: BrainServiceError["reason"] = "stop";
  expectTypeOf(invalid).not.toEqualTypeOf<string>();
  expectTypeOf<typeof BrainServiceError.Type>().toEqualTypeOf<BrainServiceError>();
});
