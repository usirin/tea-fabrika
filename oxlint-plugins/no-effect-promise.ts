// Ban `Effect.promise(...)` and single-arg `Effect.tryPromise(...)`: require the
// object-notation `Effect.tryPromise({ try, catch })` with an explicit tagged-error `catch`.
//
// Rationale (single site; .patterns/index.md house rule "Effect.tryPromise always uses
// object notation"): `Effect.promise` and the single-arg `Effect.tryPromise(() => p)`
// carry no `catch`, so a rejection surfaces as an uncatchable DEFECT with an empty `E`
// channel instead of a typed, recoverable failure: the "cosplay as Effect" tell the
// #2736 audit found across the CLI packages. The object form forces a `catch` that maps
// the cause into a tagged error, keeping the failure in `E`.
//
// Discriminator: the object form's sole argument is an object literal; the single-arg thunk form
// is anything else (an arrow, a function expression, a bare identifier). So `Effect.tryPromise(x)`
// is flagged only when its one argument is NOT an object literal: the object-notation call is left
// alone. A call with no arguments or with more than one is flagged too.
//
// In the pipeline this repo rebuilds it was registered at `warn` (Phase 1 of #2736: the flip to
// `error` is the Phase-3 capstone #2753; warn keeps CI green while every site is remediated). A
// genuine exception is a per-line `// oxlint-disable-next-line fabrika/no-effect-promise -- <reason>`.
//
// In this repo it blocks in every folder at zero, and advises only in a folder that the config's
// warn override at the end still names (0523). Experiment 125 read its 8 fires on main when it was
// written: all 8 kept their code, 7 of them for the case Effect's docs give `Effect.promise` (a
// promise that cannot reject). 0523 sets that count aside: a pull request that makes a folder block
// reports the fires it met and each disable line, so a rule that needs a narrower scope shows there.
import type { CreateRule } from "@oxlint/plugins";
import { grouped, plainCall } from "./match.ts";

export const noEffectPromise: CreateRule = {
  create(context) {
    return {
      CallExpression(node) {
        const name = plainCall(node);

        if (name === "Effect.promise") {
          context.report({
            node: node.arguments[0] ?? node,
            message:
              "`Effect.promise(...)` is discouraged: a rejection becomes an uncatchable defect with an empty error channel (.patterns/index.md; #2736). Fix: use object-notation `Effect.tryPromise({ try, catch: (cause) => new SomeError({ cause }) })` with a `Schema.TaggedErrorClass`, or lift the pure core to an `Effect.fn` returning a typed `Effect`: copy `packages/fabrika-cli/src/capture/capture.ts` (or `packages/fate-effect`). Exception: // oxlint-disable-next-line fabrika/no-effect-promise -- <reason>.",
          });
        }

        if (name === "Effect.tryPromise") {
          const [only] = node.arguments;
          const isObject =
            node.arguments.length === 1 && only?.type === "ObjectExpression" && grouped(context.sourceCode, only) === 0;

          if (isObject) {
            return;
          }

          context.report({
            node: only ?? node,
            message:
              "Single-arg `Effect.tryPromise(() => ...)` is discouraged: with no `catch` a rejection becomes an uncatchable defect with an empty error channel (.patterns/index.md; #2736). Fix: use object-notation `Effect.tryPromise({ try, catch: (cause) => new SomeError({ cause }) })` with a `Schema.TaggedErrorClass`: copy `packages/fabrika-cli/src/capture/capture.ts` (or `packages/fate-effect`). Exception: // oxlint-disable-next-line fabrika/no-effect-promise -- <reason>.",
          });
        }
      },
    };
  },
};
