import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Criterion, Import, Issue } from "./issue.ts";

/** The heading the enricher's rewrite puts above the report as it was filed. */
export const AS_FILED = "## As filed";

/** What a run folder keeps our enrichment in, beside fabrika's own `fabrika-enriched.md`. */
export const OURS_FILE = "ours-enriched.md";

/** One criterion as a checklist row, the way fabrika writes acceptance criteria, with what code checks it by under it. */
function criterionText(c: Criterion): string {
  const row = `- [ ] ${c.rule} (\`${c.id}\`)`;
  const listed = (files: readonly string[]) => (files.length === 0 ? "no one file" : files.map((f) => `\`${f}\``).join(", "));
  const imported = (imports: readonly Import[]) => imports.map((i) => `\`${i.name}\` from \`${i.file}\``).join(", ");
  switch (c.kind) {
    case "unchecked":
      return [row, `  - unchecked (${c.about}), about ${listed(c.files)}: ${c.why}`].join("\n");
    case "existing_test":
      return [row, `  - the test \`${c.test}\` passes; about ${listed(c.files)}`].join("\n");
    case "type":
      return [
        row,
        `  - type check, about ${listed(c.files)}; imports ${imported(c.uses)}`,
        ...c.snippets.map((s) =>
          [`  - ${s.expect}, ${s.today === "holds" ? "holds today (a guard)" : "fails today"}:`, "    ```ts", ...s.code.split("\n").map((l) => `    ${l}`), "    ```"].join("\n"),
        ),
      ].join("\n");
    case "example":
      return [
        row,
        `  - imports ${imported([{ name: c.name, file: c.file }, ...c.uses])}`,
        ...c.examples.map((e) => `  - \`${e.call}\` → \`${e.result}\``),
      ].join("\n");
  }
}

/**
 * Our enrichment of an issue, laid out like fabrika's rewrite so the two read
 * side by side: the rewrite above the report as filed, then the criteria as a
 * checklist, then the call left open. The title and goal go on top, since
 * fabrika keeps its title on the issue rather than in the body.
 */
export function enrichmentText(issue: Issue): string {
  const cut = issue.body.indexOf(`\n\n${AS_FILED}\n\n`);
  const rewrite = (cut === -1 ? issue.body : issue.body.slice(0, cut)).trim();
  return [
    `# ${issue.title}`,
    `**Goal:** ${issue.goal}`,
    rewrite,
    `### Acceptance criteria\n\n${issue.criteria.map(criterionText).join("\n")}`,
    `### Open decision\n\n${issue.openDecision ?? "None."}`,
  ].join("\n\n");
}

/** Keep our enrichment in the run folder as {@link OURS_FILE}, and hand back where. */
export async function saveEnrichment(runDir: string, issue: Issue): Promise<string> {
  const file = join(runDir, OURS_FILE);
  await writeFile(file, `${enrichmentText(issue)}\n`);
  return file;
}
