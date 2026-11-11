import { ExitReason } from "../../processes/ExitReason.ts";
import type { Failure } from "./recovery.ts";

/**
 * The exit reason for one captured failure: its phase, and the class the runner already captured.
 * A class past the bound is kept whole, never cut to fit, so the exit boundary refuses it.
 * @internal
 */
export const fromFailure = (failure: Failure): ExitReason =>
  failure._tag === "interrupted"
    ? ExitReason.cases.crashed.make({ phase: "interrupted" })
    : ExitReason.cases.crashed.make(
        { phase: failure._tag === "fresh" ? "step" : "saved_letter", error: failure.error },
        { disableChecks: true },
      );
