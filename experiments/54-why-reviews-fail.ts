// Why do reviews fail? Experiment 53 read 882 lane logs and found that a
// failed review is the most common detour. The logs do not say why. The
// reviewer's verdict is on the pull request, so this reads them there.
//
// Run with
//   LANES=<a repo's .fabrika folder> CACHE=<a folder> node experiments/54-why-reviews-fail.ts
//
//   STEP=fetch    read every thread a verdict event points at, once, into CACHE
//                 (`gh api graphql`, read-only; nothing is written to GitHub)
//   STEP=compare  read the diff between two rounds, and the check runs at each
//                 commit a review failed on (`gh api`, read-only), once
//   STEP=sample   write the texts of the hand-labelled sample into CACHE, to read
//   STEP=jev      label the items not yet labelled (needs TYPESAFE_API_KEY)
//                 TRY=<n> labels only the first n of the sample; DRY=1 prints
//                 the cost and stops
//   (no STEP)     print the tables from CACHE and the saved labels: no key, no
//                 network. DETAIL=1 also prints the same-commit FAIL-then-PASS
//                 cases with their text, to read in a terminal. ORIGINS=1 also
//                 writes every later-round finding with its origin into CACHE,
//                 for experiment 57
//
// CACHE defaults to `runs/exp-54-cache`, holds raw API answers, and is never
// committed. `54-codebook.json` holds the codebook and the hand labels.
// `results/why-reviews-fail-labels.json` holds Jev's shares, and
// `results/why-reviews-fail.json` the counts and one row per failed review.
// None of the three holds comment text.
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { compileLane, parseLog, stageOf, walk } from "../src/lane-log.ts";
import { findingsIn, type Posted, postedIn, verdictsBetween } from "../src/verdict.ts";
import { type Checks, fetchChecks, fetchClosers, fetchCompare, fetchEdits, fetchThreads, readChecks, readClosers, readCompare, readEdits, readThread, type Thread } from "./lib/threads.ts";

const DATA = process.env.LANES;
const CACHE = process.env.CACHE ?? join(import.meta.dirname, "..", "runs", "exp-54-cache");
const REPO = process.env.REPO ?? "kamp-us/phoenix";
const STEP = process.env.STEP ?? "tables";
if (DATA === undefined || DATA === "") {
  console.error("LANES is not set: point it at a repo's .fabrika folder");
  process.exit(1);
}

// ---------------------------------------------------------------- small tools

const MIN = 60_000;
const pct = (n: number, of: number) => (of === 0 ? "" : `${((100 * n) / of).toFixed(1)}%`);
const share = (n: number, of: number) => `${n} (${pct(n, of)})`;
const sortedOf = (values: readonly number[]) => [...values].sort((a, b) => a - b);
const at = (sorted: readonly number[], q: number) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1))] as number;
function table(title: string, head: readonly string[], rows: readonly (readonly (string | number)[])[]): void {
  console.log(`\n${title}\n`);
  console.log(`| ${head.join(" | ")} |`);
  console.log(`|${head.map(() => "---").join("|")}|`);
  for (const row of rows) console.log(`| ${row.join(" | ")} |`);
}
const section = (title: string) => console.log(`\n\n## ${title}`);
const numberOf = (url: string | null): number | null => {
  const m = url === null ? null : /\/(?:pull|issues)\/(\d+)/.exec(url);
  return m === null ? null : Number(m[1]);
};

// ---------------------------------------------------------------- the verdict events in the lane logs

/** One `PASS` or `FAIL` a reviewer wrote into a lane's log. */
interface VerdictEvent {
  readonly lane: string;
  readonly kind: "single" | "epic";
  readonly task: string;
  readonly polarity: "PASS" | "FAIL";
  /** The state it was written in: `review`, `review:ui`, or `frozen`. */
  readonly from: string;
  /** 1 for the first verdict this task got in `review`, 2 for the second, and so on. */
  readonly round: number;
  readonly at: number;
  /** When the task's event before this one was written: the review started no earlier. */
  readonly since: number;
  /** The file classes standing over the task when the verdict landed. */
  readonly classes: readonly string[];
  /** Every pull request or issue the verdict's comments may be on. */
  readonly threads: readonly number[];
  /** The issue whose criteria the builder was given. */
  readonly issue: number | null;
}

const closers = readClosers(CACHE);
const events: VerdictEvent[] = [];
/** Lanes whose log names no pull request on any verdict line: the fetch step asks GitHub which one closed the issue. */
const unnamed = new Set<number>();
let lanesRead = 0;
for (const root of ["lanes", "lanes-archived"]) {
  const dir = join(DATA, root);
  if (!existsSync(dir)) continue;
  for (const name of readdirSync(dir).sort()) {
    const folder = join(dir, name);
    if (!existsSync(join(folder, "workflow.json")) || !existsSync(join(folder, "events.jsonl"))) continue;
    const compiled = compileLane(JSON.parse(readFileSync(join(folder, "workflow.json"), "utf8")));
    if (compiled === null) continue;
    lanesRead += 1;
    const kind = compiled.id === "coder" ? "single" : "epic";
    const walked = walk(compiled, parseLog(readFileSync(join(folder, "events.jsonl"), "utf8")).entries);
    for (const [task, steps] of Object.entries(walked.steps)) {
      const child = /^issue_(\d+)$/.exec(task);
      const issue = kind === "single" ? Number.parseInt(name, 10) : child === null ? null : Number(child[1]);
      let lastPull: number | null = null;
      let round = 0;
      let since = 0;
      for (const step of steps) {
        const e = step.entry;
        const pull = numberOf(e.pr);
        if (pull !== null) lastPull = pull;
        const verdict = (e.event === "PASS" || e.event === "FAIL") && (stageOf(step.from) === "review" || step.from === "frozen");
        if (verdict) {
          const named = typeof e.raw.comment === "string" ? e.raw.comment : null;
          const threads = new Set<number>();
          // An epic child's verdict is on the child's issue; a single lane's is on its pull request.
          for (const n of [pull, lastPull, numberOf(named), kind === "epic" ? issue : null]) if (n !== null) threads.add(n);
          if (threads.size === 0 && issue !== null) {
            unnamed.add(issue);
            for (const n of closers[String(issue)] ?? []) threads.add(n);
          }
          if (step.from === "review") round += 1;
          events.push({
            lane: name,
            kind,
            task,
            polarity: e.event as "PASS" | "FAIL",
            from: step.from,
            round: step.from === "review" ? round : 1,
            at: e.at,
            since,
            classes: step.after.classes,
            threads: [...threads],
            issue: issue === null || Number.isNaN(issue) ? null : issue,
          });
        }
        since = e.at;
      }
    }
  }
}

if (lanesRead === 0) {
  console.error(`no lane found under ${DATA}: it should hold a lanes folder`);
  process.exit(1);
}

if (STEP === "fetch") {
  const found = await fetchClosers(REPO, [...unnamed], CACHE);
  const numbers = new Set<number>();
  for (const e of events) {
    for (const n of e.threads) numbers.add(n);
    if (e.issue !== null) {
      numbers.add(e.issue);
      if (unnamed.has(e.issue)) for (const n of found[String(e.issue)] ?? []) numbers.add(n);
    }
  }
  const wanted = [...numbers].sort((a, b) => a - b);
  const queries = await fetchThreads(REPO, wanted, CACHE, 8);
  // GitHub keeps what an edited comment said before: ask for it where a verdict comment was edited.
  const edited = wanted.filter((n) => {
    const thread = readThread(CACHE, n);
    return thread !== null && thread !== "missing" && thread.comments.some((c) => c.editedAt !== null && postedIn({ id: c.id, url: c.url, at: 0, editedAt: null, body: c.body }, null).length > 0);
  });
  const more = await fetchEdits(REPO, edited, CACHE);
  console.log(`threads wanted ${numbers.size}; lanes that name no pull request ${unnamed.size}; threads with an edited verdict ${edited.length}; queries made ${queries + more}`);
  process.exit(0);
}

// ---------------------------------------------------------------- the verdicts on the threads

const threads = new Map<number, Thread | null>();
const threadOf = (n: number): Thread | null => {
  if (threads.has(n)) return threads.get(n) ?? null;
  const read = readThread(CACHE, n);
  const thread = read === null || read === "missing" ? null : read;
  threads.set(n, thread);
  return thread;
};
const postedCache = new Map<number, readonly Posted[]>();
/** Every verdict posted on a thread, each at the moment it was written. */
function postedOn(n: number): readonly Posted[] {
  const hit = postedCache.get(n);
  if (hit !== undefined) return hit;
  const edits = readEdits(CACHE, n);
  const out = (threadOf(n)?.comments ?? []).flatMap((c) =>
    postedIn(
      { id: c.id, url: c.url, at: Date.parse(c.at), editedAt: c.editedAt === null ? null : Date.parse(c.editedAt), body: c.body },
      edits?.[String(c.id)]?.map((v) => ({ at: Date.parse(v.at), body: v.body })) ?? null,
    ),
  );
  postedCache.set(n, out);
  return out;
}

/** The verdicts an event stands for, across the threads they may be on. */
function matchOf(e: VerdictEvent): readonly Posted[] {
  const seen = new Set<number>();
  return e.threads.flatMap((n) => verdictsBetween(postedOn(n), e.since, e.at)).filter((p) => !seen.has(p.commentId) && seen.add(p.commentId));
}

