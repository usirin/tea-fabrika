// next/: the ledger's entries and rings belong to the ledger service, including reads.
import type { CreateRule } from "@oxlint/plugins";
import { heldToNext, pathIn, type Node } from "./match.ts";

const OWNERS = new Set([
  "next/packages/libfabrika/src/ledger/internal/ledgerStore.ts",
  "next/packages/libfabrika/src/ledger/Referee.ts",
  "next/packages/libfabrika/src/ledger/Ledger.ts",
]);

// Strip SQL comments before recognizing quoted or plain table names in table positions.
const touchesLedger = (query: string) =>
  /\b(?:from|join|into|update|table(?:\s+if\s+(?:not\s+)?exists)?)\s+(?:main\s*\.\s*)?["`[]?(?:entries|rings)\b/i.test(
    query.replace(/\/\*[\s\S]*?\*\/|--[^\n]*/g, " "),
  );

export const noLedgerSql: CreateRule = {
  create(context) {
    const file = pathIn(context);

    if (!heldToNext(file) || OWNERS.has(file) || /\.(?:test|test-support|d)\.tsx?$/.test(file)) {
      return {};
    }

    const report = (node: Node, query: string) => {
      if (touchesLedger(query)) {
        context.report({
          node,
          message:
            "Read and write ledger tables through Ledger or Referee (docs/direction/ledger-behind-a-service.md).",
        });
      }
    };
    return {
      Literal(node) {
        if (typeof node.value === "string") {
          report(node, node.value);
        }
      },
      TemplateLiteral(node) {
        report(node, node.quasis.map((q) => q.value.cooked ?? q.value.raw).join("?"));
      },
    };
  },
};
