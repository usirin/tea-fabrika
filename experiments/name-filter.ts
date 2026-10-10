// Can a free code filter shrink the missing-file check's list before Jev?
//
// Experiment 36 asked Jev of every untouched file in the touched packages
// (268 to 1,591 per trial, ~13,000 tokens each). This rebuilds the same
// trials (`missing-trials.ts`: same PRs, same hidden file, same diff Jev saw)
// and asks only git and text search which candidates to keep. No Jev call.
//
// For each filter and trial: was the hidden file kept, and how many
// candidates were kept, of how many. The control trials (nothing hidden) give
// the list size on a complete change. Jev's wins (hidden file ranked 1st in
// `results/missing-probe-package.json`) are read back to see if a filter
// throws them away.
//
// Run with `node experiments/name-filter.ts`; needs `gh` and a phoenix
// checkout at PHOENIX. Writes `results/name-filter.json`.
import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { importedBy, importsOneOf, stem } from "../src/imports.ts";
import { git, PHOENIX, PRS, type Trial, trials } from "./missing-trials.ts";

/** Tokens per Jev call (whole file plus diff plus ticket) and dollars per million, from experiment 36's bill. */
const TOKENS_PER_CALL = 13_000;
const DOLLARS_PER_MILLION = 0.042;
/** How many recent commits touching a shown file the co-change filter reads. */
const COCHANGE_COMMITS = 50;
const COCHANGE_MAX_FILES = 20;

const IDENT = /[A-Za-z_$][\w$]*/g;
/** JS/TS keywords and words so common in this code they say nothing. */
const STOP = new Set(
  (
    "abstract any as asserts async await bigint boolean break case catch class const constructor continue debugger declare default delete do else enum export extends false finally for from function get if implements import in infer instanceof interface is keyof let module namespace never new null number object of package private protected public readonly require return satisfies set static string super switch symbol this throw true try type typeof undefined unique unknown var void while with yield " +
    "test tests expect describe toBe toEqual toStrictEqual it each length push slice split join filter some every find includes value values name names path paths data result results error errors item items text body title file files list index count args option options input output state config "
  )
    .trim()
    .split(/\s+/),
);

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Every file's text at one revision, read in one `git cat-file --batch`. */
function contentsAt(base: string, paths: readonly string[]): Map<string, string> {
  const out = execFileSync("git", ["cat-file", "--batch"], {
    cwd: PHOENIX,
    input: paths.map((p) => `${base}:${p}`).join("\n") + "\n",
    maxBuffer: 1 << 30,
  });
  const texts = new Map<string, string>();
  let at = 0;
  for (const path of paths) {
    const eol = out.indexOf(10, at);
    const header = out.subarray(at, eol).toString("utf8").split(" ");
    const size = Number(header[2]);
    texts.set(path, header[1] === "blob" ? out.subarray(eol + 1, eol + 1 + size).toString("utf8") : "");
    at = header[1] === "blob" ? eol + 1 + size + 1 : eol + 1;
  }
  return texts;
}

/** Identifiers on the diff's added and removed lines, minus keywords and short words. */
function diffNames(diff: string): Set<string> {
  const names = new Set<string>();
  for (const line of diff.split("\n")) {
    if (!/^[+-]/.test(line) || /^(\+\+\+|---) /.test(line)) continue;
    for (const [word] of line.slice(1).matchAll(IDENT)) if (word.length >= 4 && !STOP.has(word)) names.add(word);
  }
  return names;
}

/**
 * Files changed in the same commit as a shown file, over the last
 * COCHANGE_COMMITS commits before the PR that touch one. Commits touching more
 * than COCHANGE_MAX_FILES files (sweeps, renames, formatting) are skipped:
 * they tie everything to everything.
 */
function cochanged(t: Trial, maxFiles: number): Set<string> {
  // A shown file new in this PR has no history, so it adds nothing here.
  const log = git("log", "-n", String(COCHANGE_COMMITS), "--full-diff", "--name-only", "--format=tformat:@@", t.base, "--", ...t.shown);
  const commits = log.split(/^@@$/m).map((c) => c.split("\n").filter((p) => p !== ""));
  return new Set(commits.filter((c) => c.length <= maxFiles).flat());
}

type Filter = (path: string) => boolean;