// ---------------------------------------------------------------- failed reviews

/** One failed review: a `FAIL` line and the verdicts the reviewer posted for it. */
interface FailedReview {
  /** `<lane>/<task>/<round>`: stable across runs, and holds no text. */
  readonly id: string;
  readonly event: VerdictEvent;
  /** The failing verdicts, one per namespace that failed. */
  readonly failed: readonly Posted[];
  /** The namespaces that passed in the same review. */
  readonly passed: readonly Posted[];
}
type Lost = "bookkeeping" | "no-thread" | "not-found";
const reviews: FailedReview[] = [];
const lost: { event: VerdictEvent; why: Lost }[] = [];
for (const e of events) {
  if (e.polarity !== "FAIL") continue;
  const matched = matchOf(e);
  const failed = matched.filter((p) => p.marker.polarity === "FAIL");
  if (failed.length > 0) {
    reviews.push({ id: `${e.lane}/${e.task}/${e.from === "review" ? "" : `${e.from}-`}${e.round}`, event: e, failed, passed: matched.filter((p) => p.marker.polarity === "PASS") });
    continue;
  }
  // A line written within three minutes of the one before it: no reviewer ran in between.
  lost.push({ event: e, why: e.at - e.since < 3 * MIN ? "bookkeeping" : e.threads.length === 0 ? "no-thread" : "not-found" });
}
const monthOf = (ms: number) => new Date(ms).toISOString().slice(0, 7);

/** A fixed shuffle, so the sample is the same on every run. */
function shuffled<T>(items: readonly T[], seed: number): T[] {
  const out = [...items];
  let state = seed;
  const next = () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [out[i], out[j]] = [out[j] as T, out[i] as T];
  }
  return out;
}

/**
 * The hand-labelled sample: up to 64 failed reviews, spread on purpose. Eight
 * buckets by week of the data, and from each bucket one review of each of
 * eight sorts where it has one: a third round or later, a second round, an
 * epic child, a failing skill, doc, governance and first-round code verdict,
 * and any first round. It comes to 59.
 */
function sampleOf(all: readonly FailedReview[]): FailedReview[] {
  const text = all.filter((r) => r.event.from !== "review:ui");
  const start = Math.min(...text.map((r) => r.event.at));
  const week = (r: FailedReview) => Math.min(7, Math.floor((r.event.at - start) / (7 * 24 * 60 * MIN)));
  const picked: FailedReview[] = [];
  for (let w = 0; w < 8; w++) {
    const pool = shuffled(text.filter((r) => week(r) === w), 54 + w);
    const want: ((r: FailedReview) => boolean)[] = [
      (r) => r.event.round >= 3,
      (r) => r.event.round === 2,
      (r) => r.event.kind === "epic",
      (r) => r.failed.some((p) => p.marker.namespace === "review-skill"),
      (r) => r.failed.some((p) => p.marker.namespace === "review-doc"),
      (r) => r.failed.some((p) => p.marker.namespace === "governance"),
      (r) => r.failed.some((p) => p.marker.namespace === "review-code") && r.event.round === 1,
      (r) => r.event.round === 1,
    ];
    for (const fits of want) {
      const hit = pool.find((r) => fits(r) && !picked.includes(r));
      if (hit !== undefined) picked.push(hit);
    }
  }
  return picked;
}

// ---------------------------------------------------------------- findings

