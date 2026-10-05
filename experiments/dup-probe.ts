// Can Jev tell, when an issue is filed, which open issue it repeats?
//
// Real phoenix issues that triage closed as a duplicate, each with the issue
// it named in the closing comment ("Closing as a duplicate of #N", "Duplicate
// of #N"). The candidates are every issue that was open when the duplicate was
// filed: what a check at filing time would face. Jev reads the new issue and
// one candidate and answers one `noul`: is the new one a repeat? Code ranks
// the candidates by the yes.
//
// Pairs whose original was already closed when the duplicate was filed are
// counted and left out: a check over open issues cannot find them.
//
// Controls are issues closed as done, never as a duplicate, asked the same way
// against the issues open when they were filed. Any candidate at the floor is
// a false alarm, as far as the record knows (a person may have missed a twin).
//
// PAIRS and CONTROLS pick how many (spread evenly over time). BUSY adds that many
// controls filed in a burst: the plain issue filed closest to each of BUSY
// duplicates (spread over time), so it sits in the same open pool as the
// duplicate's twins, where a false alarm is likeliest. TITLES=1 shows Jev the
// titles only, a cheaper variant. DRY=1 prints the call count and stops. Run
// with `node experiments/dup-probe.ts`; needs TYPESAFE_API_KEY and `gh` with
// read access to kamp-us/phoenix.
import { execFileSync } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { jevQuestions } from "@demlik/tea/jev";
import { askAll, pool } from "./jev.ts";

const REPO = "kamp-us/phoenix";
const PAIRS = Number(process.env.PAIRS ?? 30);
const CONTROLS = Number(process.env.CONTROLS ?? 10);
const BUSY = Number(process.env.BUSY ?? 0);
const TITLES = process.env.TITLES === "1";
const DRY = process.env.DRY === "1";
/** How much of an issue body Jev sees. Fabrika's issues run long; the problem is stated first. */
const BODY_CHARS = 3_000;

const gh = <T>(...args: string[]) =>
  JSON.parse(execFileSync("gh", args, { encoding: "utf8", maxBuffer: 512 << 20 })) as T;

const questions = jevQuestions({
  same: {
    type: "noul",
    instructions:
      "`new` is an issue just filed. `existing` is an issue that is already open. Is `new` a duplicate of `existing`: could `new` be closed, and `existing` worked, without losing anything `new` asks for?",
    criteria: {
      true: "The same problem or request: working `existing` also does what `new` asks, even if `existing` asks for more",
      false: "A different problem or request, even about the same file, feature or subject; or `new` asks for something `existing` does not cover",
    },
  },
});

interface Issue {
  readonly number: number;
  readonly title: string;
  readonly body: string;
  readonly createdAt: string;
  readonly closedAt: string | null;
  readonly stateReason: string | null;
}

// Every issue, once: the pools are built from when each was open.
const issues = gh<Issue[]>(
  "issue", "list", "--repo", REPO, "--state", "all", "--limit", "10000",
  "--json", "number,title,body,createdAt,closedAt,stateReason",
);
const byNumber = new Map(issues.map((i) => [i.number, i]));