function filtersOf(t: Trial, texts: Map<string, string>, after: Map<string, string>): Record<string, Filter> {
  // A dotfile has an empty stem; "(?:)" would match every file, so a never-matching stand-in.
  const stems = [...new Set(t.shown.map(stem).filter((s) => s !== ""))];
  if (stems.length === 0) stems.push("\u0000");
  // paths and uses are the shipped rule (`src/imports.ts`), so what was measured is what runs.
  // paths: the file names a changed file the way an import does: after / ' " or `, before . ' " or `.
  const imports = importsOneOf(t.shown);
  // stems: the changed file's stem anywhere, as a whole word (letters, digits, _ and - count as word).
  const words = new RegExp(`(?<![\\w-])(?:${stems.map(escape).join("|")})(?![\\w-])`);
  const tokens = new Map(t.candidates.map((p) => [p, new Set((texts.get(p) ?? "").match(IDENT) ?? [])]));
  const names = [...diffNames(t.state.diff)];
  // How many candidates hold each diff name: a name in most files matches everything.
  const share = new Map(names.map((n) => [n, t.candidates.filter((p) => tokens.get(p)?.has(n)).length / t.candidates.length]));
  const rare = (cap: number) => new Set(names.filter((n) => (share.get(n) ?? 0) <= cap));
  const names1 = rare(0.01);
  const names2 = rare(0.02);
  const names5 = rare(0.05);
  const names20 = rare(0.2);
  const has = (set: ReadonlySet<string>) => (p: string) => [...set].some((n) => tokens.get(p)?.has(n));
  const folders = new Set(t.shown.map(dirname));
  const twins = new Set(t.shown.map((p) => `${dirname(p)}/${stem(p)}`));
  // What the changed files name, as they stand after the PR: the other direction of `paths`.
  const used = importedBy(t.shown.map((p) => after.get(p) ?? ""));
  const co = cochanged(t, COCHANGE_MAX_FILES);
  const coAll = cochanged(t, Number.POSITIVE_INFINITY);

  const f: Record<string, Filter> = {
    paths: (p) => imports(texts.get(p) ?? ""),
    uses: used,
    stems: (p) => words.test(texts.get(p) ?? ""),
    "names@1%": has(names1),
    "names@2%": has(names2),
    "names@5%": has(names5),
    "names@20%": has(names20),
    folder: (p) => folders.has(dirname(p)),
    twin: (p) => twins.has(`${dirname(p)}/${stem(p)}`),
    cochange: (p) => co.has(p),
    "cochange-uncapped": (p) => coAll.has(p),
  };
  f["both@5%"] = (p) => f.paths!(p) || f["names@5%"]!(p);
  f["both@20%"] = (p) => f.paths!(p) || f["names@20%"]!(p);
  f["both@2%"] = (p) => f.paths!(p) || f["names@2%"]!(p);
  f["paths+uses"] = (p) => f.paths!(p) || f.uses!(p);
  f["paths+uses+names@1%"] = (p) => f["paths+uses"]!(p) || f["names@1%"]!(p);
  f["paths+uses+folder"] = (p) => f["paths+uses"]!(p) || f.folder!(p);
  f["paths+folder"] = (p) => f.paths!(p) || f.folder!(p);
  f["paths+cochange"] = (p) => f.paths!(p) || f.cochange!(p);
  f["paths+folder+cochange"] = (p) => f["paths+folder"]!(p) || f.cochange!(p);
  f.none = () => true;
  return f;
}

interface Row {
  readonly pr: number;
  readonly issue: number;
  readonly hidden: string;
  readonly candidates: number;
  /** Jev ranked the hidden file 1st in experiment 36 (null on a control). */
  readonly jevFirst: boolean | null;
  /**
   * Per filter. Jev scores each file alone, so its saved scores hold on any
   * kept list: `caught` is the hidden file kept and at 0.5 or more, `wrongFlags`
   * the other kept files at 0.5 or more.
   */
  readonly kept: Record<string, { readonly hiddenKept: boolean; readonly size: number; readonly caught: boolean; readonly wrongFlags: number }>;
}

type Probe = { trials: { pr: number; hidden: string }[]; answers: { index: number; path: string; yes: number }[] };
const load = async (name: string) => JSON.parse(await readFile(join(import.meta.dirname, "results", name), "utf8")) as Probe;
const probes = { hidden: await load("missing-probe-package.json"), control: await load("missing-probe-package-control.json") };
/** Experiment 36's Jev score for every candidate of one trial, read back, not asked again. */
const jevScores = (pr: number, hidden: string, control: boolean) => {
  const probe = control ? probes.control : probes.hidden;
  const index = probe.trials.findIndex((t) => t.pr === pr && t.hidden === hidden);
  return new Map(probe.answers.filter((a) => a.index === index).map((a) => [a.path, a.yes]));
};
const FLAG = 0.5;