/** One thing that gets a label: a failing verdict as a whole (`reason`), or one point of it (`finding`). */
interface Item {
  /** `<comment id>.<posted, in seconds>#<n>`, `#0` for the reason: no text in it. */
  readonly key: string;
  readonly level: "reason" | "finding";
  readonly review: FailedReview;
  readonly posted: Posted;
  readonly blocking: boolean;
  /** How the splitter found it. */
  readonly from: string;
  /** What a labeller reads, cut short. */
  readonly text: string;
  /** The same, whole. */
  readonly whole: string;
}
const TEXT_CUT = 700;
const squeeze = (text: string) => text.replace(/\s+/g, " ").trim();
/** The part of a verdict that says what is wrong, when it lists no findings: from its most telling paragraph on. */
function gistOf(body: string): string {
  const paragraphs = body.split(/\n\s*\n/).filter((p) => !/^\s*\|/.test(p) && !/^#{1,4}\s/.test(p.trim()) && !/^\s*```/.test(p));
  const telling = /\bFAIL\b|\bblock|\bstale\b|contradict|\bbans?\b|banned|collid|duplicate|\bmissing\b|\bwrong\b|\bfalse\b|\bred\b|\bstill\b|does not|no longer|not met|unmet/gi;
  const scored = paragraphs.map((p, i) => ({ i, score: (p.match(telling) ?? []).length / Math.max(1, p.length / 400) }));
  const best = [...scored].sort((a, b) => b.score - a.score)[0];
  return squeeze(paragraphs.slice(best === undefined || best.score === 0 ? 0 : best.i).join(" "));
}
function itemsOf(review: FailedReview): Item[] {
  return review.failed.flatMap((posted) => {
    const stem = `${posted.commentId}.${Math.floor(posted.at / 1000)}`;
    const found = findingsIn(posted.body).map((f, i): Item => {
      const whole = squeeze(f.text);
      return { key: `${stem}#${i + 1}`, level: "finding", review, posted, blocking: f.blocking, from: f.from, text: whole.slice(0, TEXT_CUT), whole };
    });
    // The verdict as a whole: its one-line reason, with its first blocking point (or its gist) as the detail.
    const detail = found.find((f) => f.blocking)?.whole ?? gistOf(posted.body);
    const reason: Item = { key: `${stem}#0`, level: "reason", review, posted, blocking: true, from: "reason", text: detail.slice(0, 500), whole: detail };
    return [reason, ...found];
  });
}
const items = reviews.flatMap(itemsOf);
const reasons = items.filter((i) => i.level === "reason");
const findings = items.filter((i) => i.level === "finding");
const sample = sampleOf(reviews);
const sampleIds = new Set(sample.map((r) => r.id));
const short = (url: string) => url.replace(`https://github.com/${REPO}/`, "");
const linkOf = (p: Posted) => `[${short(p.url).replace(/#issuecomment-\d+/, "").replace(/^(pull|issues)\//, "#")}](${p.url})`;

if (STEP === "sample") {
  const view = sample
    .map((r) => {
      const head = `# ${r.id}  ${new Date(r.event.at).toISOString().slice(0, 16)}  ${r.event.kind}  round ${r.event.round}  passed: ${r.passed.map((p) => p.marker.namespace.replace("review-", "")).join(" ") || "none"}`;
      const mine = itemsOf(r).filter((i) => i.level === "finding");
      return [
        head,
        ...r.failed.map((p) => {
          const lines = mine.filter((i) => i.posted === p).map((i) => `  ${i.key} ${i.blocking ? "BLOCK" : "soft "} (${i.from}) ${i.text.slice(0, Number(process.env.CUT ?? 300))}`);
          return `\n## ${p.marker.namespace} ${short(p.url)} (${p.body.length} chars)\nclause: ${p.marker.clause}\n${lines.join("\n")}`;
        }),
      ].join("\n");
    })
    .join("\n\n---\n\n");
  writeFileSync(join(CACHE, "sample-items.md"), view);
  const full = sample
    .map((r) => [`# ${r.id}`, ...r.failed.map((p) => `\n## ${p.url}\n${p.marker.namespace}: FAIL — ${p.marker.clause}\n\n${p.body}`)].join("\n"))
    .join("\n\n=================================================================\n\n");
  writeFileSync(join(CACHE, "sample-full.md"), full);
  console.log(`sample: ${sample.length} failed reviews, ${sample.reduce((n, r) => n + r.failed.length, 0)} failing verdicts; wrote sample-items.md and sample-full.md into the cache folder`);
  process.exit(0);
}

// ---------------------------------------------------------------- labels: by hand on the sample, by Jev on the rest

interface Codebook {
  readonly kind: { readonly instructions: string; readonly choices: Readonly<Record<string, string>> };
  readonly restsOn: { readonly instructions: string; readonly choices: Readonly<Record<string, string>> };
  readonly needed: { readonly instructions: string; readonly choices: Readonly<Record<string, string>> };
  readonly examples: Readonly<Record<string, readonly string[]>>;
  /** Hand labels, `kind` or `kind/restsOn`: a failing verdict by its comment id, a finding by `<comment id>#<n>`. */
  readonly reasons: Readonly<Record<string, string>>;
  readonly findings: Readonly<Record<string, string>>;
  /** Hand readings of each FAIL that a PASS followed at the same commit, by the PASS's comment id. */
  readonly flips: Readonly<Record<string, string>>;
}
const here = import.meta.dirname;
const codebook = JSON.parse(readFileSync(join(here, "54-codebook.json"), "utf8")) as Codebook;
const KINDS = Object.keys(codebook.kind.choices);
const FLOOR = 0.8;

/** Kinds that Jev mixes up sit in one family: where it is unsure of the kind, it is often sure of the family. */
const FAMILY: Readonly<Record<string, string>> = {
  stale_text: "text",
  wrong_text: "text",
  prose_craft: "text",
  code_bug: "code",
  test_gap: "code",
  check_red: "checks",
  decision_conflict: "rules",
  record_keeping: "rules",
  convention: "rules",
  criterion_unmet: "ticket",
  pr_text: "ticket",
  carried: "none",
  not_a_finding: "none",
};
const FAMILIES = ["text", "code", "checks", "rules", "ticket", "none"];
/**
 * The three headline answers. `code`: a Check could have caught it before a
 * reviewer ran. `brief`: the rule was written down, in the repo or on the
 * ticket, and the builder did not follow it. `reader`: it took reading.
 */
type Bucket = "code" | "brief" | "reader" | "none" | "unsure";
const bucketOfKind = (kind: string, restsOn: string): Bucket =>
  kind === "check_red" ? "code" : kind === "record_keeping" ? (restsOn === "check" ? "code" : "brief") : FAMILY[kind] === "rules" || FAMILY[kind] === "ticket" ? "brief" : FAMILY[kind] === "none" ? "none" : FAMILY[kind] === undefined ? "unsure" : "reader";

/** What Jev said of one item: the share it gave each choice. No text. */
interface JevLabel {
  readonly kind: Readonly<Record<string, number>>;
  readonly restsOn: Readonly<Record<string, number>>;
  /** The same item asked the headline question straight: code, brief, reader or none. */
  readonly needed?: Readonly<Record<string, number>>;
}
const labelsFile = join(here, "results", "why-reviews-fail-labels.json");
const jevLabels: Record<string, JevLabel> = existsSync(labelsFile) ? (JSON.parse(readFileSync(labelsFile, "utf8")) as { labels: Record<string, JevLabel> }).labels : {};
const topOf = (shares: Readonly<Record<string, number>>): [string, number] => Object.entries(shares).sort((a, b) => b[1] - a[1])[0] ?? ["unsure", 0];
const summed = (shares: Readonly<Record<string, number>>, group: (choice: string) => string) => {
  const out: Record<string, number> = {};
  for (const [choice, p] of Object.entries(shares)) out[group(choice)] = (out[group(choice)] ?? 0) + p;
  return out;
};

const commentOf = (key: string) => key.slice(0, key.indexOf("."));
const indexOf = (key: string) => key.slice(key.indexOf("#") + 1);
/** The hand label of an item, when the sample holds it. */
function handOf(item: Item): { kind: string; restsOn: string | null } | null {
  if (!sampleIds.has(item.review.id)) return null;
  const raw = item.level === "reason" ? codebook.reasons[commentOf(item.key)] : codebook.findings[`${commentOf(item.key)}#${indexOf(item.key)}`];
  if (raw === undefined) return null;
  const [kind, restsOn] = raw.split("/");
  return { kind: kind as string, restsOn: restsOn ?? null };
}
interface Label {
  /** A kind of the codebook, or `unsure`. */
  readonly kind: string;
  /** The kind's family, or `unsure`. Known more often than the kind. */
  readonly family: string;
  readonly restsOn: string;
  readonly bucket: Bucket;
  readonly by: "hand" | "jev" | "none";
}
/** What Jev's shares say, with the floor applied at each level. */
function jevOf(key: string): Omit<Label, "by"> | null {
  const jev = jevLabels[key];
  if (jev === undefined) return null;
  const [kind, kindP] = topOf(jev.kind);
  const [family, familyP] = topOf(summed(jev.kind, (k) => FAMILY[k] ?? "unsure"));
  const [restsOn, restsP] = topOf(jev.restsOn);
  const rests = restsP >= FLOOR ? restsOn : "unsure";
  return { kind: kindP >= FLOOR ? kind : "unsure", family: familyP >= FLOOR ? family : "unsure", restsOn: rests, bucket: bucketsOf(jev).both };
}
/**
 * Code, brief or reader, two ways: summed from the kinds, and asked straight.
 * `both` takes whichever is sure, and is `unsure` when the two are sure and
 * differ.
 */
function bucketsOf(jev: JevLabel): { byKind: Bucket; asked: Bucket; both: Bucket } {
  const [restsOn, restsP] = topOf(jev.restsOn);
  const [kindBucket, kindP] = topOf(summed(jev.kind, (k) => bucketOfKind(k, restsP >= FLOOR ? restsOn : "unsure")));
  const [askedBucket, askedP] = topOf(jev.needed ?? {});
  const byKind = kindP >= FLOOR ? (kindBucket as Bucket) : "unsure";
  const asked = askedP >= FLOOR ? (askedBucket as Bucket) : "unsure";
  const both = byKind === "unsure" ? asked : asked === "unsure" || asked === byKind ? byKind : "unsure";
  return { byKind, asked, both };
}
/** The label the tables use: the hand label where there is one, else Jev's at the floor and up. */
function labelOf(item: Item): Label {
  const hand = handOf(item);
  const jev = jevOf(item.key);
  if (hand !== null) {
    const restsOn = hand.restsOn ?? jev?.restsOn ?? "unsure";
    return { kind: hand.kind, family: FAMILY[hand.kind] ?? "unsure", restsOn, bucket: bucketOfKind(hand.kind, restsOn), by: "hand" };
  }
  if (jev === null) return { kind: "unlabelled", family: "unlabelled", restsOn: "unlabelled", bucket: "unsure", by: "none" };
  return { ...jev, by: "jev" };
}
/** The texts Jev reads for one item. */
const textsOf = (item: Item) => ({ reason: item.posted.marker.clause === "" ? "(none given)" : item.posted.marker.clause, finding: item.text });

if (STEP === "jev") {
  // An item is asked only the questions it has no answer to yet.
  const asks = (i: Item): ("kind" | "restsOn" | "needed")[] => (jevLabels[i.key] === undefined ? ["kind", "restsOn", "needed"] : jevLabels[i.key]?.needed === undefined ? ["needed"] : []);
  const wanted = items.filter((i) => i.blocking && asks(i).length > 0);
  const todo = process.env.TRY === undefined ? wanted : wanted.filter((i) => sampleIds.has(i.review.id)).slice(0, Number(process.env.TRY));
  const tokens = todo.reduce((n, i) => n + asks(i).reduce((m, q) => m + JSON.stringify(codebook[q]).length / 4, 0) + JSON.stringify(textsOf(i)).length / 4, 0);
  console.log(`items to label ${todo.length} of ${wanted.length} waiting; about ${Math.round(tokens / 1000)}k tokens, about $${((tokens * 0.042) / 1e6).toFixed(3)} at $0.042 a million`);
  if (process.env.DRY === "1" || todo.length === 0) process.exit(0);
  const { askAll, pool } = await import("./lib/jev.ts");
  const question = (q: "kind" | "restsOn" | "needed") => ({ type: "choice", instructions: codebook[q].instructions, criteria: codebook[q].choices });
  /** Shares to two places, the near-zero ones dropped. */
  const shares = (probabilities: Readonly<Record<string, number>>) => Object.fromEntries(Object.entries(probabilities).filter(([, p]) => p >= 0.02).map(([choice, p]) => [choice, +p.toFixed(2)]));
  let done = 0;
  const save = () =>
    writeFileSync(
      labelsFile,
      `${JSON.stringify({
        note: "The share Jev gave each choice for each item of experiment 54 (shares under 0.02 dropped). Keys are <comment id>.<posted, seconds>#<n>, #0 for a verdict's reason. No comment text.",
        floor: FLOOR,
        labels: Object.fromEntries(Object.entries(jevLabels).sort(([a], [b]) => a.localeCompare(b))),
      })}\n`.replace(/"(\d+\.\d+#\d+)":/g, '\n"$1":'),
    );
  await pool(todo, 8, async (item) => {
    const answers = (await askAll(Object.fromEntries(asks(item).map((q) => [q, question(q)])), textsOf(item))) as Record<string, { probabilities: Record<string, number> } | undefined>;
    const had = jevLabels[item.key];
    const read = (q: "kind" | "restsOn" | "needed") => {
      const answer = answers[q];
      if (answer === undefined) throw new Error(`Jev did not answer ${q} for ${item.key}`);
      return shares(answer.probabilities);
    };
    jevLabels[item.key] = had === undefined ? { kind: read("kind"), restsOn: read("restsOn"), needed: read("needed") } : { ...had, needed: read("needed") };
    if (++done % 200 === 0) {
      save();
      console.error(`labelled ${done} of ${todo.length}`);
    }
  });
  save();
  process.exit(0);
}

// ---------------------------------------------------------------- the repair between two rounds

/** The commit a failed review judged: a pull request's head, or an epic child's range tip. */
const headOf = (r: FailedReview): string | null => r.failed[0]?.marker.head ?? r.failed[0]?.marker.range?.tip ?? null;
/** The failed review of the same task just before this one. */
const before = new Map<FailedReview, FailedReview>();
{
  const last = new Map<string, FailedReview>();
  for (const r of [...reviews].sort((a, b) => a.event.at - b.event.at)) {
    if (r.event.from === "review:ui") continue;
    const task = `${r.event.lane}/${r.event.task}`;
    const earlier = last.get(task);
    if (earlier !== undefined) before.set(r, earlier);
    last.set(task, r);
  }
}
const full = (sha: string | null): sha is string => sha !== null && sha.length === 40;

if (STEP === "compare") {
  let asked = 0;
  for (const [r, earlier] of before) {
    const [a, b] = [headOf(earlier), headOf(r)];
    if (full(a) && full(b) && a !== b && (await fetchCompare(REPO, a, b, CACHE))) asked += 1;
  }
  // What CI said at each commit a pull request's review failed on.
  let checked = 0;
  for (const r of reviews) {
    const head = r.failed[0]?.marker.head ?? null;
    if (full(head) && (await fetchChecks(REPO, head, CACHE))) checked += 1;
  }
  console.log(`later-round failed reviews ${before.size}; compare requests made ${asked}; check-run requests made ${checked}`);
  process.exit(0);
}

// ---------------------------------------------------------------- tables

const results: Record<string, unknown> = {};
const labelled = new Map(items.map((i) => [i, labelOf(i)] as const));
const of = (i: Item) => labelled.get(i) as Label;
const textReviews = reviews.filter((r) => r.event.from !== "review:ui");
const uiReviews = reviews.filter((r) => r.event.from === "review:ui");
const reasonsOf = (r: FailedReview) => reasons.filter((i) => i.review === r);
const findingsOf = (r: FailedReview) => findings.filter((i) => i.review === r);
const tally = <T>(list: readonly T[], key: (x: T) => string | readonly string[]) => {
  const out = new Map<string, number>();
  for (const x of list) for (const k of [key(x)].flat()) out.set(k, (out.get(k) ?? 0) + 1);
  return out;
};
const month = (r: FailedReview) => monthOf(r.event.at);

// 0. The data.
{
  section("0. The data, and the match");
  const fails = events.filter((e) => e.polarity === "FAIL");
  const stage = (e: VerdictEvent) => (e.from === "review:ui" ? "rendered review" : e.from === "frozen" ? "frozen" : "text review");
  const rows = ["text review", "frozen", "rendered review"].map((s) => {
    const all = fails.filter((e) => stage(e) === s);
    const hit = reviews.filter((r) => stage(r.event) === s).length;
    const why = (w: Lost) => lost.filter((l) => stage(l.event) === s && l.why === w).length;
    return [s, all.length, share(hit, all.length), why("bookkeeping"), why("no-thread"), why("not-found")];
  });
  console.log(`lanes read ${lanesRead}; verdict lines ${events.length} (${fails.length} FAIL, ${events.length - fails.length} PASS); threads in the cache ${new Set(events.flatMap((e) => e.threads)).size}`);
  table("FAIL lines of the lane logs, matched to a failing verdict on the pull request or the child issue", ["Written in", "FAIL lines", "Matched", "No reviewer ran: written under 3 minutes after the line before", "No pull request or issue to look on", "No failing verdict in the window"], [
    ...rows,
    ["all", fails.length, share(reviews.length, fails.length), lost.filter((l) => l.why === "bookkeeping").length, lost.filter((l) => l.why === "no-thread").length, lost.filter((l) => l.why === "not-found").length],
  ]);
  const verdicts = textReviews.flatMap((r) => r.failed);
  console.log(`\nfailed text reviews ${textReviews.length} (single lanes ${textReviews.filter((r) => r.event.kind === "single").length}, epic ${textReviews.filter((r) => r.event.kind === "epic").length}); failing verdicts ${verdicts.length}; by month ${["2026-08", "2026-09", "2026-10"].map((m) => `${m} ${textReviews.filter((r) => month(r) === m).length}`).join(", ")}`);
  console.log(`failing verdicts by namespace: ${[...tally(verdicts, (p) => p.marker.namespace)].map(([k, v]) => `${k} ${v}`).join(", ")}`);
  console.log(`verdicts read from a comment's earlier text (a later verdict overwrote or retired them): ${verdicts.filter((p) => !threadOf(Number(/\/(\d+)#/.exec(p.url)?.[1]))?.comments.some((c) => c.id === p.commentId && c.body.includes(p.body.slice(0, 200)) && verdictsStanding(c.body, p))).length}`);
  const bookkeeping = [...tally(lost.filter((l) => l.why === "bookkeeping"), (l) => l.event.lane)].sort((a, b) => b[1] - a[1]);
  console.log(`lines written under 3 minutes after the line before, by lane: ${bookkeeping.slice(0, 4).map(([k, v]) => `${k} ${v}`).join(", ")}, and ${bookkeeping.length - 4} more lanes`);
  console.log(`lost lines, 'no failing verdict in the window':${lost.filter((l) => l.why === "not-found").map((l) => `${l.event.lane}/${l.event.task} r${l.event.round}`).join(", ")}`);
  results.data = {
    lanes: lanesRead,
    failLines: fails.length,
    matched: reviews.length,
    lost: Object.fromEntries(["bookkeeping", "no-thread", "not-found"].map((w) => [w, lost.filter((l) => l.why === w).length])),
    failedTextReviews: textReviews.length,
    failedRenderedReviews: uiReviews.length,
    failingVerdicts: verdicts.length,
    byNamespace: Object.fromEntries(tally(verdicts, (p) => p.marker.namespace)),
  };
}
/** Whether a comment's last text still stands for this verdict (its marker opens the comment). */
function verdictsStanding(body: string, p: Posted): boolean {
  return body.startsWith(`${p.marker.namespace}: ${p.marker.polarity}`);
}

// 1. Jev against the hand labels.
{
  section("1. Jev against the hand labels, on the sample");
  const both = items.filter((i) => i.blocking && handOf(i) !== null && jevOf(i.key) !== null);
  const rows: (string | number)[][] = [];
  const score = (name: string, level: (i: Item) => { hand: string; jev: string; top: string }) => {
    const sure = both.filter((i) => level(i).jev !== "unsure");
    const unsure = both.filter((i) => level(i).jev === "unsure");
    const same = (set: readonly Item[], pick: "jev" | "top") => set.filter((i) => level(i)[pick] === level(i).hand).length;
    rows.push([name, both.length, share(same(both, "top"), both.length), share(sure.length, both.length), share(same(sure, "jev"), sure.length), share(same(unsure, "top"), unsure.length)]);
    return { n: both.length, agree: same(both, "top"), sure: sure.length, sureAgree: same(sure, "jev"), unsureAgree: same(unsure, "top") };
  };
  const jevTop = (i: Item) => jevLabels[i.key] as JevLabel;
  const hand = (i: Item) => handOf(i) as { kind: string; restsOn: string | null };
  const handBucket = (i: Item) => bucketOfKind(hand(i).kind, hand(i).restsOn ?? "");
  const scored = {
    kind: score("kind (13 choices)", (i) => ({ hand: hand(i).kind, jev: jevOf(i.key)?.kind ?? "unsure", top: topOf(jevTop(i).kind)[0] })),
    family: score("family (6)", (i) => ({ hand: FAMILY[hand(i).kind] ?? "", jev: jevOf(i.key)?.family ?? "unsure", top: topOf(summed(jevTop(i).kind, (k) => FAMILY[k] ?? ""))[0] })),
    bucketByKind: score("code, brief or reader: summed from the kinds", (i) => ({ hand: handBucket(i), jev: bucketsOf(jevTop(i)).byKind, top: topOf(summed(jevTop(i).kind, (k) => bucketOfKind(k, jevOf(i.key)?.restsOn ?? "")))[0] })),
    bucketAsked: score("code, brief or reader: asked straight", (i) => ({ hand: handBucket(i), jev: bucketsOf(jevTop(i)).asked, top: topOf(jevTop(i).needed ?? {})[0] })),
    bucket: score("code, brief or reader: whichever is sure", (i) => ({ hand: handBucket(i), jev: bucketsOf(jevTop(i)).both, top: bucketsOf(jevTop(i)).both === "unsure" ? topOf(jevTop(i).needed ?? {})[0] : bucketsOf(jevTop(i)).both })),
  };
  const rested = both.filter((i) => hand(i).restsOn !== null);
  const restSure = rested.filter((i) => jevOf(i.key)?.restsOn !== "unsure");
  rows.push(["what it rests on (4)", rested.length, share(rested.filter((i) => topOf(jevTop(i).restsOn)[0] === hand(i).restsOn).length, rested.length), share(restSure.length, rested.length), share(restSure.filter((i) => jevOf(i.key)?.restsOn === hand(i).restsOn).length, restSure.length), ""]);
  table(`Agreement with the hand label, over ${both.length} items (reasons and findings)`, ["Question", "Items", "Jev's top choice agrees", `Jev at ${FLOOR} and up`, "Of those, agrees", `Under ${FLOOR}, top choice agrees`], rows);
  const misses = tally(both.filter((i) => jevOf(i.key)?.kind !== "unsure" && jevOf(i.key)?.kind !== hand(i).kind), (i) => `${hand(i).kind} read as ${jevOf(i.key)?.kind}`);
  console.log(`\nsure and wrong, by kind: ${[...misses].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join("; ")}`);
  const turned = tally(both.filter((i) => bucketsOf(jevTop(i)).both !== "unsure" && bucketsOf(jevTop(i)).both !== handBucket(i)), (i) => `${handBucket(i)} read as ${bucketsOf(jevTop(i)).both}`);
  console.log(`sure and wrong, code/brief/reader: ${[...turned].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join("; ")}`);
  const blur = tally(both.filter((i) => jevOf(i.key)?.kind === "unsure"), (i) => hand(i).kind);
  console.log(`unsure of the kind, by the hand label: ${[...blur].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(", ")}`);
  const rest = items.filter((i) => i.blocking && handOf(i) === null);
  const lv = (pick: (l: Label) => string) => rest.filter((i) => pick(of(i)) !== "unsure" && pick(of(i)) !== "unlabelled").length;
  console.log(`\noutside the sample: ${rest.length} items; Jev at the floor on the kind ${share(lv((l) => l.kind), rest.length)}, on the family ${share(lv((l) => l.family), rest.length)}, on code/brief/reader ${share(lv((l) => l.bucket), rest.length)}; not labelled ${rest.filter((i) => of(i).by === "none").length}`);
  results.agreement = { items: both.length, floor: FLOOR, ...scored, restsOn: { n: rested.length, sure: restSure.length, sureAgree: restSure.filter((i) => jevOf(i.key)?.restsOn === hand(i).restsOn).length } };

  // The splitter, against the same hand labels.
  const cut = findings.filter((i) => i.blocking && handOf(i) !== null);
  const noShape = sample.flatMap((r) => r.failed).filter((p) => findingsIn(p.body).length === 0).length;
  console.log(`\nthe splitter on the sample: ${cut.length} points cut as blocking, ${cut.filter((i) => hand(i).kind === "not_a_finding").length} of them not a finding by hand; ${noShape} of ${sample.flatMap((r) => r.failed).length} failing verdicts had no list to cut`);
  results.splitter = { cutAsBlocking: cut.length, notAFinding: cut.filter((i) => hand(i).kind === "not_a_finding").length, verdictsWithNoList: noShape, sampleVerdicts: sample.flatMap((r) => r.failed).length };
}

// 2. Why reviews fail.
const realKind = (l: Label) => l.family !== "none";
/** A row name for a label: its kind, or its family when only that is known. */
const rowOf = (l: Label) => (l.kind !== "unsure" ? l.kind : l.family !== "unsure" ? `${l.family}, kind unsure` : "unsure");
const ROWS = [...KINDS.filter((k) => FAMILY[k] !== "none"), ...FAMILIES.filter((f) => f !== "none" && f !== "checks").map((f) => `${f}, kind unsure`), "unsure", "carried", "not_a_finding"];
{
  section("2. Why reviews fail");
  const verdicts = reasons.filter((i) => i.review.event.from !== "review:ui");
  const points = findings.filter((i) => i.blocking && i.review.event.from !== "review:ui");
  const realPoints = points.filter((i) => realKind(of(i)));
  const perReview = tally(textReviews, (r) => [...new Set(reasonsOf(r).map((i) => rowOf(of(i))))]);
  const perVerdict = tally(verdicts, (i) => rowOf(of(i)));
  const perPoint = tally(points, (i) => rowOf(of(i)));
  const sampled = textReviews.filter((r) => sampleIds.has(r.id));
  const perSampled = tally(sampled, (r) => [...new Set(reasonsOf(r).map((i) => rowOf(of(i))))]);
  table(
    `Kinds of failure: ${textReviews.length} failed reviews, ${verdicts.length} failing verdicts, ${points.length} points cut as blocking (${realPoints.length} of them a finding). A review with two kinds counts in both rows`,
    ["Kind", "Failed reviews", "Failing verdicts", "Findings", `In the hand-labelled sample: of ${sampled.length} failed reviews`],
    ROWS.map((k) => [k, share(perReview.get(k) ?? 0, textReviews.length), share(perVerdict.get(k) ?? 0, verdicts.length), FAMILY[k] === "none" ? perPoint.get(k) ?? 0 : share(perPoint.get(k) ?? 0, realPoints.length), share(perSampled.get(k) ?? 0, sampled.length)]),
  );
  const fam = (set: readonly Item[]) => tally(set, (i) => of(i).family);
  const famReview = tally(textReviews, (r) => [...new Set(reasonsOf(r).map((i) => of(i).family))]);
  const famSampled = tally(sampled, (r) => [...new Set(reasonsOf(r).map((i) => of(i).family))]);
  table("The same by family", ["Family", "Failed reviews", "Failing verdicts", "Findings", "In the hand-labelled sample"], [...FAMILIES, "unsure"].map((f) => [f, share(famReview.get(f) ?? 0, textReviews.length), share(fam(verdicts).get(f) ?? 0, verdicts.length), f === "none" ? fam(points).get(f) ?? 0 : share(fam(points).get(f) ?? 0, realPoints.length), share(famSampled.get(f) ?? 0, sampled.length)]));
  const rest = tally(verdicts.filter((i) => realKind(of(i))), (i) => of(i).restsOn);
  console.log(`\nwhat a failing verdict rests on: ${[...rest].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${share(v, verdicts.filter((i) => realKind(of(i))).length)}`).join(", ")}`);
  console.log(`labels by hand ${verdicts.filter((i) => of(i).by === "hand").length} verdicts and ${points.filter((i) => of(i).by === "hand").length} points; by Jev ${verdicts.filter((i) => of(i).by === "jev").length} and ${points.filter((i) => of(i).by === "jev").length}`);
  // Counted without a model, as a cross-check.
  const said = (r: FailedReview, re: RegExp) => r.failed.some((p) => re.test(p.body) || re.test(p.marker.clause));
  const crude = {
    "says CI or a check is red at the head": /\bCI\b[^.\n]{0,40}\bred\b|\bred at (?:this |the )?(?:head|tip)|\breds? (?:at|on) |ci-required[^.\n]{0,30}fail|rollup \*{0,2}red|settle[sd] `?red/i,
    "appends a criterion to the ticket (wide: any mention of appending one)": /append(?:ed|s)? (?:as |one |a |this |two |three )?(?:new )?(?:criteri|row)|routed as criteri|criteri(?:on|a) \d+[^.\n]{0,20}appended|append-criterion/i,
    "appends a criterion to the ticket (narrow: 'appended as criterion N', 'routed as criterion N', 'new criterion N')": /(?:appended|routed) (?:this round )?as criteri(?:on|a) \d|new criterion \d|criteri(?:on|a) \d+(?:,? and \d+)? (?:was |were )?appended (?:this|to)/i,
    "names a duplicate or colliding record id": /collid|duplicate (?:ADR|decision-record|record) id|already (?:claimed|taken)/i,
    "a namespace fails with its own files clean": /slice is clean|read is clean|(?:doc|docs|code|skill)s? (?:is |are )?clean[;,]|fails only because|cannot PASS|owes? FAIL/i,
    "grades the deviations disclosure FAIL": /deviation-disclosure: FAIL/i,
  };
  table("Counted with a pattern, no model: failed reviews whose verdict text", ["Says", "Failed reviews", "In the hand-labelled sample"], Object.entries(crude).map(([name, re]) => [name, share(textReviews.filter((r) => said(r, re)).length, textReviews.length), share(sampled.filter((r) => said(r, re)).length, sampled.length)]));
  results.kinds = {
    failedReviews: textReviews.length,
    failingVerdicts: verdicts.length,
    pointsCutAsBlocking: points.length,
    findings: realPoints.length,
    perReview: Object.fromEntries(perReview),
    perVerdict: Object.fromEntries(perVerdict),
    perFinding: Object.fromEntries(perPoint),
    familyPerReview: Object.fromEntries(famReview),
    familyPerVerdict: Object.fromEntries(fam(verdicts)),
    familyPerFinding: Object.fromEntries(fam(points)),
    restsOnPerVerdict: Object.fromEntries(rest),
    byPattern: Object.fromEntries(Object.entries(crude).map(([name, re]) => [name, textReviews.filter((r) => said(r, re)).length])),
  };
}

