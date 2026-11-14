/**
 * x-ci-plant-1: a comment-only plant for experiment 288, never merged.
 *
 * Line 01 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 02 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 03 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 04 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 05 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 06 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 07 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 08 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 09 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 10 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 11 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 12 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 13 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 14 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 15 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 16 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 17 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 18 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 19 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 20 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 21 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 22 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 23 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 24 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 */
/**
 * Checked inputs and ownership rules for one local brain.
 *
 * @stability unstable
 */
import * as Schema from "effect/Schema";

const Text = Schema.NonEmptyString.check(Schema.isPattern(/^[^\p{Cc}]+$/u));
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
  ): boolean {
    return (
      spec.home === job.home &&
      spec.executable === job.executable &&
      spec.build === job.configuration &&
      spec.args.length === job.args.length &&
      spec.args.every((arg, i) => arg === job.args[i])
    );
  }
}
