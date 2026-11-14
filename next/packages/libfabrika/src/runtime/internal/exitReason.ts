/**
 * x-ci-plant-2: trap text in a comment, for experiment 288, never merged.
import { spawn } from "node:child_process";
import { Plant } from "../../../x-ci-plant-not-a-file.ts";
export { Plant } from "@kampus/libfabrika/gateway/Gateway";
 * defineMachine({ id: "x-ci-plant" }) and defineProgram( and syncTest( and Effect.runPromise(
 * person:x-ci-plant p8-clean-window p8-mcp-marker node:fs node:child_process
 * imports "../access/Access.ts" and new Promise( and process.env.X_CI_PLANT
 * paths: ./next/apps/fabrika/src/x-ci-plant.ts ../../x-ci-plant/secret.txt /etc/x-ci-plant
 * a url: https://example.invalid/x-ci-plant and a line pin: x-ci-plant.ts:1:1
 */
import { ExitReason } from "../../processes/ExitReason.ts";
/**
 * x-ci-plant-2 middle: every line below this one moves down by three.
 */
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