// 3. By file class.
{
  section("3. By file class");
  const verdicts = reasons.filter((i) => i.review.event.from !== "review:ui");
  const spaces = ["review-code", "review-doc", "review-skill", "governance"];
  table(
    "Failing verdicts by the namespace that failed, and the family of its reason",
    ["Family", ...spaces],
    [...FAMILIES, "unsure"].map((f) => [f, ...spaces.map((ns) => {
      const mine = verdicts.filter((i) => i.posted.marker.namespace === ns);
      return share(mine.filter((i) => of(i).family === f).length, mine.length);
    })]),
  );
  console.log(`\nfailing verdicts per namespace: ${spaces.map((ns) => `${ns} ${verdicts.filter((i) => i.posted.marker.namespace === ns).length}`).join(", ")}`);
  const classes = ["code", "doc", "skill", "ui"];
  const classed = textReviews.filter((r) => r.event.classes.length > 0);
  table(
    `Failed reviews by the classes the lane's log names (${classed.length} of ${textReviews.length} say them; a lane with two classes counts in both)`,
    ["Family of a reason", ...classes],
    [...FAMILIES.filter((f) => f !== "none"), "unsure"].map((f) => [f, ...classes.map((c) => {
      const mine = classed.filter((r) => r.event.classes.includes(c));
      return share(mine.filter((r) => reasonsOf(r).some((i) => of(i).family === f)).length, mine.length);
    })]),
  );
  results.byNamespace = Object.fromEntries(spaces.map((ns) => [ns, Object.fromEntries(tally(verdicts.filter((i) => i.posted.marker.namespace === ns), (i) => of(i).family))]));
  results.byClass = Object.fromEntries(classes.map((c) => [c, { failedReviews: classed.filter((r) => r.event.classes.includes(c)).length, ...Object.fromEntries(tally(classed.filter((r) => r.event.classes.includes(c)), (r) => [...new Set(reasonsOf(r).map((i) => of(i).family))])) }]));
  if (uiReviews.length > 0) console.log(`\nfailed rendered reviews matched: ${uiReviews.length}: ${uiReviews.map((r) => r.failed.map((p) => `${linkOf(p)} "${p.marker.clause.slice(0, 90)}"`).join(" ")).join("; ")}`);
}

