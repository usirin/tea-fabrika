import { execFile } from "node:child_process";
import { access, mkdir, readdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { Effect } from "effect";
import { z } from "zod";
import type { Spend } from "./claude.ts";
import { drive } from "./drive.ts";
import { saveEnrichment } from "./enrichment.ts";
import type { Factory } from "./factory.ts";
import { realLayers, testingFor } from "./host.ts";
import { Issue } from "./issue.ts";
import { seedTicket } from "./local.ts";
import {
  type Filing,
  packageOf,
  pathsOutside,
  rawIssueOf,
  ReplayIndex,
  ReplayIssue,
  testsFileFor,
  toFilingPath,
} from "./replay.ts";
import { type RunCost, endOf, scoreTable, scoreTriage, type TriageOutcome } from "./score.ts";
import { defaultSettings, settingsFile } from "./settings.ts";
import { rulingOfAnswers } from "./sort.ts";
import { vetProblems } from "./vetting.ts";

// Replay triage on closed demlik issues (`replay/`) and score it against what
// shipped. For one issue: clone the repo as it was when the issue was filed,
// into a scratch folder outside this repo, holding no history past that
// commit; seed the ticket from the report as filed (no GitHub read); run
// triage only, as UNTIL=triage does; keep the run under runs/replay/<n>/;
// score it. Nothing is pushed, nothing is committed in the clone's source.
//
//   N=567                  the replay issue. Its run is kept in runs/replay/567: run the
//                          same command again and it carries on from where it stopped
//   TYPESAFE_API_KEY=...   Jev, for the sort
//   CONFIG=<file>          a fabrika.toml (vet_tries and the rest); otherwise today's defaults
//   MODEL=...              the model the enricher is asked for
//   SCORE=1                score every kept run again, offline, and print the table;
//                          with N, only that one. No Jev, no Claude, no clone
//
// The clone comes from a bare mirror of kamp-us/demlik kept in
// runs/replay/.cache/demlik.git, made on the first run with `git clone --bare`.

const root = resolve(import.meta.dirname, "..");
const replayDir = join(root, "replay");
const runsDir = join(root, "runs", "replay");
const mirror = join(runsDir, ".cache", "demlik.git");
const SOURCE = "https://github.com/kamp-us/demlik.git";

const run = promisify(execFile);
const git = async (dir: string, ...args: string[]) => (await run("git", args, { cwd: dir, maxBuffer: 64 << 20 })).stdout.trim();
const exists = (path: string) => access(path).then(() => true, () => false);

/** What one invocation of the runner spent. */
const Session = z.object({
  startedAt: z.string(),
  endedAt: z.string(),
  spends: z.array(
    z.object({
      session: z.string(),
      costUsd: z.number().nullable(),
      durationMs: z.number().nullable(),
      turns: z.number().nullable(),
      inputTokens: z.number().nullable(),
      outputTokens: z.number().nullable(),
      cacheReadTokens: z.number().nullable(),
      cacheWriteTokens: z.number().nullable(),
    }),
  ),
  jevCalls: z.number(),
});

/** What a replay run keeps beside its state, for scoring it again offline. */
const RunRecord = z.object({
  issue: z.number(),
  shaAtFiling: z.string(),
  package: z.string(),
  testsFile: z.string(),
  /** The PR's changed files that existed when the issue was filed, as the PR names them. */
  atFiling: z.array(z.string()),
  /** Tea was still at the repo's root when the issue was filed. Runs kept before this field read it off the mirror. */
  teaAtRoot: z.boolean().optional(),
  sessions: z.array(Session),
  /** Vetting's problem count for each draft it checked, across sessions. */
  vetted: z.array(z.number()),
  /** The sort triage acted on: Jev's answer under the floors. `null` when Jev never answered, or was too unsure of the type. */
  sort: z.object({ type: z.string(), priority: z.string(), value: z.string() }).nullable(),
  /** Jev's own choices and how sure it was, before the floors. */
  jev: z.record(z.string(), z.object({ choice: z.string(), confidence: z.number() })).nullable().default(null),
  end: z.string(),
  /** Paths the enricher's tools reached outside its clone. */
  outside: z.array(z.string()),
});
type RunRecord = z.infer<typeof RunRecord>;

/** A saved factory whose triage is done: the type and priority it settled on. */
const TriagedState = z.object({
  triage: z.object({ phase: z.literal("triaged"), type: z.string(), priority: z.string() }).transform(({ type, priority }) => ({ type, priority })),
});

const loadReplay = async (n: number) =>
  ReplayIssue.parse(JSON.parse(await readFile(join(replayDir, "issues", `${n}.json`), "utf8")));

const costOf = (record: RunRecord): RunCost => ({
  claudeUsd: record.sessions.flatMap((s) => s.spends).reduce((sum, s) => sum + (s.costUsd ?? 0), 0),
  jevCalls: record.sessions.reduce((sum, s) => sum + s.jevCalls, 0),
});

/** Score a kept run from its folder: the record, and our last rewrite if there is one. */
async function scoreKept(n: number) {
  const dir = join(runsDir, String(n));
  const record = RunRecord.parse(JSON.parse(await readFile(join(dir, "record.json"), "utf8")));
  const issueFile = join(dir, "ours-issue.json");
  const issue = (await exists(issueFile)) ? Issue.parse(JSON.parse(await readFile(issueFile, "utf8"))) : null;
  // A triaged run keeps its sort in its state: that is what triage acted on, so it wins over the record.
  const saved = TriagedState.safeParse(JSON.parse(await readFile(join(dir, "state.json"), "utf8").catch(() => "null")));
  const sort = saved.success ? { ...saved.data.triage, value: "keep" } : record.sort;
  const outcome: TriageOutcome = { issue, sort, vetted: record.vetted, end: record.end };
  const replay = await loadReplay(n);
  const filing =
    record.teaAtRoot === undefined
      ? await filingOf(mirror, record.shaAtFiling, replay)
      : { files: new Set(record.atFiling), teaAtRoot: record.teaAtRoot };
  const score = scoreTriage(replay, outcome, filing);
  await writeFile(join(dir, "score.json"), `${JSON.stringify(score, null, 2)}\n`);
  return { score, cost: costOf(record) };
}

/**
 * A clone of the repo at `sha`, in `dir`, holding no commit after it: cloned
 * over git's own transport from one branch the mirror points at `sha`, so
 * later objects are not copied. With its packages installed, a branch it
 * lands in that nobody has checked out, and no remote to push to.
 */
async function cloneAt(dir: string, sha: string, n: number): Promise<void> {
  if (!(await exists(mirror))) {
    await mkdir(join(mirror, ".."), { recursive: true });
    await run("git", ["clone", "-q", "--bare", SOURCE, mirror]);
  }
  await git(mirror, "cat-file", "-e", `${sha}^{commit}`).catch(() => git(mirror, "fetch", "-q", "origin", "+refs/heads/*:refs/heads/*"));
  const branch = `replay-${n}`;
  await git(mirror, "branch", "-f", branch, sha);
  await rm(dir, { recursive: true, force: true });
  await run("git", ["clone", "-q", "--no-local", "--single-branch", "--branch", branch, `file://${mirror}`, dir]);
  await git(dir, "remote", "remove", "origin");
  await git(dir, "branch", "replay-base");
  await run("pnpm", ["install", "--frozen-lockfile", "--prefer-offline"], { cwd: dir, maxBuffer: 64 << 20 });
}

/** Where tea was at `rev` in the repo in `dir`, and which of the PR's files were there, as the PR names them. */
async function filingOf(dir: string, rev: string, replay: ReplayIssue): Promise<Filing> {
  const tree = new Set((await git(dir, "ls-tree", "-r", "--name-only", rev)).split("\n"));
  const teaAtRoot = ![...tree].some((p) => p.startsWith("packages/"));
  const files = new Set(replay.filesChanged.map((f) => f.path).filter((p) => tree.has(toFilingPath(p, replay, teaAtRoot))));
  return { teaAtRoot, files };
}

/** The transcript of one Claude Code conversation, wherever Claude Code keeps it. */
async function transcriptOf(session: string): Promise<string | null> {
  const projects = join(homedir(), ".claude", "projects");
  for (const project of await readdir(projects).catch(() => [])) {
    const file = join(projects, project, `${session}.jsonl`);
    if (await exists(file)) return readFile(file, "utf8");
  }
  return null;
}

async function replayOne(n: number): Promise<void> {
  const replay = await loadReplay(n);
  const raw = rawIssueOf(replay);
  const index = ReplayIndex.parse(JSON.parse(await readFile(join(replayDir, "index.json"), "utf8")));
  const row = index.issues.find((r) => r.number === n);
  if (row === undefined) throw new Error(`#${n} is not in replay/index.json`);
  const key = process.env.TYPESAFE_API_KEY || undefined;
  if (key === undefined) throw new Error("TYPESAFE_API_KEY is needed: triage sorts with the real Jev");

  const runDir = join(runsDir, String(n));
  await mkdir(runDir, { recursive: true });
  const recordFile = join(runDir, "record.json");
  const kept = (await exists(recordFile)) ? RunRecord.parse(JSON.parse(await readFile(recordFile, "utf8"))) : null;

  // The clone's path is the same on every run of one issue, so a kept enricher conversation resumes there.
  const scratch = join(await realpath(tmpdir()), `tea-fabrika-replay-${n}`);
  console.log(`cloning: kamp-us/demlik at ${row.shaAtFiling} into ${scratch}`);
  await cloneAt(scratch, row.shaAtFiling, n);
  const { teaAtRoot, files } = await filingOf(scratch, "HEAD", replay);
  const pkg = packageOf(replay, teaAtRoot);
  const testsFile = testsFileFor(String(n), await exists(join(scratch, pkg, "test")));
  const atFiling = [...files];

  await seedTicket(join(runDir, "tracker"), raw);
  const fabrika = join(runDir, "fabrika-enriched.md");
  if (!(await exists(fabrika))) {
    const enriched = (JSON.parse(await readFile(join(replayDir, "issues", `${n}.json`), "utf8")) as { enriched: string }).enriched;
    await writeFile(fabrika, `${enriched}\n`);
  }

  const startedAt = new Date().toISOString();
  const spends: Spend[] = [];
  let jevCalls = 0;
  const vetted = [...(kept?.vetted ?? [])];
  let sort = kept?.sort ?? null;
  let jev = kept?.jev ?? null;
  const setup = { dir: scratch, package: pkg, base: "replay-base", testsFile };
  const { testing } = await testingFor(setup);
  const claude = {
    timeoutMs: 30 * 60 * 1000,
    ...(process.env.MODEL ? { model: process.env.MODEL } : {}),
    onSpend: (spend: Spend) => {
      spends.push(spend);
      console.log(`${"".padEnd(21)} claude: $${spend.costUsd?.toFixed(3) ?? "?"}, ${spend.turns ?? "?"} turns, ${Math.round((spend.durationMs ?? 0) / 1000)} s`);
    },
  };
  const settings = process.env.CONFIG === undefined ? defaultSettings : settingsFile(process.env.CONFIG);
  const layers = realLayers(setup, { testing, trackerDir: join(runDir, "tracker"), key, claude, settings });

  console.log(`kept in: ${runDir}`);
  console.log(`issue:   #${n} "${raw.title}", filed by ${raw.filedBy === "human" ? "a person" : "an agent"}`);
  console.log(`package: ${pkg}, the issue's tests in ${testsFile}\n`);
  let final: Factory | null = null;
  let rewrite: Issue | null = null;
  const runTriage = () =>
    Effect.runPromise(
      drive({
        issue: String(n),
        state: join(runDir, "state.json"),
        until: "triage",
        onStep: (msg, state) => {
          if (msg.type === "enrich_check_ok") vetted.push(vetProblems(msg.cmd.draft, msg.value).length);
          if (msg.type === "sort_run_ok" || msg.type === "sort_run_err") jevCalls += 1;
          if (msg.type === "sort_run_ok" && "knobs" in state.triage) {
            // The sort triage acts on, not Jev's bare choice: an unsure priority is p2, an unsure value is keep.
            const ruled = rulingOfAnswers(msg.value, state.triage.knobs.sortFloor);
            sort = ruled.kind === "sorted" ? { type: ruled.type, priority: ruled.priority, value: ruled.value } : null;
            jev = Object.fromEntries(
              Object.entries(msg.value.answers).map(([q, a]) => [q, { choice: String(a.choice), confidence: a.confidence }]),
            );
          }
        },
      }).pipe(Effect.scoped, Effect.provide(layers)),
    );
  try {
    const ended = await runTriage();
    final = ended.final;
    rewrite = ended.rewrite;
  } finally {
    const outside = [...(kept?.outside ?? [])];
    for (const s of new Set(spends.map((x) => x.session))) {
      const transcript = await transcriptOf(s);
      if (transcript !== null) outside.push(...pathsOutside(transcript, scratch));
    }
    const record: RunRecord = {
      issue: n,
      shaAtFiling: row.shaAtFiling,
      package: pkg,
      testsFile,
      atFiling,
      teaAtRoot,
      sessions: [...(kept?.sessions ?? []), { startedAt, endedAt: new Date().toISOString(), spends, jevCalls }],
      vetted,
      sort,
      jev,
      end: final === null ? (kept?.end ?? "failed") : endOf(final.triage),
      outside: [...new Set(outside)].sort(),
    };
    await writeFile(recordFile, `${JSON.stringify(record, null, 2)}\n`);
    if (rewrite !== null) {
      await writeFile(join(runDir, "ours-issue.json"), `${JSON.stringify(rewrite, null, 2)}\n`);
      await saveEnrichment(runDir, rewrite);
    }
    await rm(scratch, { recursive: true, force: true });
  }
  const scored = await scoreKept(n);
  console.log(`\n${scoreTable([scored])}`);
  if (scored.score.end !== "triaged") console.log(`\ntriage stopped at ${scored.score.end}`);
}

const n = process.env.N ? Number(process.env.N) : undefined;
if (process.env.SCORE) {
  const kept = n !== undefined ? [n] : (await readdir(runsDir)).filter((d) => /^\d+$/.test(d)).map(Number).sort((a, b) => a - b);
  const rows = [];
  for (const k of kept) if (await exists(join(runsDir, String(k), "record.json"))) rows.push(await scoreKept(k));
  console.log(scoreTable(rows));
} else {
  if (n === undefined) throw new Error("N is needed: the replay issue to run, such as N=567");
  await replayOne(n);
}
