// P17a. Retired app door files may only forward the library's exports.
import type { CreateRule } from "@oxlint/plugins";
import { pathIn } from "./match.ts";

// The gateway's three fronts, the names the old door barrel exported (ticket 477). The app's
// `door-store.ts` and `door-nonce.ts` re-export the other two.
const FRONTS: ReadonlySet<string> = new Set([
  "@kampus/libfabrika/gateway/Gateway",
  "@kampus/libfabrika/gateway/GatewayStore",
  "@kampus/libfabrika/gateway/GatewayNonce",
]);

export const doorIsLibrary: CreateRule = {
  create(context) {
    if (!/^next\/apps\/fabrika\/src\/door(?:-store|-nonce)?\.ts$/.test(pathIn(context))) {
      return {};
    }

    return {
      Program(node) {
        for (const statement of node.body) {
          if (
            (statement.type === "ExportAllDeclaration" || statement.type === "ExportNamedDeclaration") &&
            typeof statement.source?.value === "string" &&
            FRONTS.has(statement.source.value) &&
            !("declaration" in statement && statement.declaration !== null)
          ) {
            continue;
          }

          context.report({
            node: statement,
            message:
              "The door belongs in libfabrika. This retired app file may only re-export the gateway's fronts: @kampus/libfabrika/gateway/Gateway, GatewayStore and GatewayNonce.",
          });
        }
      },
    };
  },
};
