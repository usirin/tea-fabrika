// next/'s product code reads the time through Effect: `Clock.currentTimeMillis` or `DateTime.now`,
// so a test sets it with `TestClock` and a span sees the same clock. This rule refuses the
// platform's own clock reads: `Date.now()`, `new Date()` with no arguments and `Date()`, each also
// through `window.` or `globalThis.`. `new Date(at)` passes, as in `no-clock-in-view`: it reads a time
// it was given. `.oxlintrc.json` turns it on for `next/**/*.ts` and leaves tests and test helpers out;
// a `.tsx` file has `no-clock-in-view`, which refuses more.
//
// It sees no types: `const now = Date.now; now()` and a clock read through a helper pass.
import type { CreateRule } from "@oxlint/plugins";
import { clockReads } from "./no-clock-in-view.ts";

export const noWallClock: CreateRule = clockReads(
  new Set(["Date.now"]),
  "Read the time through Effect, `Clock.currentTimeMillis` or `DateTime.now`, so a test sets it with `TestClock`; `new Date(at)` with a time it was given passes.",
);