// Closed issues whose comments say "duplicate of". GitHub's search stops at
// 1,000 results, so the oldest may be missed.
const searched: { number: number; comments: { nodes: { body: string }[] } }[] = [];
const query = `query($after:String){search(query:"repo:${REPO} is:issue is:closed \\"duplicate of\\" in:comments",type:ISSUE,first:50,after:$after){pageInfo{hasNextPage endCursor} nodes{... on Issue{number comments(first:30){nodes{body}}}}}}`;
for (let after: string | null = null; ; ) {
  const page = gh<{ data: { search: { pageInfo: { hasNextPage: boolean; endCursor: string }; nodes: typeof searched } } }>(
    "api", "graphql", "-f", `query=${query}`, ...(after ? ["-f", `after=${after}`] : []),
  ).data.search;
  searched.push(...page.nodes);
  if (!page.pageInfo.hasNextPage) break;
  after = page.pageInfo.endCursor;
}
const said =
  /(?:closing as (?:not planned: )?(?:a )?duplicate of|^duplicate of|closed as (?:a )?duplicate of)\s*(?:its parent,?\s*)?(?:https:\/\/github\.com\/kamp-us\/phoenix\/issues\/|#)(\d+)/im;
const pairs = searched.flatMap((n) => {
  const original = n.comments.nodes.map((c) => said.exec(c.body)?.[1]).find((m) => m !== undefined);
  return original === undefined ? [] : [{ dup: n.number, original: Number(original) }];
});

/** The issues open when `filed` was filed, itself left out. */
const openAt = (filed: Issue) =>
  issues.filter((i) => i.number !== filed.number && i.createdAt < filed.createdAt && (i.closedAt === null || i.closedAt > filed.createdAt));

const usable = pairs.filter((p) => {
  const dup = byNumber.get(p.dup);
  return dup !== undefined && openAt(dup).some((i) => i.number === p.original);
});
/** `n` items spread evenly over `items`. */
const spread = <T>(items: readonly T[], n: number) =>
  Array.from({ length: Math.min(n, items.length) }, (_, k) => items[Math.floor((k * items.length) / Math.min(n, items.length))] as T);

const searchedNumbers = new Set(searched.map((n) => n.number));
const first = Math.min(...usable.map((p) => p.dup));
const plain = issues
  .filter((i) => i.stateReason === "COMPLETED" && !searchedNumbers.has(i.number) && i.number >= first)
  .sort((a, b) => a.number - b.number);

interface Trial {
  readonly issue: number;
  readonly original: number | null;
  readonly candidates: readonly number[];
}
const trials: Trial[] = [
  ...spread([...usable].sort((a, b) => a.dup - b.dup), PAIRS).map((p) => ({
    issue: p.dup,
    original: p.original,
    candidates: openAt(byNumber.get(p.dup) as Issue).map((i) => i.number),
  })),
  ...controls().map((i) => ({ issue: i.number, original: null, candidates: openAt(i).map((c) => c.number) })),
];

/** CONTROLS plain issues spread over time, then BUSY filed closest to a duplicate. */
function controls(): Issue[] {
  const chosen = spread(plain, CONTROLS);
  const taken = new Set(chosen.map((i) => i.number));
  const time = (i: Issue) => Date.parse(i.createdAt);
  for (const p of spread([...usable].sort((a, b) => a.dup - b.dup), BUSY)) {
    const dup = byNumber.get(p.dup) as Issue;
    const near = plain
      .filter((i) => !taken.has(i.number))
      .reduce<Issue | null>((best, i) => (best === null || Math.abs(time(i) - time(dup)) < Math.abs(time(best) - time(dup)) ? i : best), null);
    if (near === null) continue;
    taken.add(near.number);
    chosen.push(near);
  }
  return chosen;
}
const controlCount = trials.filter((t) => t.original === null).length;

const shown = (n: number) => {
  const i = byNumber.get(n) as Issue;
  return TITLES ? { title: i.title } : { title: i.title, body: i.body.slice(0, BODY_CHARS) };
};
const jobs = trials.flatMap((t, index) => t.candidates.map((candidate) => ({ index, candidate })));
console.log(
  `duplicates found: ${pairs.length} (original open at filing: ${usable.length}); trials: ${trials.length - controlCount} pairs + ${controlCount} controls; calls: ${jobs.length}`,
);
if (DRY) process.exit(0);
const started = Date.now();
const answers = await pool(jobs, 16, async ({ index, candidate }) => {
  const t = trials[index] as Trial;
  const reply = (await askAll(questions, { new: shown(t.issue), existing: shown(candidate) })) as { same: { noul: number } };
  return { index, candidate, yes: reply.same.noul };
});

const rows = trials.map((t, index) => {
  const ranked = answers.filter((a) => a.index === index).sort((a, b) => b.yes - a.yes);
  const rank = t.original === null ? null : ranked.findIndex((a) => a.candidate === t.original) + 1;
  const others = ranked.filter((a) => a.candidate !== t.original);
  return {
    ...t,
    candidates: t.candidates.length,
    rank,
    originalYes: rank === null ? null : (ranked[rank - 1] as { yes: number }).yes,
    others5: others.filter((a) => a.yes >= 0.5).length,
    others9: others.filter((a) => a.yes >= 0.9).length,
    top: ranked.slice(0, 3).map((a) => ({ issue: a.candidate, yes: a.yes })),
  };
});
for (const r of rows) {
  const top = r.top.map((a) => `#${a.issue} ${a.yes.toFixed(2)}`).join(", ");
  console.log(
    r.original === null
      ? `control #${r.issue}: ${r.others5} at 0.5+, ${r.others9} at 0.9+ of ${r.candidates}  [${top}]`
      : `#${r.issue} -> #${r.original}: rank ${r.rank} of ${r.candidates} (${r.originalYes?.toFixed(2)}), others ${r.others5} at 0.5+, ${r.others9} at 0.9+  [${top}]`,
  );
}
const dups = rows.filter((r) => r.original !== null);
const plains = rows.filter((r) => r.original === null);
const count = (f: (r: (typeof rows)[number]) => boolean, of: typeof rows) => `${of.filter(f).length}/${of.length}`;
const sum = (of: typeof rows, k: "others5" | "others9") => of.reduce((n, r) => n + r[k], 0);
console.log(
  `original ranked 1st: ${count((r) => r.rank === 1, dups)}, top 5: ${count((r) => (r.rank ?? 99) <= 5, dups)}, top 10: ${count((r) => (r.rank ?? 99) <= 10, dups)}`,
);
/** Wrong issues at or above `floor` in one trial: anything but its original. */
const wrong = (r: (typeof rows)[number], floor: number) =>
  answers.filter((a) => a.index === rows.indexOf(r) && a.candidate !== r.original && a.yes >= floor).length;
for (const floor of [0.5, 0.6, 0.7, 0.8, 0.9]) {
  const inPairs = dups.reduce((n, r) => n + wrong(r, floor), 0);
  const inControls = plains.reduce((n, r) => n + wrong(r, floor), 0);
  console.log(
    `floor ${floor}: original at or above ${count((r) => (r.originalYes ?? 0) >= floor, dups)}; wrong issues at or above: ${inPairs} in pairs (${count((r) => wrong(r, floor) > 0, dups)} pairs), ${inControls} in controls (${count((r) => wrong(r, floor) > 0, plains)} controls)`,
  );
}
console.log(`others at 0.5+: ${sum(dups, "others5")} in pairs, ${sum(plains, "others5")} in controls; at 0.9+: ${sum(dups, "others9")}, ${sum(plains, "others9")}`);
const highest = plains.flatMap((r) => r.top.slice(0, 1).map((a) => ({ control: r.issue, ...a }))).sort((a, b) => b.yes - a.yes)[0];
if (highest) console.log(`highest control score: #${highest.control} vs #${highest.issue} at ${highest.yes.toFixed(2)}`);
console.log(`${jobs.length} calls in ${Math.round((Date.now() - started) / 1000)}s`);
await writeFile(
  join(import.meta.dirname, "results", `dup-probe${PAIRS === 0 ? "-controls" : ""}${TITLES ? "-titles" : ""}.json`),
  JSON.stringify({ found: pairs.length, usable: usable.length, rows, answers }, null, 2),
);