// 4. The three answers.
/** What one failed review needed: `reader` if any reason took reading, else `brief` if any was a written rule, else `code`. */
function reviewBucket(r: FailedReview): Bucket {
  const buckets = reasonsOf(r).map((i) => of(i).bucket).filter((b) => b !== "none");
  if (buckets.length === 0) return "none";
  if (buckets.includes("reader")) return "reader";
  if (buckets.includes("unsure")) return "unsure";
  return buckets.includes("brief") ? "brief" : "code";
}
{
  section("4. Code, brief, or reader");
  const order: Bucket[] = ["code", "brief", "reader", "unsure", "none"];
  const names: Record<Bucket, string> = {
    code: "Every reason is one a Check could have caught",
    brief: "No reason took reading; at least one was a rule written down",
    reader: "At least one reason took reading",
    unsure: "Not labelled surely enough to say",
    none: "No reason of its own found",
  };
  const mine = tally(textReviews, reviewBucket);
  const any = (b: Bucket) => textReviews.filter((r) => reasonsOf(r).some((i) => of(i).bucket === b)).length;
  const verdicts = reasons.filter((i) => i.review.event.from !== "review:ui" && realKind(of(i)));
  const points = findings.filter((i) => i.blocking && i.review.event.from !== "review:ui" && realKind(of(i)));
  table(
    `The ${textReviews.length} failed reviews, by what they needed`,
    ["", "Failed reviews, by the worst reason", "Failed reviews with at least one such reason", "Failing verdicts", "Findings"],
    order.filter((b) => b !== "none").map((b) => [names[b], share(mine.get(b) ?? 0, textReviews.length), b === "unsure" ? "" : share(any(b), textReviews.length), share(verdicts.filter((i) => of(i).bucket === b).length, verdicts.length), share(points.filter((i) => of(i).bucket === b).length, points.length)]),
  );
  const first = textReviews.filter((r) => r.event.round === 1);
  const firstMine = tally(first, reviewBucket);
  console.log(`\nfirst-round failed reviews only (${first.length}): ${order.filter((b) => b !== "none").map((b) => `${b} ${share(firstMine.get(b) ?? 0, first.length)}`).join(", ")}`);
  const sampled = textReviews.filter((r) => sampleIds.has(r.id));
  const sampleMine = tally(sampled, reviewBucket);
  console.log(`the hand-labelled sample alone (${sampled.length}): ${order.filter((b) => b !== "none").map((b) => `${b} ${share(sampleMine.get(b) ?? 0, sampled.length)}`).join(", ")}`);

  // What a Check would have to be, sized on the reasons.
  const codeReasons = reasons.filter((i) => i.review.event.from !== "review:ui" && of(i).bucket === "code");
  const red = codeReasons.filter((i) => of(i).kind === "check_red");
  const says = (i: Item, re: RegExp) => re.test(i.posted.body) || re.test(i.posted.marker.clause);
  const ci = red.filter((i) => says(i, /\bCI\b|ci-required|check runs?|\bjob\b|workflow|actions\/runs|review ci/i));
  const guard = red.filter((i) => says(i, /guard [\w-]+ check|portability-guard|fabrika guard/i));
  const conflict = red.filter((i) => says(i, /conflicts? with (?:main|the base)|merge conflict|not mergeable|CONFLICTING/i));
  const ids = codeReasons.filter((i) => of(i).kind === "record_keeping");
  console.log(`\nreasons a Check could have caught: ${codeReasons.length} failing verdicts in ${any("code")} failed reviews`);
  console.log(`  a red check: ${red.length} verdicts in ${new Set(red.map((i) => i.review.id)).size} reviews; the text names CI or a check run in ${ci.length}, a repo guard run by hand in ${guard.length}, a conflict with the base in ${conflict.length}`);
  console.log(`  a decision record's id or paperwork that a command reports: ${ids.length} verdicts in ${new Set(ids.map((i) => i.review.id)).size} reviews`);
  const ex = (set: readonly Item[], n = 4) => shuffled(set.filter((i) => of(i).by === "jev" || of(i).by === "hand"), 54).slice(0, n).map((i) => linkOf(i.posted)).join(" ");
  console.log(`  examples, red check: ${ex(red, 6)}`);
  console.log(`  examples, record id: ${ex(ids, 6)}`);
  for (const k of ["stale_text", "wrong_text", "code_bug", "decision_conflict", "criterion_unmet", "convention", "test_gap", "pr_text", "prose_craft"]) {
    const set = reasons.filter((i) => of(i).kind === k && i.review.event.from !== "review:ui");
    console.log(`  examples, ${k} (${set.length}): ${ex(set, 5)}`);
  }
  const briefReasons = reasons.filter((i) => i.review.event.from !== "review:ui" && of(i).bucket === "brief");
  console.log(`\nbrief: ${briefReasons.length} failing verdicts in ${any("brief")} reviews; they rest on ${[...tally(briefReasons, (i) => of(i).restsOn)].map(([k, v]) => `${k} ${v}`).join(", ")}; kinds ${[...tally(briefReasons, (i) => rowOf(of(i)))].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(", ")}`);
  results.buckets = {
    perReviewWorst: Object.fromEntries(mine),
    perReviewAny: Object.fromEntries(order.map((b) => [b, any(b)])),
    firstRoundWorst: Object.fromEntries(firstMine),
    sampleWorst: Object.fromEntries(sampleMine),
    perVerdict: Object.fromEntries(tally(verdicts, (i) => of(i).bucket)),
    perFinding: Object.fromEntries(tally(points, (i) => of(i).bucket)),
    redCheck: { verdicts: red.length, reviews: new Set(red.map((i) => i.review.id)).size, namesCi: ci.length, namesAGuard: guard.length, namesAConflict: conflict.length },
    recordId: { verdicts: ids.length, reviews: new Set(ids.map((i) => i.review.id)).size },
  };
}

