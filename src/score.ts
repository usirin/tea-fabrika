import { type Criterion, type Issue, namedFiles } from "./issue.ts";
import { type Filing, isScored, kindOf, type Level, type ReplayIssue, toPrPath } from "./replay.ts";
import type { Triage } from "./triage.ts";

// Scoring one triage run against what really shipped (`replay/`). Pure: the
// replay record and what our triage ended with in, plain numbers out. No
// single score: each part answers one question, and a reader can check it by
// hand against the two files.

/** Where triage stopped, in one word and why: `triaged`, `parked:needs_decision`, `killed:process_ceremony`. */
export function endOf(triage: Triage): string {
  switch (triage.phase) {
    case "parked":
    case "dropped":
      return `${triage.phase}:${triage.why.kind}`;
    case "killed":
      return `killed:${triage.clause}`;
    default:
      return triage.phase;
  }
}

/** The groups files are scored in. Tests and type tests are one group. */
export type Group = "src" | "test" | "docs";
export const GROUPS: readonly Group[] = ["src", "test", "docs"];

/** What our triage ended with on one issue, as a run keeps it. */
export interface TriageOutcome {
  /** Our rewrite, the last one the run holds. `null` when the enricher never answered. */
  readonly issue: Issue | null;
  /** Jev's sort, when it answered. A killed run is sorted too: it is killed by the sort. */
  readonly sort: { readonly type: string; readonly priority: string; readonly value: string } | null;
  /** Vetting's problems for each draft it checked, in order. Empty when nothing was vetted. */
  readonly vetted: readonly number[];
  /** Where triage stopped: `triaged`, `parked:<why>`, `killed:<clause>`, `dropped:<why>`, or the phase it was left in. */
  readonly end: string;
}

/** One group of files: ours, theirs, and how they meet. A rate with nothing to divide by is `null`. */
export interface FileScore {
  /** Files our criteria name in this group. */
  readonly ours: readonly string[];
  /** Files the PR changed in this group. */
  readonly theirs: readonly string[];
  readonly hits: readonly string[];
  /** The PR's files in this group that did not exist when the issue was filed: nobody could have named them by path. */
  readonly added: readonly string[];
  /** Of ours, the share the PR changed. */
  readonly precision: number | null;
  /** Of theirs, the share we named. */
  readonly recall: number | null;
  /** Of theirs that existed at filing, the share we named. */
  readonly recallExisting: number | null;
}

/** What our criteria say about where the fix lives: each kind's own level, and those together. */
export interface LevelScore {
  readonly ours: Level | "none";
  readonly from: readonly Level[];
  readonly theirs: Level;
  /** 1 for the same level, 0.5 when either side is `mixed` (and ours says anything), else 0. */
  readonly credit: number;
}

export interface CriteriaCount {
  readonly total: number;
  /** Criteria a check runs: an example, a type rule, an existing test. */
  readonly checked: number;
  readonly unchecked: number;
  readonly examples: number;
  readonly snippets: number;
  /** Type snippets that hold today: limits the change must keep. */
  readonly guards: number;
  readonly existingTests: number;
  readonly uncheckedAbout: { readonly type: number; readonly doc: number; readonly other: number };
}

export interface TriageScore {
  readonly number: number;
  readonly end: string;
  readonly files: Readonly<Record<Group, FileScore>>;
  readonly level: LevelScore | null;
  readonly type: { readonly ours: string | null; readonly theirs: string; readonly match: boolean };
  /** `p1Baseline`: whether a triage that always says p1 would have matched. */
  readonly priority: { readonly ours: string | null; readonly theirs: string; readonly match: boolean; readonly p1Baseline: boolean };
  readonly criteria: CriteriaCount | null;
  /** How many drafts vetting checked, whether the last passed, and each draft's problem count. */
  readonly vetting: { readonly drafts: number; readonly passed: boolean; readonly problems: readonly number[] };
  readonly openDecision: boolean;
  /**
   * "Would our checks have caught it", as a proxy: the files our checked
   * criteria run or import (an example's module and what it uses, a type
   * rule's files and imports, an existing test and the page it checks) that
   * the PR changed. Touching a file is not testing the change in it.
   */
  readonly caught: { readonly yes: boolean; readonly files: readonly string[]; readonly prTests: readonly string[] };
}

