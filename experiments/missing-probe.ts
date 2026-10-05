// Can Jev spot a file a change should have touched and did not?
//
// Real merged phoenix PRs. For each, one file the PR changed is hidden: Jev
// sees the ticket and the PR's diff without that file, as if the builder had
// forgotten it. Then for every other file (as it stood before the PR) Jev is
// asked "should this file have changed too?". Code ranks the files by the yes.
// Each changed file that existed before the PR is hidden in turn, one trial each.
//
// What counts: does the hidden file rank near the top, and how many files that
// did not need to change score as high? A reviewer can read a short list; a
// long one is noise.
//
// SCOPE=package asks about every file in the package's `src` (up to 1,500 per
// trial); the default asks about the folders the PR touched. PRS picks PRs.
// CONTROL=1 hides nothing: the whole diff is shown, so every file that scores
// 0.5 or more is a false alarm on a change that was complete.
//
// Run with `node experiments/missing-probe.ts`; needs TYPESAFE_API_KEY, `gh`,
// and a phoenix checkout at PHOENIX (default ~/code/github.com/kamp-us/phoenix).
import { execFileSync } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { jevQuestions } from "@demlik/tea/jev";
import { askAll, pool } from "./jev.ts";

const PHOENIX = process.env.PHOENIX ?? join(homedir(), "code/github.com/kamp-us/phoenix");
const PRS = process.env.PRS?.split(",").map(Number) ?? [10519, 10239, 10169, 10096, 10189, 10435, 9618, 10260, 10022];
const SCOPE = process.env.SCOPE === "package" ? "package" : "folder";
const CONTROL = process.env.CONTROL === "1";
const BINARY = /\.(png|jpe?g|gif|webp|ico|woff2?|ttf|zip|gz|wasm)$/i;
const TICKET_CHARS = 8_000;
const DIFF_CHARS = 20_000;
const FILE_CHARS = 30_000;

const git = (...args: string[]) => execFileSync("git", args, { cwd: PHOENIX, encoding: "utf8", maxBuffer: 64 << 20 });
const gh = <T>(...args: string[]) => JSON.parse(execFileSync("gh", args, { cwd: PHOENIX, encoding: "utf8" })) as T;

const questions = jevQuestions({
  missed: {
    type: "noul",
    instructions:
      "`ticket` is the work. `diff` is the change made for it so far. `file` is a file the change did not touch, as it was before the change. Does finishing the ticket mean `file` has to change too?",
    criteria: {
      true: "The change is incomplete without editing this file: it calls, tests, documents or mirrors what the diff changed in a way the diff breaks or leaves out",
      false: "This file can stay as it is: it is unaffected by the change, or only on the same subject",
    },
  },
});

interface Trial {
  readonly pr: number;
  readonly issue: number;
  readonly title: string;
  readonly hidden: string;
  readonly candidates: readonly string[];
  readonly state: { readonly ticket: object; readonly diff: string };
  readonly base: string;
}

function trials(pr: number): Trial[] {
  const view = gh<{ body: string; mergeCommit: { oid: string }; files: { path: string }[] }>(
    "pr", "view", String(pr), "--json", "body,mergeCommit,files",
  );
  const issue = Number(/(?:closes|fixes) #(\d+)/i.exec(view.body)?.[1]);
  const ticket = gh<{ title: string; body: string }>("issue", "view", String(issue), "--json", "title,body");
  const head = view.mergeCommit.oid;
  const base = `${head}^`;
  const changed = view.files.map((f) => f.path);
  const code = changed.filter((p) => /^(packages|apps)\//.test(p));
  const folders =
    SCOPE === "package"
      ? [...new Set(code.map((p) => p.split("/").slice(0, 3).join("/")))]
      : [...new Set(code.map(dirname))];
  const list = SCOPE === "package" ? ["ls-tree", "-r", "--name-only"] : ["ls-tree", "--name-only"];
  const pool = folders.flatMap((folder) => git(...list, base, `${folder}/`).split("\n").filter((p) => p !== "" && !BINARY.test(p)));
  const existed = new Set(pool);
  // A file is hidden only if it existed before: a forgotten edit, not a forgotten new file.
  // The control hides "", which is no file: the diff is whole and every candidate is untouched.
  const hide = CONTROL ? [""] : code.filter((hidden) => existed.has(hidden));
  return hide
    .map((hidden) => {
      const shown = changed.filter((p) => p !== hidden);
      return {
        pr,
        issue,
        title: ticket.title,
        hidden,
        base,
        // Every file the change did not touch, the hidden one among them.
        candidates: pool.filter((p) => p === hidden || !changed.includes(p)),
        state: {
          ticket: { title: ticket.title, body: ticket.body.slice(0, TICKET_CHARS) },
          diff: git("diff", base, head, "--", ...shown).slice(0, DIFF_CHARS),
        },
      };
    });
}

const all = PRS.flatMap(trials);
const contents = new Map<string, string>();
const read = (base: string, path: string) => {
  const key = `${base}:${path}`;
  if (!contents.has(key)) contents.set(key, git("show", key).slice(0, FILE_CHARS));
  return contents.get(key) as string;
};
const jobs = all.flatMap((t, index) => t.candidates.map((path) => ({ index, path })));
console.log(`trials: ${all.length}, calls: ${jobs.length}`);
const started = Date.now();
const answers = await pool(jobs, 16, async ({ index, path }) => {
  const t = all[index] as Trial;
  const reply = (await askAll(questions, { ...t.state, file: { path, content: read(t.base, path) } })) as {
    missed: { noul: number };
  };
  return { index, path, yes: reply.missed.noul };
});

let top1 = 0;
let top5 = 0;
let top10 = 0;
const noise: number[] = [];
for (const [index, t] of all.entries()) {
  const ranked = answers.filter((a) => a.index === index).sort((a, b) => b.yes - a.yes);
  const rank = ranked.findIndex((a) => a.path === t.hidden) + 1;
  const hiddenYes = ranked[rank - 1]?.yes ?? 0;
  // Files that needed no change, scoring 0.5 or more: what a reviewer would read for nothing.
  const flagged = ranked.filter((a) => a.yes >= 0.5 && a.path !== t.hidden).length;
  noise.push(flagged);
  top1 += rank === 1 ? 1 : 0;
  top5 += rank <= 5 ? 1 : 0;
  top10 += rank <= 10 ? 1 : 0;
  console.log(
    `#${t.issue} hid ${t.hidden.split("/").slice(-1)[0]}: rank ${rank} of ${ranked.length} (${hiddenYes.toFixed(2)}), ${flagged} others at 0.5+  [${ranked
      .slice(0, 3)
      .map((a) => `${a.path.split("/").slice(-1)[0]} ${a.yes.toFixed(2)}`)
      .join(", ")}]`,
  );
}
const sorted = [...noise].sort((a, b) => a - b);
console.log(`hidden file ranked 1st: ${top1}/${all.length}, top 5: ${top5}/${all.length}, top 10: ${top10}/${all.length}`);
console.log(`other files at 0.5+ per trial: median ${sorted[Math.floor(sorted.length / 2)]}, max ${sorted.at(-1)}`);
console.log(`${jobs.length} calls in ${Math.round((Date.now() - started) / 1000)}s`);
await writeFile(
  join(import.meta.dirname, "results", `missing-probe${SCOPE === "package" ? "-package" : ""}${CONTROL ? "-control" : ""}.json`),
  JSON.stringify({ trials: all.map(({ state, candidates, ...t }) => ({ ...t, candidates: candidates.length })), answers }, null, 2),
);