// 5. Later rounds.
{
  section("5. Round 2 and later");
  const round = (r: FailedReview) => (r.event.round >= 4 ? "4 and later" : String(r.event.round));
  const rounds = ["1", "2", "3", "4 and later"];
  const order: Bucket[] = ["code", "brief", "reader", "unsure"];
  table("Failed reviews by round, and what they needed", ["Round", "Failed reviews", ...order], rounds.map((n) => {
    const mine = textReviews.filter((r) => round(r) === n);
    return [n, mine.length, ...order.map((b) => share(mine.filter((r) => reviewBucket(r) === b).length, mine.length))];
  }));
  table("Failed reviews by round, by the family of a reason (a review with two counts in both)", ["Round", ...FAMILIES.filter((f) => f !== "none")], rounds.map((n) => {
    const mine = textReviews.filter((r) => round(r) === n);
    return [n, ...FAMILIES.filter((f) => f !== "none").map((f) => share(mine.filter((r) => reasonsOf(r).some((i) => of(i).family === f)).length, mine.length))];
  }));

  // Where a later round's finding came from, by the text it quotes.
  const norm = (text: string) => text.replace(/[*_>]/g, "").replace(/\s+/g, " ").trim();
  /** The code or text a finding quotes: backticked spans and quoted sentences, paths and bare names left out. */
  const quotesOf = (text: string) => {
    const out = new Set<string>();
    for (const m of text.matchAll(/`([^`\n]{15,240})`/g)) {
      const quote = norm(m[1] as string);
      if (/\s/.test(quote) && quote.length >= 15) out.add(quote);
    }
    for (const m of text.matchAll(/"([^"\n]{25,240})"/g)) out.add(norm(m[1] as string));
    return [...out];
  };
  type Origin = "raised before" | "written by the repair" | "there before, not raised" | "nothing quoted" | "no diff to read";
  const origins: { item: Item; origin: Origin }[] = [];
  let sameCommit = 0;
  let noCompare = 0;
  for (const [r, earlier] of before) {
    const [a, b] = [headOf(earlier), headOf(r)];
    const compare = full(a) && full(b) && a !== b ? readCompare(CACHE, a, b) : null;
    if (a !== null && a === b) sameCommit += 1;
    else if (compare === null || compare.missing) noCompare += 1;
    const added = compare === null ? "" : norm(compare.files.flatMap((f) => f.added).join(" "));
    const said = norm([...earlier.failed, ...earlier.passed].map((p) => p.body).join(" "));
    for (const item of findingsOf(r).filter((i) => i.blocking && realKind(of(i)))) {
      const quotes = quotesOf(item.whole);
      const origin: Origin =
        quotes.length === 0
          ? "nothing quoted"
          : quotes.some((q) => said.includes(q))
            ? "raised before"
            : a === b
              ? "there before, not raised"
              : compare === null || compare.missing
                ? "no diff to read"
                : quotes.some((q) => added.includes(q))
                  ? "written by the repair"
                  : "there before, not raised";
      origins.push({ item, origin });
    }
  }
  // ORIGINS=1 writes every later-round finding with its origin and its text into CACHE, for experiment 57 to read
  // by hand. It holds comment text, so it stays in the cache folder and is never committed.
  if (process.env.ORIGINS === "1") {
    const verdictOf = (p: Posted) => ({ url: p.url, namespace: p.marker.namespace, polarity: p.marker.polarity, clause: p.marker.clause, body: p.body });
    const chainOf = (r: FailedReview): FailedReview[] => {
      const earlier = before.get(r);
      return earlier === undefined ? [] : [...chainOf(earlier), earlier];
    };
    writeFileSync(
      join(CACHE, "origins.json"),
      JSON.stringify(
        origins.map(({ item, origin }) => ({
          key: item.key,
          origin,
          review: item.review.id,
          round: item.review.event.round,
          on: item.review.event.kind,
          thread: Number(/\/(\d+)#/.exec(item.posted.url)?.[1] ?? 0),
          verdict: verdictOf(item.posted),
          text: item.whole,
          quotes: quotesOf(item.whole),
          head: headOf(item.review),
          // Every earlier failed review of the same task, oldest first, with all it posted.
          earlier: chainOf(item.review).map((e) => ({ review: e.id, round: e.event.round, head: headOf(e), verdicts: [...e.failed, ...e.passed].map(verdictOf) })),
        })),
      ),
    );
  }
  const names: Origin[] = ["raised before", "written by the repair", "there before, not raised", "nothing quoted", "no diff to read"];
  const placed = origins.filter((o) => o.origin !== "nothing quoted" && o.origin !== "no diff to read");
  table(
    `Findings of a later round, by where the text they quote comes from (${before.size} later-round failed reviews, ${origins.length} findings)`,
    ["The quoted text", "Findings", "Of those placed", "Failed reviews with one"],
    names.map((n) => {
      const mine = origins.filter((o) => o.origin === n);
      return [n, mine.length, placed.includes(mine[0] as { item: Item; origin: Origin }) ? pct(mine.length, placed.length) : "", new Set(mine.map((o) => o.item.review.id)).size];
    }),
  );
  console.log(`\nlater-round failed reviews judged at the same commit as the round before (the repair changed no file): ${sameCommit}; with no diff to read: ${noCompare}`);
  for (const n of names.slice(0, 3)) console.log(`  examples, ${n}: ${shuffled(origins.filter((o) => o.origin === n), 54).slice(0, 5).map((o) => linkOf(o.item.posted)).join(" ")}`);
  const kindsOf = (n: Origin) => [...tally(origins.filter((o) => o.origin === n), (o) => of(o.item).family)].sort((x, y) => y[1] - x[1]).map(([k, v]) => `${k} ${v}`).join(", ");
  console.log(`  families: raised before: ${kindsOf("raised before")}; written by the repair: ${kindsOf("written by the repair")}; there before: ${kindsOf("there before, not raised")}`);
  results.rounds = {
    failedReviewsByRound: Object.fromEntries(rounds.map((n) => [n, { n: textReviews.filter((r) => round(r) === n).length, ...Object.fromEntries(tally(textReviews.filter((r) => round(r) === n), reviewBucket)) }])),
    laterRoundReviews: before.size,
    sameCommit,
    noCompare,
    origins: Object.fromEntries(names.map((n) => [n, { findings: origins.filter((o) => o.origin === n).length, reviews: new Set(origins.filter((o) => o.origin === n).map((o) => o.item.review.id)).size }])),
  };
}

// 6. How long, how many, and what a pass carries.
{
  section("6. Size");
  const verdicts = textReviews.flatMap((r) => r.failed);
  const chars = sortedOf(verdicts.map((p) => p.body.length));
  const perReviewChars = sortedOf(textReviews.map((r) => r.failed.reduce((n, p) => n + p.body.length, 0)));
  const cutPer = sortedOf(reasons.filter((i) => i.review.event.from !== "review:ui").map((i) => findings.filter((f) => f.posted === i.posted && f.blocking && realKind(of(f))).length));
  const notesPer = reasons.filter((i) => i.review.event.from !== "review:ui").map((i) => findings.filter((f) => f.posted === i.posted && !f.blocking).length);
  const perReview = sortedOf(textReviews.map((r) => Math.max(1, findingsOf(r).filter((f) => f.blocking && realKind(of(f))).length)));
  const spaces = sortedOf(textReviews.map((r) => r.failed.length));
  console.log(`a failing verdict: ${at(chars, 0.5)} characters at the median, ${at(chars, 0.9)} at the 90th percentile, ${chars.at(-1)} at most`);
  console.log(`a failed review, all its failing verdicts: ${at(perReviewChars, 0.5)} characters at the median, ${at(perReviewChars, 0.9)} at the 90th percentile`);
  console.log(`failing verdicts a failed review: 1: ${share(spaces.filter((n) => n === 1).length, spaces.length)}, 2: ${share(spaces.filter((n) => n === 2).length, spaces.length)}, 3 or more: ${share(spaces.filter((n) => n >= 3).length, spaces.length)}`);
  console.log(`findings the splitter cut out of a failing verdict: none ${share(cutPer.filter((n) => n === 0).length, cutPer.length)}, one ${share(cutPer.filter((n) => n === 1).length, cutPer.length)}, two ${share(cutPer.filter((n) => n === 2).length, cutPer.length)}, three or more ${share(cutPer.filter((n) => n >= 3).length, cutPer.length)}`);
  console.log(`findings a failed review (at least its one reason): median ${at(perReview, 0.5)}, mean ${(perReview.reduce((a, b) => a + b, 0) / perReview.length).toFixed(2)}, 90th percentile ${at(perReview, 0.9)}, most ${perReview.at(-1)}`);
  console.log(`failing verdicts that also carry a note that does not block: ${share(notesPer.filter((n) => n > 0).length, notesPer.length)}`);

  const NOTE = /non[- ]?blocking|not[- ]blocking|not a blocker|does not block|not a finding|\bcraft note\b|\bnits?\b|filed separately|follow[- ]up|worth (?:noting|flagging)/i;
  const passes = events.filter((e) => e.polarity === "PASS" && e.from === "review").flatMap((e) => matchOf(e).filter((p) => p.marker.polarity === "PASS"));
  const passChars = sortedOf(passes.map((p) => p.body.length));
  const passNotes = passes.filter((p) => NOTE.test(p.body) || findingsIn(p.body).some((f) => !f.blocking));
  const appended = passes.filter((p) => /append(?:ed|s)? (?:as |one |a |this )?criteri|routed as criteri|filed (?:as )?#\d+|filed https/i.test(p.body));
  console.log(`\npassing verdicts matched to a PASS line: ${passes.length}; ${at(passChars, 0.5)} characters at the median, ${at(passChars, 0.9)} at the 90th percentile`);
  console.log(`passing verdicts that carry a note (a point marked as not blocking, a nit, a follow-up): ${share(passNotes.length, passes.length)}; that say they filed or routed something: ${share(appended.length, passes.length)}`);
  results.size = {
    failingVerdictChars: { median: at(chars, 0.5), p90: at(chars, 0.9), max: chars.at(-1) },
    failedReviewChars: { median: at(perReviewChars, 0.5), p90: at(perReviewChars, 0.9) },
    failingVerdictsPerReview: { one: spaces.filter((n) => n === 1).length, two: spaces.filter((n) => n === 2).length, more: spaces.filter((n) => n >= 3).length },
    findingsPerReview: { median: at(perReview, 0.5), mean: +(perReview.reduce((a, b) => a + b, 0) / perReview.length).toFixed(2), p90: at(perReview, 0.9), max: perReview.at(-1) },
    failingVerdictsWithANote: notesPer.filter((n) => n > 0).length,
    passingVerdicts: { n: passes.length, medianChars: at(passChars, 0.5), p90Chars: at(passChars, 0.9), withANote: passNotes.length, filedOrRouted: appended.length },
  };
}

// 7. A FAIL that was later taken back.
{
  section("7. FAILs later judged wrong");
  // A FAIL, then a PASS in the same namespace at the same commit: no file changed in between.
  const flips: { fail: Posted; pass: Posted }[] = [];
  for (const n of new Set(textReviews.flatMap((r) => r.event.threads))) {
    const posted = [...postedOn(n)].sort((a, b) => a.at - b.at);
    for (const fail of posted) {
      if (fail.marker.polarity !== "FAIL" || fail.marker.namespace === "review-ui") continue;
      const bound = fail.marker.head ?? fail.marker.range?.tip ?? null;
      if (bound === null) continue;
      const pass = posted.find((p) => p.at > fail.at && p.marker.namespace === fail.marker.namespace && (p.marker.head ?? p.marker.range?.tip ?? null) === bound);
      if (pass !== undefined && pass.marker.polarity === "PASS") flips.push({ fail, pass });
    }
  }
  // DETAIL=1 prints each one, to read by hand. It shows comment text, so it is for a terminal, never for a file in the repo.
  if (process.env.DETAIL === "1") for (const f of flips) console.log(`\n${f.pass.commentId} ${short(f.pass.url)}\n  FAIL: ${f.fail.marker.clause}\n  PASS: ${f.pass.marker.clause}\n  ${squeeze(f.pass.body).slice(0, 420)}`);
  const read = codebook.flips as Readonly<Record<string, string>>;
  const whyOf = (f: { pass: Posted }) => read[String(f.pass.commentId)] ?? "not read";
  const names: Record<string, string> = {
    text: "The pull request's text, the builder's record or the evidence was fixed. No file changed",
    flake: "A check was re-run and went green. Nothing in the change was wrong",
    ruling: "A person ruled, and the FAIL fell",
    took_back: "The reviewer withdrew it, or moved it to another namespace",
    other: "A repair commit inside the same range",
    "not read": "Not read by hand",
  };
  const whys = tally(flips, whyOf);
  const failsAll = textReviews.flatMap((r) => r.failed).length;
  table(
    `A failing verdict followed by a PASS in the same namespace at the same commit: ${flips.length}, against ${failsAll} failing verdicts matched. Each read by hand`,
    ["What happened", "Verdicts", "Examples"],
    [...whys].sort((a, b) => b[1] - a[1]).map(([w, n]) => [names[w] ?? w, n, flips.filter((f) => whyOf(f) === w).slice(0, 4).map((f) => linkOf(f.pass)).join(" ")]),
  );
  // A comment between a FAIL and the next verdict that says the red check is not the change's fault, or that the finding is wrong.
  const ARGUE = /\bdisput(?:e|es|ed|ing)\b|push(?:ing|ed)? back|false positive|finding is (?:wrong|mistaken|incorrect)|reviewer (?:is|was) (?:wrong|mistaken)|declin(?:e|ed|ing) (?:the|this|that) finding|not a (?:diff|code) defect|not (?:this|the) (?:diff|PR|pull request|change)'s (?:red|defect|failure|fault)/i;
  const argued: string[] = [];
  for (const r of textReviews) {
    const next = Math.min(...reviews.filter((x) => x.event.lane === r.event.lane && x.event.task === r.event.task && x.event.at > r.event.at).map((x) => x.event.at), r.event.at + 24 * 60 * MIN);
    const hit = r.event.threads.flatMap((n) => threadOf(n)?.comments ?? []).find((c) => !c.bot && Date.parse(c.at) > r.event.at && Date.parse(c.at) < next && postedIn({ id: c.id, url: c.url, at: 0, editedAt: null, body: c.body }, null).length === 0 && ARGUE.test(c.body));
    if (hit === undefined) continue;
    argued.push(`[${short(hit.url).replace(/#issuecomment-\d+/, "").replace(/^(pull|issues)\//, "#")}](${hit.url})`);
    if (process.env.DETAIL === "1") console.log(`ARGUE ${short(hit.url)}: ...${squeeze(hit.body).slice(Math.max(0, squeeze(hit.body).search(ARGUE) - 160), squeeze(hit.body).search(ARGUE) + 200)}`);
  }
  console.log(`\nfailed reviews followed, before the next verdict, by a comment whose words argue with the FAIL (a pattern, not a reading): ${share(argued.length, textReviews.length)}; ${argued.slice(0, 8).join(" ")}`);
  results.overturned = { sameCommitFlips: flips.length, readByHand: Object.fromEntries(whys), failedReviewsWithArguingWords: argued.length };
}

// 8. What CI said at the commit the review failed on.
{
  section("8. What CI said at the failed commit");
  // The floor checks that wait for the governance verdict are red while any review runs, and the roll-up only repeats
  // what a job under it said: neither is a finding of its own.
  const OWN = /governance verdict|governance-root diff|governance floor|^ci-required$/i;
  const RED = new Set(["failure", "timed_out", "cancelled", "action_required", "startup_failure"]);
  const pulls = textReviews.filter((r) => full(r.failed[0]?.marker.head ?? null));
  const seen = pulls.flatMap((r) => {
    const checks = readChecks(CACHE, r.failed[0]?.marker.head as string);
    return checks === null || checks.missing || checks.runs.length === 0 ? [] : [{ r, checks }];
  });
  const redOf = (runs: Checks["runs"]) => runs.filter((c) => c.conclusion !== null && RED.has(c.conclusion) && !OWN.test(c.name));
  const requiredRed = (runs: Checks["runs"]) => runs.some((c) => c.name === "ci-required" && c.conclusion !== null && RED.has(c.conclusion));
  const anyRed = seen.filter((s) => redOf(s.checks.runs).length > 0);
  const reqRed = seen.filter((s) => requiredRed(s.checks.runs));
  const hasRequired = seen.filter((s) => s.checks.runs.some((c) => c.name === "ci-required"));
  /** The red run that finished first, against the moment the review could start and the moment it reported. */
  const firstRed = (s: { r: FailedReview; checks: Checks }) => Math.min(...redOf(s.checks.runs).flatMap((c) => (c.completedAt === null ? [] : [Date.parse(c.completedAt)])));
  const knownEarly = anyRed.filter((s) => firstRed(s) <= s.r.event.since + MIN);
  const knownInTime = anyRed.filter((s) => firstRed(s) > s.r.event.since + MIN && firstRed(s) <= s.r.event.at);
  const afterVerdict = anyRed.filter((s) => firstRed(s) > s.r.event.at);
  console.log(`failed reviews bound to a pull request's commit ${pulls.length}; GitHub still holds check runs for ${seen.length}; of those, ${hasRequired.length} have a ci-required run`);
  table(
    "Check runs GitHub holds today for the commit each review failed on (the last attempt of each check)",
    ["At that commit", "Failed reviews", "Share"],
    [
      ["a check other than the review's own floor is red", anyRed.length, pct(anyRed.length, seen.length)],
      ["the required roll-up (ci-required) is red", reqRed.length, pct(reqRed.length, hasRequired.length)],
      ["the first red check finished before the review could start (within a minute of the build's DONE)", knownEarly.length, pct(knownEarly.length, seen.length)],
      ["it finished while the reviewer ran", knownInTime.length, pct(knownInTime.length, seen.length)],
      ["it finished after the FAIL was written (a later re-run, or a slow job)", afterVerdict.length, pct(afterVerdict.length, seen.length)],
    ],
  );
  const labelRed = (s: { r: FailedReview }) => reasonsOf(s.r).some((i) => of(i).kind === "check_red");
  const both = anyRed.filter(labelRed).length;
  console.log(`\nagainst the labels: of ${anyRed.length} failed reviews with a red check on record, ${both} have a reason labelled a red check; of ${seen.filter(labelRed).length} labelled a red check, ${both} have a red check on record today`);
  const needed = tally(anyRed, (s) => reviewBucket(s.r));
  console.log(`what the ${anyRed.length} needed, by the labels: ${[...needed].map(([k, v]) => `${k} ${v}`).join(", ")}`);
  const names = tally(anyRed.flatMap((s) => [...new Set(redOf(s.checks.runs).map((c) => c.name))]), (n) => n);
  console.log(`red checks by name: ${[...names].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([k, v]) => `${k} ${v}`).join("; ")}`);
  const unitRed = anyRed.filter((s) => redOf(s.checks.runs).some((c) => /unit tests|unit \+ client tests/i.test(c.name)));
  const lintRed = anyRed.filter((s) => redOf(s.checks.runs).some((c) => /lint|typecheck/i.test(c.name)));
  console.log(`failed reviews whose commit has a unit-test job red: ${share(unitRed.length, seen.length)}; a lint, format or typecheck job red: ${share(lintRed.length, seen.length)}`);
  const waited = sortedOf(knownInTime.map((s) => (s.r.event.at - firstRed(s)) / MIN));
  const spent = sortedOf(anyRed.map((s) => (s.r.event.at - s.r.event.since) / MIN));
  console.log(`a review that failed with a red check on record ran ${at(spent, 0.5).toFixed(1)} minutes from the build's DONE to its FAIL at the median; where the red arrived mid-review, the FAIL came ${waited.length === 0 ? "?" : at(waited, 0.5).toFixed(1)} minutes after it`);
  console.log(`examples, red before the review could start: ${knownEarly.slice(0, 6).map((s) => linkOf(s.r.failed[0] as Posted)).join(" ")}`);
  results.ci = {
    failedReviewsOnAPullCommit: pulls.length,
    withCheckRuns: seen.length,
    anyRed: anyRed.length,
    withRequiredRollup: hasRequired.length,
    requiredRed: reqRed.length,
    redBeforeTheReviewCouldStart: knownEarly.length,
    redWhileTheReviewerRan: knownInTime.length,
    redAfterTheFail: afterVerdict.length,
    redAndLabelledRed: both,
    labelledRed: seen.filter(labelRed).length,
    neededByLabel: Object.fromEntries(needed),
  };
}

// What is kept: counts above, and one row per failed review with its labels. No comment text.
results.reviews = textReviews.map((r) => ({
  id: r.id,
  thread: Number(/\/(\d+)#/.exec(r.failed[0]?.url ?? "")?.[1] ?? 0),
  on: /\/pull\//.test(r.failed[0]?.url ?? "") ? "pull" : "issue",
  month: month(r),
  round: r.event.round,
  needed: reviewBucket(r),
  inSample: sampleIds.has(r.id),
  verdicts: reasonsOf(r).map((i) => ({ comment: i.posted.commentId, namespace: i.posted.marker.namespace, kind: of(i).kind, family: of(i).family, restsOn: of(i).restsOn, by: of(i).by, findings: findings.filter((f) => f.posted === i.posted && f.blocking).map((f) => rowOf(of(f))) })),
}));
writeFileSync(join(here, "results", "why-reviews-fail.json"), `${JSON.stringify({ repo: REPO, codebook: { kind: codebook.kind.choices, restsOn: codebook.restsOn.choices, needed: codebook.needed.choices, examples: codebook.examples }, ...results })}\n`.replace(/\{"id":/g, '\n{"id":'));