const unique = (paths: Iterable<string>): string[] => [...new Set([...paths].map((p) => p.replace(/^\.\//, "")))].sort();

/** The group a file is scored in, or `null` for one left out (a changeset, a generated page, anything else). */
function groupOf(path: string, preMonorepoLayout: boolean): Group | null {
  const kind = kindOf(path, preMonorepoLayout);
  if (kind === "src" || kind === "docs") return kind;
  if (kind === "test" || kind === "type-test") return "test";
  return null;
}

const share = (part: number, whole: number): number | null => (whole === 0 ? null : part / whole);

/** The files a checked criterion runs or imports. An unchecked rule runs nothing. */
function checkedFiles(c: Criterion): readonly string[] {
  switch (c.kind) {
    case "example":
      return [c.file, ...c.uses.map((u) => u.file)];
    case "type":
      return [...c.files, ...c.uses.map((u) => u.file)];
    case "existing_test":
      return [c.test, ...c.files];
    case "unchecked":
      return [];
  }
}

/** Ours against the PR's files, one group at a time. `atFiling` holds the PR's files that existed when the issue was filed. */
export function scoreFiles(
  ours: readonly string[],
  replay: ReplayIssue,
  atFiling: ReadonlySet<string>,
): Readonly<Record<Group, FileScore>> {
  const theirsAll = replay.filesChanged.filter((f) => isScored(f.kind)).map((f) => f.path);
  const one = (group: Group): FileScore => {
    const inGroup = (p: string) => groupOf(p, replay.preMonorepoLayout) === group;
    const mine = unique(ours.filter(inGroup));
    const theirs = unique(theirsAll.filter(inGroup));
    const hits = theirs.filter((p) => mine.includes(p));
    const added = theirs.filter((p) => !atFiling.has(p));
    const existing = theirs.filter((p) => atFiling.has(p));
    return {
      ours: mine,
      theirs,
      hits,
      added,
      precision: share(hits.length, mine.length),
      recall: share(hits.length, theirs.length),
      recallExisting: share(hits.filter((p) => atFiling.has(p)).length, existing.length),
    };
  };
  return { src: one("src"), test: one("test"), docs: one("docs") };
}

/** Does an existing test guard a doc page: it names one, or it is a doc page's test (tea's `src/docs/`)? */
const guardsADoc = (c: Extract<Criterion, { kind: "existing_test" }>): boolean =>
  c.files.some((f) => /\.mdx?$/.test(f)) || /(^|\/)src\/docs\//.test(c.test);

/** The level one criterion points at, or `null` for a rule about something else. */
function levelOfCriterion(c: Criterion): Exclude<Level, "mixed"> | null {
  switch (c.kind) {
    case "example":
      return "runtime";
    case "type":
      return "type";
    case "existing_test":
      return guardsADoc(c) ? "docs" : "runtime";
    case "unchecked":
      return c.about === "type" ? "type" : c.about === "doc" ? "docs" : null;
  }
}

/** Our criteria's level against the PR's, with half credit when either side is mixed. */
export function scoreLevel(issue: Issue, theirs: Level): LevelScore {
  const from = [...new Set(issue.criteria.flatMap((c) => levelOfCriterion(c) ?? []))].sort();
  const ours: Level | "none" = from.length === 0 ? "none" : from.length === 1 ? (from[0] as Level) : "mixed";
  const credit = ours === theirs ? 1 : ours !== "none" && (ours === "mixed" || theirs === "mixed") ? 0.5 : 0;
  return { ours, from, theirs, credit };
}

export function countCriteria(issue: Issue): CriteriaCount {
  const of = <K extends Criterion["kind"]>(kind: K) => issue.criteria.filter((c): c is Extract<Criterion, { kind: K }> => c.kind === kind);
  const unchecked = of("unchecked");
  const snippets = of("type").flatMap((c) => c.snippets);
  return {
    total: issue.criteria.length,
    checked: issue.criteria.length - unchecked.length,
    unchecked: unchecked.length,
    examples: of("example").reduce((n, c) => n + c.examples.length, 0),
    snippets: snippets.length,
    guards: snippets.filter((s) => s.today === "holds").length,
    existingTests: of("existing_test").length,
    uncheckedAbout: {
      type: unchecked.filter((c) => c.about === "type").length,
      doc: unchecked.filter((c) => c.about === "doc").length,
      other: unchecked.filter((c) => c.about === "other").length,
    },
  };
}

/** The label's value without its prefix: `type:bug` is `bug`. */
const bare = (label: string) => label.replace(/^type:/, "");

/**
 * Score one triage run against the replay record. `filing` says which of the
 * PR's files existed when the issue was filed, and whether tea was still at
 * the repo's root then: our paths are read the way the PR names them.
 */
export function scoreTriage(replay: ReplayIssue, outcome: TriageOutcome, filing: Filing): TriageScore {
  const { issue, sort, vetted } = outcome;
  const asPr = (paths: Iterable<string>) => unique([...paths].map((p) => toPrPath(p, replay, filing.teaAtRoot)));
  const changed = new Set(replay.filesChanged.filter((f) => isScored(f.kind)).map((f) => f.path));
  const prTests = new Set(replay.testsAdded.map((t) => t.path));
  const checked = issue === null ? [] : asPr(issue.criteria.flatMap(checkedFiles));
  const touched = checked.filter((p) => changed.has(p));
  const theirsType = bare(replay.labelsAtClose.type);
  const theirsPriority = replay.labelsAtClose.priority;
  return {
    number: replay.number,
    end: outcome.end,
    files: scoreFiles(issue === null ? [] : asPr(namedFiles(issue)), replay, filing.files),
    level: issue === null ? null : scoreLevel(issue, replay.level),
    type: { ours: sort?.type ?? null, theirs: theirsType, match: sort?.type === theirsType },
    priority: {
      ours: sort?.priority ?? null,
      theirs: theirsPriority,
      match: sort?.priority === theirsPriority,
      p1Baseline: theirsPriority === "p1",
    },
    criteria: issue === null ? null : countCriteria(issue),
    vetting: { drafts: vetted.length, passed: vetted.length > 0 && vetted.at(-1) === 0, problems: vetted },
    openDecision: issue !== null && issue.openDecision !== null,
    caught: { yes: touched.length > 0, files: touched, prTests: checked.filter((p) => prTests.has(p)) },
  };
}

/** A rate as a whole percent, `-` when there was nothing to divide by. */
const pct = (rate: number | null) => (rate === null ? "-" : `${Math.round(rate * 100)}%`);

/** One group's precision and recall for a table cell: `P/R`, recall over existing files in brackets when it differs. */
function filesCell(f: FileScore): string {
  if (f.ours.length === 0 && f.theirs.length === 0) return "-";
  const existing = f.added.length > 0 ? ` (${pct(f.recallExisting)})` : "";
  return `${pct(f.precision)} / ${pct(f.recall)}${existing}`;
}

/** What one run cost: Claude's dollars as `claude -p` reported them, and Jev's calls. */
export interface RunCost {
  readonly claudeUsd: number;
  readonly jevCalls: number;
}

/** Scores as a Markdown table, one row per issue, then the totals a reader compares with the baselines. */
export function scoreTable(rows: readonly { readonly score: TriageScore; readonly cost: RunCost | null }[]): string {
  const head = [
    "| # | End | Type ours/theirs | Prio ours/theirs | Level ours/theirs | src P / R | test P / R | docs P / R | Checked / all | Vetting | Caught | Claude $ | Jev |",
    "|---|---|---|---|---|---|---|---|---|---|---|---|---|",
  ];
  const body = rows.map(({ score: s, cost }) => {
    const mark = (ok: boolean) => (ok ? "" : " ✗");
    const vet = s.vetting.drafts === 0 ? "none" : `${s.vetting.passed ? "passed" : "failed"}, ${s.vetting.drafts} draft(s) [${s.vetting.problems.join(",")}]`;
    return [
      `#${s.number}`,
      s.end,
      `${s.type.ours ?? "-"} / ${s.type.theirs}${mark(s.type.match)}`,
      `${s.priority.ours ?? "-"} / ${s.priority.theirs}${mark(s.priority.match)}`,
      s.level === null ? "-" : `${s.level.ours} / ${s.level.theirs} (${s.level.credit})`,
      filesCell(s.files.src),
      filesCell(s.files.test),
      filesCell(s.files.docs),
      s.criteria === null ? "-" : `${s.criteria.checked} / ${s.criteria.total}`,
      vet,
      s.caught.yes ? `yes (${s.caught.files.length})` : "no",
      cost === null ? "-" : cost.claudeUsd.toFixed(2),
      cost === null ? "-" : String(cost.jevCalls),
    ].join(" | ");
  });
  const n = rows.length;
  const count = (f: (s: TriageScore) => boolean) => rows.filter(({ score }) => f(score)).length;
  const levelCredit = rows.reduce((sum, { score }) => sum + (score.level?.credit ?? 0), 0);
  const spent = rows.reduce((sum, { cost }) => sum + (cost?.claudeUsd ?? 0), 0);
  const totals = [
    `type ${count((s) => s.type.match)}/${n}`,
    `priority ${count((s) => s.priority.match)}/${n} (always p1: ${count((s) => s.priority.p1Baseline)}/${n})`,
    `level ${levelCredit}/${n}`,
    `vetting passed ${count((s) => s.vetting.passed)}/${n}`,
    `caught ${count((s) => s.caught.yes)}/${n}`,
    `Claude $${spent.toFixed(2)}`,
  ].join("; ");
  return [...head, ...body.map((cells) => `| ${cells} |`), "", `Totals: ${totals}.`].join("\n");
}
