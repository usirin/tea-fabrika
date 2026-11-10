// React's own rules (exam item 13, C2, C3 and C6): `react/refs`, `react/immutability` and
// `react/display-name` block in next/'s `.tsx` files, tests left out.
import { describe, expect, it } from "vitest";
import { plant } from "./plant.ts";

const FIRES = "next/packages/tuval/src/window/fires.tsx";
const PASSES = "next/packages/tuval/src/window/passes.tsx";

const fires = [
  'import {memo, useId, useRef} from "react";', // 1
  "export const Tip = () => {", // 2
  "\tconst id = useRef(Math.random()).current;", // 3: refs, read in render
  "\treturn <b id={String(id)} />;", // 4
  "};", // 5
  "export const Rows = (props: {readonly rows: readonly string[]}) => {", // 6
  "\tlet i = 0;", // 7
  "\treturn <ul>{props.rows.map((r) => { i += 1; return <li key={r}>{i}</li>; })}</ul>;", // 8: immutability
  "};", // 9
  "export const Tile = memo(() => <b />);", // 10: display-name
  "export const kept = useId;", // 11
].join("\n");

const passes = [
  'import {useId} from "react";',
  "export const Tip = () => {",
  "\tconst id = useId();",
  "\treturn <b id={id} />;",
  "};",
  "export const Rows = (props: {readonly rows: readonly string[]}) => (",
  "\t<ul>{props.rows.map((r, i) => <li key={r}>{i + 1}</li>)}</ul>",
  ");",
].join("\n");

describe("React's rules in next/", async () => {
  const all = await plant({
    [FIRES]: fires,
    [PASSES]: passes,
    "next/packages/tuval/src/window/fires.test.tsx": fires,
  });

  it("fires on a ref read in render, a change after render, and an unnamed memo", () => {
    expect(all("react(refs)", FIRES)).toEqual([3]);
    expect(all("react(immutability)", FIRES)).toEqual([8]);
    expect(all("react(display-name)", FIRES)).toEqual([10]);
  });

  it("passes the same views written the Compiler's way, and tests", () => {
    for (const code of ["react(refs)", "react(immutability)", "react(display-name)"]) {
      expect(all(code, PASSES)).toEqual([]);
      expect(all(code, "next/packages/tuval/src/window/fires.test.tsx")).toEqual([]);
    }
  });
});
