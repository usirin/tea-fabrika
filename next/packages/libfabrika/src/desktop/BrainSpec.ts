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
/**
 * Checked inputs and ownership rules for one local brain.
 *
 * @stability unstable
 */
import * as Schema from "effect/Schema";

const Text = Schema.NonEmptyString.check(Schema.isPattern(/^[^\p{Cc}]+$/u));
/**
 * x-ci-plant-2 middle: every line below this one moves down by three.
 */
const Absolute = Text.check(Schema.isPattern(/^\//u));

const Home = Absolute.check(
  Schema.makeFilter(
    (value) =>
      value === "/" ||
      (!value.endsWith("/") &&
        !value
          .split("/")
          .slice(1)
          .some((s) => s === "" || s === "." || s === "..")),
    { expected: "a canonical absolute home" },
  ),
);

/**
 * Immutable installation facts. No identity keys belong in this value.
 *
 * @stability unstable
 * @category schemas
 */
export class BrainSpec extends Schema.Opaque<BrainSpec>()(
  Schema.Struct({
    home: Home,
    executable: Absolute,
    args: Schema.Array(Text).check(Schema.isMinLength(1)),
    url: Schema.String.check(
      Schema.isPattern(/^http:\/\/127\.0\.0\.1:[1-9][0-9]{0,4}$/u),
      Schema.makeFilter((url) => Number(url.slice(url.lastIndexOf(":") + 1)) <= 65535, {
        expected: "a local instance port",
      }),
    ),
    build: Text,
  }),
) {
  /** Compare every job fact before reusing or stopping it. */
  static matches(
    spec: BrainSpec,
    job: {
      readonly executable: string;
      readonly args: ReadonlyArray<string>;
      readonly home: string;
      readonly configuration: string;
    },
  ): boolean {/** x-ci-plant-2 inner: defineMachine( and syncTest( in a function body. */ 
    return (
      spec.home === job.home &&
      spec.executable === job.executable &&
      spec.build === job.configuration &&
      spec.args.length === job.args.length &&
      spec.args.every((arg, i) => arg === job.args[i])
    );
  }
}
