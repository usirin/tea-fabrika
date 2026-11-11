// A view never reads the clock or randomness, in render or in a handler it makes; the time comes
// through a Cmd, as Elm's `Time.now` does (docs/direction/react-compiler.md, C1, and
// docs/direction/elm-first.md). React's own `react/purity` refuses these in render only, and allows
// them in an event handler on purpose. This rule holds the rest (owner, 2026-11-05).
//
// It refuses `Date.now()`, `new Date()` with no arguments, `Date()`, `performance.now()`,
// `Math.random()` and `crypto.randomUUID()`, each also reached through `window.` or `globalThis.`.
// `new Date(at)` passes: it reads a time it was given. `.oxlintrc.json` turns it on in
// `next/**/*.tsx` and leaves tests out.
//
// It sees no types: the same read through a helper in a `.ts` file passes. Report any miss.
import type { CreateRule } from "@oxlint/plugins";
import { dotted } from "./match.ts";

const READS = new Set(["Date.now", "performance.now", "Math.random", "crypto.randomUUID"]);

/** The written name without a leading `window.` or `globalThis.`. */
const plain = (name: string | null): string | null =>
  name === null ? null : name.replace(/^(?:window|globalThis)\./, "");

const MESSAGE =
  "A view reads no clock and no randomness, handlers included: send a Msg with no time, and let `update` ask for it with a Cmd (docs/direction/react-compiler.md, C1).";

export const noClockInView: CreateRule = {
  create(context) {
    return {
      CallExpression(node) {
        const name = plain(dotted(node.callee));

        if (name !== null && (READS.has(name) || name === "Date")) {
          context.report({ node, message: MESSAGE });
        }
      },
      NewExpression(node) {
        if (plain(dotted(node.callee)) === "Date" && node.arguments.length === 0) {
          context.report({ node, message: MESSAGE });
        }
      },
    };
  },
};