function run(control: boolean): Row[] {
  const rows: Row[] = [];
  const texts = new Map<string, Map<string, string>>();
  for (const pr of PRS) {
    for (const t of trials(pr, "package", control)) {
      if (!texts.has(t.base)) texts.set(t.base, new Map());
      const cache = texts.get(t.base) as Map<string, string>;
      const missing = t.candidates.filter((p) => !cache.has(p));
      for (const [p, text] of contentsAt(t.base, missing)) cache.set(p, text);
      // The merge commit: the shown files as the PR left them (a deleted one reads as "").
      const after = contentsAt(t.base.slice(0, -1), t.shown);
      const filters = filtersOf(t, cache, after);
      const scores = jevScores(t.pr, t.hidden, control);
      // The rebuilt trial must be the one Jev saw: same candidates, every one scored.
      if (scores.size !== t.candidates.length || !t.candidates.every((p) => scores.has(p)))
        throw new Error(`#${t.issue} ${t.hidden}: candidates differ from experiment 36`);
      const yes = (p: string) => scores.get(p) ?? 0;
      const kept: Row["kept"] = {};
      for (const [name, keep] of Object.entries(filters)) {
        const list = t.candidates.filter(keep);
        const hiddenKept = list.includes(t.hidden);
        kept[name] = {
          hiddenKept,
          size: list.length,
          caught: hiddenKept && yes(t.hidden) >= FLAG,
          wrongFlags: list.filter((p) => p !== t.hidden && yes(p) >= FLAG).length,
        };
      }
      const jevFirst = control ? null : t.candidates.every((p) => p === t.hidden || yes(p) < yes(t.hidden));
      rows.push({ pr: t.pr, issue: t.issue, hidden: t.hidden, candidates: t.candidates.length, jevFirst, kept });
    }
  }
  return rows;
}

const dollars = (calls: number) => (calls * TOKENS_PER_CALL * DOLLARS_PER_MILLION) / 1_000_000;
const median = (xs: readonly number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 === 1 ? (s[(s.length - 1) / 2] as number) : ((s[s.length / 2 - 1] as number) + (s[s.length / 2] as number)) / 2;
};

const hiddenRows = run(false);
const controlRows = run(true);
const names = Object.keys(hiddenRows[0]?.kept ?? {});
const summary = names.map((name) => {
  const sizes = hiddenRows.map((r) => r.kept[name]!.size);
  const controlSizes = controlRows.map((r) => r.kept[name]!.size);
  return {
    filter: name,
    hiddenKept: hiddenRows.filter((r) => r.kept[name]!.hiddenKept).length,
    trials: hiddenRows.length,
    jevWinsKept: hiddenRows.filter((r) => r.jevFirst && r.kept[name]!.hiddenKept).length,
    jevWins: hiddenRows.filter((r) => r.jevFirst).length,
    caught: hiddenRows.filter((r) => r.kept[name]!.caught).length,
    wrongFlags: hiddenRows.reduce((n, r) => n + r.kept[name]!.wrongFlags, 0),
    controlWrongFlags: controlRows.reduce((n, r) => n + r.kept[name]!.wrongFlags, 0),
    keptMedian: median(sizes),
    keptMax: Math.max(...sizes),
    dollarsMedian: Number(dollars(median(sizes)).toFixed(3)),
    dollarsMax: Number(dollars(Math.max(...sizes)).toFixed(3)),
    controlKeptMedian: median(controlSizes),
    controlKeptMax: Math.max(...controlSizes),
    missed: hiddenRows.filter((r) => !r.kept[name]!.hiddenKept).map((r) => `#${r.issue} ${basename(r.hidden)}`),
  };
});

console.log("filter | hidden kept | Jev wins kept | caught at 0.5 | wrong flags | kept median/max | $ median/max | control median/max");
for (const s of summary)
  console.log(
    `${s.filter} | ${s.hiddenKept}/${s.trials} | ${s.jevWinsKept}/${s.jevWins} | ${s.caught} | ${s.wrongFlags} (+${s.controlWrongFlags}) | ${s.keptMedian}/${s.keptMax} | ${s.dollarsMedian}/${s.dollarsMax} | ${s.controlKeptMedian}/${s.controlKeptMax}`,
  );
for (const s of summary) if (s.missed.length > 0) console.log(`${s.filter} missed: ${s.missed.join(", ")}`);
await writeFile(
  join(import.meta.dirname, "results", "name-filter.json"),
  JSON.stringify({ tokensPerCall: TOKENS_PER_CALL, dollarsPerMillion: DOLLARS_PER_MILLION, summary, trials: hiddenRows, controls: controlRows }, null, 2),
);
