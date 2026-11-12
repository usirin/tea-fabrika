// U11. Syntax only: platform names stay at the Cloudflare edge. Aliases need review.
// Edge cases: types, optional members, literal computed members, comments, strings, app handoff.
import type { CreateRule } from "@oxlint/plugins";
import { pathIn } from "./match.ts";

export const isolateBoundary: CreateRule = {
  create(context) {
    const file = pathIn(context);

    if (!file.startsWith("next/") || file.startsWith("next/packages/libfabrika/src/cloudflare/")) {
      return {};
    }

    return {
      Identifier(node) {
        if (node.name === "TraceItem" || node.name === "Fetcher") {
          context.report({ node, message: "Keep isolate platform types in libfabrika's cloudflare/ module (U11)." });
        }
      },
      MemberExpression(node) {
        const exported = node.computed
          ? node.property.type === "Literal" && node.property.value === "exports"
          : node.property.type === "Identifier" && node.property.name === "exports";
        const ctx = node.object.type === "Identifier" && node.object.name === "ctx";
        const own =
          node.object.type === "MemberExpression" &&
          node.object.object.type === "ThisExpression" &&
          node.object.property.type === "Identifier" &&
          node.object.property.name === "ctx";

        if (exported && (ctx || own)) {
          context.report({ node, message: "Build isolate tails through ctx.exports in cloudflare/ (U11)." });
        }
      },
      MethodDefinition(node) {
        if (
          file !== "next/apps/fabrika/src/brain.ts" ||
          node.key.type !== "Identifier" ||
          (node.key.name !== "tail" && node.key.name !== "usage")
        ) {
          return;
        }

        const body = node.value.body?.body;
        const only = body?.[0];

        if (body?.length !== 1 || only?.type !== "ReturnStatement" || only.argument?.type !== "CallExpression") {
          context.report({
            node,
            message: "The app tail and usage methods return one library call; decoding belongs in cloudflare/ (U11).",
          });
        }
      },
    };
  },
};
