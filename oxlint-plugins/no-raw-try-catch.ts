// Ban raw `try/catch` in any file that imports `effect`: require `Effect.try` /
// `Effect.tryPromise`.
//
// Rationale (single site; #2736): real Effect code models failure in the `E` channel
// via `Effect.try` / `Effect.tryPromise`; a bare `try/catch` inside an effect-importing
// file is the "cosplay as Effect" tell: the failure escapes the type system. Scoped to
// effect-importing files (bare `"effect"` or an `"effect/..."` subpath) so a pure Node
// script that legitimately uses try/catch is not touched.
//
// A genuine pre-runtime bootstrap `try/catch` (e.g. a dynamic-import guard that must run
// before the Effect runtime loads) is exempted per-line with a
// `// oxlint-disable-next-line fabrika/no-raw-try-catch -- <reason>`, never a blanket exemption.
//
// The diagnostic underlines the offending try, not the whole module, and fires only when the
// file also imports `effect`. A `try` with a `finally` is left alone: this looks at `try/catch`
// only. In the pipeline this repo rebuilds it was registered at `warn` (Phase 1 of #2736; the flip
// to `error` is the Phase-3 capstone #2753).
//
// In this repo it blocks in every folder at zero, and advises only in a folder that the config's
// warn override at the end still names (0523). Experiment 125 read its 21 fires on main when it was
// written: all 21 kept their code, 18 of them in `experiments/`, mostly plain Node calls at the
// edge, in functions with no Effect in them. 0523 sets that count aside: a pull request that makes
// a folder block reports the fires it met and each disable line.
import type { CreateRule } from "@oxlint/plugins";
import type { Node } from "./match.ts";

const isEffect = (text: unknown): boolean =>
  typeof text === "string" && (text === "effect" || text.startsWith("effect/"));

const named = (specifier: Node): boolean =>
  specifier.type === "ImportSpecifier" && specifier.imported.type === "Literal" && isEffect(specifier.imported.value);

export const noRawTryCatch: CreateRule = {
  create(context) {
    let imports = false;
    return {
      Program(program) {
        imports = program.body.some(
          (item) => item.type === "ImportDeclaration" && (isEffect(item.source.value) || item.specifiers.some(named)),
        );
      },
      TryStatement(node) {
        if (!imports || node.handler === null || node.finalizer !== null) {
          return;
        }

        context.report({
          node,
          message:
            "Raw `try/catch` is discouraged in an effect-importing file: real Effect code models failure in the `E` channel, not a native throw (#2736). Fix: use `Effect.try({ try, catch })` (sync) or `Effect.tryPromise({ try, catch })` (async), mapping the cause into a `Schema.TaggedErrorClass`: copy `packages/fabrika-cli/src/ui/http.ts` (or `packages/fate-effect`). Exception (e.g. a pre-runtime bootstrap guard): // oxlint-disable-next-line fabrika/no-raw-try-catch -- <reason>.",
        });
      },
    };
  },
};
