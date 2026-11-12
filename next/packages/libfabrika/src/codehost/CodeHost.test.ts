import { expect, it } from "@effect/vitest";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as fc from "fast-check";
import * as CodeHost from "./CodeHost.ts";
import * as CodeHostTest from "./CodeHostTest.ts";

CodeHostTest.suite(CodeHostTest.layer());

it("L1: Path refuses a whole dot or parent segment at any position", () => {
  // Custom fast-check data builds invalid inputs that the accepted Path schema cannot generate.
  const segments = fc
    .array(fc.constantFrom("a b", "dir/[x]", ".dot"))
    .map((paths) => paths.flatMap((path) => path.split("/")));
  const dotPaths = segments.chain((parts) =>
    fc.integer({ min: 0, max: parts.length }).map((index) => ({
      dot: [...parts.slice(0, index), ".", ...parts.slice(index)].join("/"),
      parent: [...parts.slice(0, index), "..", ...parts.slice(index)].join("/"),
    })),
  );
  const decode = Schema.decodeUnknownOption(CodeHost.Path);

  fc.assert(
    fc.property(dotPaths, ({ dot, parent }) => {
      expect(Option.isNone(decode(dot))).toBe(true);
      expect(Option.isNone(decode(parent))).toBe(true);
    }),
    { seed: 119120, numRuns: 100 },
  );
});
