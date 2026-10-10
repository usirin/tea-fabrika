import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Criterion, Issue } from "./issue.ts";

/** The heading the enricher's rewrite puts above the report as it was filed. */
export const AS_FILED = "## As filed";

/** What a run folder keeps our enrichment in, beside fabrika's own `fabrika-enriched.md`. */
export const OURS_FILE = "ours-enriched.md";

/** One criterion as a checklist row, the way fabrika writes acceptance criteria, with what code checks it by under it. */
function criterionText(c: Criterion): string {
  const row = `- [ ] ${c.rule} (\`${c.id}\`)`;
  if (c.kind === "unchecked") {
    const files = c.files.length === 0 ? "no one file" : c.files.map((f) => `\`${f}\``).join(", ");
    return [row, `  - unchecked (${c.about}), about ${files}: ${c.why}`].join("\n");
  }
  const imports = [{ name: c.name, file: c.file }, ...c.uses].map((i) => `\`${i.name}\` from \`${i.file}\``).join(", ");
  return [row, `  - imports ${imports}`, ...c.examples.map((e) => `  - \`${e.call}\` → \`${e.result}\``)].join("\n");
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
