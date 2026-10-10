import { z } from "zod";
import { type FactsPack, mentionsOf } from "./facts.ts";
import type { Issue, RawIssue } from "./issue.ts";

// The published surface of the package a change works in, and what a change
// may do to it. A builder must not change published API the ticket did not
// ask to change: run 2 of kamp-us/demlik#558 dropped `NoInfer` from a stable
// helper to make a generated test compile. Limit what comes out, not how.
//
//   code    what each export-map entry publishes, by name, with its
//           declaration text, where the change started and in the change
//           (declaration emit, the api-extractor idea: src/declarations.ts)
//   here    which differences the ticket names, purely, so a replay agrees:
//           a named one is allowed and listed for the person who approves;
//           any other goes back to the builder

/** One published name the change added, removed or changed, in the subpaths that publish it, with its declaration before and after. */
export const ApiChange = z.object({
  name: z.string(),
  /** The export-map subpaths, such as `.` or `./testing`, where it changed this way. */
  subpaths: z.array(z.string()).readonly(),
  kind: z.enum(["added", "removed", "changed"]),
  /** The declaration where the change started, on one line; `null` when it was not published. */
  before: z.string().nullable(),
  /** The declaration in the change; `null` when it is no longer published. */
  after: z.string().nullable(),
});
export type ApiChange = z.infer<typeof ApiChange>;

/** What the comparison found, or why it did not run: no package to compare, or the emit failed. */
export const ApiDiff = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("compared"), package: z.string(), changes: z.array(ApiChange).readonly() }),
  z.object({ kind: z.literal("skipped"), why: z.string() }),
]);
export type ApiDiff = z.infer<typeof ApiDiff>;

/**
 * Whether a published name the change adds, and the ticket does not name,
 * goes back to the builder (`problem`) or is only listed for the person who
 * approves (`listed`).
 */
export const NewExports = z.enum(["problem", "listed"]);
export type NewExports = z.infer<typeof NewExports>;

/**
 * The names the ticket itself names: the facts gathered for its report, but
 * not the ones only a doc page's code calls (`calledIn`), which would let a
 * change rework a helper because a page happens to use it. Without facts, the
 * names the report mentions.
 */
export const ticketNames = (raw: RawIssue, facts: FactsPack | null): readonly string[] =>
  facts === null
    ? mentionsOf(`${raw.title}\n\n${raw.body}`).names
    : facts.names.flatMap((n) => (n.calledIn === null ? [n.name] : []));

/** The names a criterion's checks call and import: an example's own and what it uses, what type snippets import. */
const usedBy = (c: Issue["criteria"][number]): readonly string[] =>
  c.kind === "example" ? [c.name, ...c.uses.map((u) => u.name)] : c.kind === "type" ? c.uses.map((u) => u.name) : [];

/**
 * Every name the issue names: what its criteria's rules mention, the names
 * its examples and type snippets call and use, and the ticket's own `named`.
 * Not every name declared in a file a criterion names: a rule about
 * `runtime-types.ts` does not open all of it.
 */
export function namedIn(issue: Issue, named: readonly string[]): ReadonlySet<string> {
  const criteria = issue.criteria.flatMap((c) => [...mentionsOf(c.rule).names, ...usedBy(c)]);
  return new Set([...criteria, ...named]);
}

/** How the policy reads a comparison: problems for the builder, and the allowed changes to list. */
export interface ApiRuling {
  readonly problems: readonly string[];
  readonly allowed: readonly ApiChange[];
}

const where = (c: ApiChange) => c.subpaths.map((p) => `"${p}"`).join(", ");

/** What the builder is told about one change the ticket does not name. */
function problemOf(c: ApiChange): string {
  const out = "the ticket does not name it: put it back, or answer contradiction if the ticket cannot be done without it.";
  switch (c.kind) {
    case "changed":
      return `You changed the published signature of ${c.name} (${where(c)}); ${out}\n  before: ${c.before}\n  after:  ${c.after}`;
    case "removed":
      return `You removed ${c.name} from the published API (${where(c)}); ${out}\n  before: ${c.before}`;
    case "added":
      return `You added ${c.name} to the published API (${where(c)}); the ticket does not name it: keep it unexported, or answer contradiction if the ticket cannot be done without it.\n  after:  ${c.after}`;
  }
}

/**
 * Pure: a change to a name the issue names is allowed, and listed; any other
 * change or removal is a problem; an added name is a problem unless
 * `newExports` is `listed`. A comparison that did not run allows everything:
 * it is recorded as skipped, never guessed at.
 */
export function ruleOnApi(diff: ApiDiff, named: ReadonlySet<string>, newExports: NewExports): ApiRuling {
  if (diff.kind === "skipped") return { problems: [], allowed: [] };
  const sent = diff.changes.filter((c) => !named.has(c.name) && (c.kind !== "added" || newExports === "problem"));
  return { problems: sent.map(problemOf), allowed: diff.changes.filter((c) => !sent.includes(c)) };
}

/** One line for the person who approves. */
export const apiLine = (c: ApiChange): string =>
  `published ${c.kind} ${c.name} (${where(c)})${c.kind === "changed" ? `: ${c.before} -> ${c.after}` : ""}`;
