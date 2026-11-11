// P12, next/. Shape belongs in lint; these laws test that rule with planted source.
import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { plant } from "./plant.ts";

const CODE = "fabrika(no-ledger-sql)";
const FILE = "next/packages/libfabrika/src/cloudflare/runtime.ts";

describe("ledger SQL stays behind its service", () => {
  it("refuses ledger table reads and writes outside the service, including aliases and templates", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom("entries", "rings"),
        fc.constantFrom(" ", "\n", " /* checked */ "),
        fc.boolean(),
        async (table, space, upper) => {
          const word = upper ? table.toUpperCase() : table;
          const queries = [
            `SELECT * FROM${space}${word} AS e`,
            `SELECT e.* FROM dev_clients c JOIN${space}"${word}" e ON 1=1`,
            `SELECT * FROM${space}main.[${word}]`,
            `DELETE FROM${space}\`${word}\``,
            `INSERT INTO${space}${word} VALUES (?)`,
            `UPDATE${space}${word} SET stream=?`,
          ];
          const body = `${queries
            .map((query) => `sql.exec(${JSON.stringify(query)});`)
            .join("\n")}\nsql.exec(\`SELECT * FROM entries WHERE stream=\${stream}\`);`;
          const findings = await plant({
            [FILE]: body,
            "next/packages/libfabrika/src/ledger/internal/ledgerStore.ts": body,
            "next/packages/libfabrika/src/cloudflare/runtime.test.ts": body,
            "next/packages/libfabrika/src/processes/Process.test-support.ts": body,
            "packages/today/runtime.ts": body,
            "next/allowed.ts": 'sql.exec("SELECT * FROM dev_descriptors"); sql.exec("SELECT entries FROM directory");',
          });
          expect(findings(CODE, FILE)).toEqual([1, 2, 3, 4, 5, 6, 7]);

          for (const file of [
            "next/packages/libfabrika/src/ledger/internal/ledgerStore.ts",
            "next/packages/libfabrika/src/cloudflare/runtime.test.ts",
            "next/packages/libfabrika/src/processes/Process.test-support.ts",
            "packages/today/runtime.ts",
            "next/allowed.ts",
          ]) {
            expect(findings(CODE, file)).toEqual([]);
          }
        },
      ),
      { seed: 119120, numRuns: 20 },
    );
  });
});
