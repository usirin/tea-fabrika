// Design foundations PR 3. Every CSS rule blocks from day one. The CSS check reads next/ and the
// design package (0525), so no known list holds an entry: each stays `[]` because stylelint.ts
// needs one until the option and its reader go.
import { join } from "node:path";
import type { Config } from "stylelint";

export default {
  plugins: [
    "token-exists",
    "no-raw-color",
    "no-primitive-var",
    "part-token-owner",
    "motion-under-guard",
    "font-size-from-scale",
  ].map((name) => join(import.meta.dirname, "oxlint-plugins/css", `${name}.ts`)),
  defaultSeverity: "error",
  reportDescriptionlessDisables: true,
  reportNeedlessDisables: true,
  reportInvalidScopeDisables: true,
  reportUnscopedDisables: true,
  rules: {
    "fabrika/token-exists": [
      true,
      {
        severity: "error",
        known: [],
      },
    ],
    "fabrika/no-raw-color": [
      true,
      {
        severity: "error",
        known: [],
      },
    ],
    "fabrika/no-primitive-var": [true, { severity: "error", known: [] }],
    "fabrika/part-token-owner": [true, { severity: "error", known: [] }],
    "fabrika/motion-under-guard": [true, { severity: "error", known: [] }],
    "fabrika/font-size-from-scale": [
      true,
      {
        severity: "error",
        known: [],
      },
    ],
  },
} satisfies Config;
