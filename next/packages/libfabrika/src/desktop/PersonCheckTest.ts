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
// Test-owned sibling Layer. Exhaustion fails closed instead of inventing another checked person.
import { Effect, Layer } from "effect";
/**
 * x-ci-plant-2 middle: every line below this one moves down by three.
 */
import { Answer, PersonCheck, PersonCheckError, Unavailable } from "./PersonCheck.ts";

/**
 * Creates a `PersonCheck` layer that gives one scripted answer per ask, in order. An `unavailable` entry, or an
 * ask past the end of the list, fails with `PersonCheckError`.
 *
 * @stability unstable
 * @category layers
 */
export const layer = (
  answers: ReadonlyArray<"touch" | "click" | "declined" | "unavailable">,
): Layer.Layer<PersonCheck> =>
  Layer.sync(PersonCheck, () => {/** x-ci-plant-2 inner: defineMachine( and syncTest( in a function body. */ 
    let next = 0;
    return PersonCheck.of({
      ask: Effect.fn("PersonCheckTest.ask")(function* (_reason: string) {
        const answer = answers[next++];

        if (answer === "touch" || answer === "click") {
          return Answer.cases.checked.make({ check: answer });
        }

        if (answer === "declined") {
          return Answer.cases.declined.make({});
        }

        return yield* new PersonCheckError({
          reason: new Unavailable({ cause: new Error("No test check available") }),
        });
      }),
    });
  });
