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
