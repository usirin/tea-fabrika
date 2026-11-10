// No Promise in `next/`: it is Effect all the way (docs/direction/no-promises.md). Tier 1's exam,
// item 1 (docs/plan/tier-1-detail.md, "The exam PR").
//
// It refuses `async`, `await` (and `for await`), `new Promise(...)`, any `Promise.x(...)` call,
// `.then(...)`, `import(...)`, `.catch(...)` unless the object is a name imported from Effect (so
// `Effect.catch(...)` and `Stream.catch(...)` pass), and Effect's own calls that take or make a
// Promise: `Effect.promise`, `Effect.tryPromise` in either form, Schema's four `...Promise`
// decoders and encoders, and Stream's `fromAsyncIterable` and `toAsyncIterable` with its two
// variants (Effect 4.1.1). Those are matched on `Effect`, `Schema` or `Stream` as written, or on any
// name imported from Effect, with or without type arguments: `Effect.promise<number>(...)` counts.
//
// `.oxlintrc.json` turns it on in `next/**` and leaves tests out. The one line a platform demands
// passes only under an edge comment, `// oxlint-disable-next-line fabrika/no-promises -- edge:
// <why>`, which `edge-comment` holds to that shape and CI asks the owner about (Tier 1, P35).
//
// It sees no types: a `.catch` is told apart by the name it is called on, and Effect's calls by
// their written names, so an Effect module bound to a name not imported from Effect, or a Promise
// reached through a helper, passes this syntax rule. `pnpm lint:promise-types` checks those
// values with the installed TypeScript API. Report any remaining miss.
import type { CreateRule, ESTree } from "@oxlint/plugins";
import { effectNames, type Node } from "./match.ts";

/** Effect 4.1.1's calls that take or make a Promise, by the name after the dot. */
const PROMISE_CALLS: ReadonlySet<string> = new Set([
  "promise",
  "tryPromise",
  "decodePromise",
  "encodePromise",
  "decodeUnknownPromise",
  "encodeUnknownPromise",
  "fromAsyncIterable",
  "toAsyncIterable",
  "toAsyncIterableWith",
  "toAsyncIterableEffect",
]);

/** The modules those calls live on, as written when the file does not import them by name. */
const MODULES: ReadonlySet<string> = new Set(["Effect", "Schema", "Stream"]);

const WHY = "next/ is Effect all the way (docs/direction/no-promises.md)";

export const noPromises: CreateRule = {
  create(context) {
    const effect = effectNames(context.sourceCode.ast);
    const refuse = (node: Node, what: string) =>
      context.report({ node, message: `${what}: ${WHY}. Write it as an Effect.` });
    const asyncFn = (node: ESTree.Function | ESTree.ArrowFunctionExpression) => {
      if (node.async) {
        refuse(node, "An `async` function makes a Promise");
      }
    };
    return {
      FunctionDeclaration: asyncFn,
      FunctionExpression: asyncFn,
      ArrowFunctionExpression: asyncFn,
      AwaitExpression(node) {
        refuse(node, "`await` waits on a Promise");
      },
      ForOfStatement(node) {
        if (node.await) {
          refuse(node, "`for await` waits on Promises");
        }
      },
      ImportExpression(node) {
        refuse(node, "`import()` answers a Promise");
      },
      NewExpression(node) {
        if (node.callee.type === "Identifier" && node.callee.name === "Promise") {
          refuse(node, "`new Promise` makes a Promise");
        }
      },
      CallExpression(node) {
        const callee = node.callee;

        if (callee.type === "Identifier" && PROMISE_CALLS.has(callee.name)) {
          if (effect.has(callee.name)) {
            refuse(node, `\`${callee.name}\` takes or makes a Promise`);
          }

          return;
        }

        if (callee.type !== "MemberExpression" || callee.computed) {
          return;
        }

        if (callee.property.type !== "Identifier") {
          return;
        }

        const name = callee.property.name;
        const on = callee.object.type === "Identifier" ? callee.object.name : null;

        if (on !== null && PROMISE_CALLS.has(name) && (MODULES.has(on) || effect.has(on))) {
          refuse(node, `\`${on}.${name}\` takes or makes a Promise`);
        } else if (on === "Promise") {
          refuse(node, `\`Promise.${name}\` works on Promises`);
        } else if (name === "then") {
          refuse(node, "`.then` chains a Promise");
        } else if (name === "catch" && !(callee.object.type === "Identifier" && effect.has(callee.object.name))) {
          refuse(node, "`.catch` on something not imported from Effect is a Promise's");
        }
      },
    };
  },
};
