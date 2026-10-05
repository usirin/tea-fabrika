// Can Jev scout a real codebase: given a ticket, which files does the fix touch?
//
// Real phoenix tickets, each closed by a merged PR. The PR's changed files are
// the answer. The candidates are every file in the folders the PR touched, as
// they stood before the PR (files the PR created are not candidates: a scout
// cannot find what does not exist yet). Jev reads each file whole, with the
// ticket, and says yes or no. Code ranks the files by Jev's yes.
//
// What counts: does the short list (the top 5 and top 10) hold the files the
// fix touched? A scout that misses a file sends the builder looking anyway;
// one that adds extra files only costs reading.
//
// SCOPE=package widens the candidates to every file in the package's `src`
// (270 to 1,600 files), which is what a real scout faces: on a new ticket
// nobody knows the folders yet. PRS=10239,10169 picks tickets.
//
// Run with `node experiments/scout-probe.ts`; needs TYPESAFE_API_KEY, `gh`,
// and a phoenix checkout at PHOENIX (default ~/code/github.com/kamp-us/phoenix).
import { execFileSync } from "node:child_process";
import { homedir } from "node:os";
import { writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { jevQuestions } from "@demlik/tea/jev";
import { askAll, pool } from "./jev.ts";

const PHOENIX = process.env.PHOENIX ?? join(homedir(), "code/github.com/kamp-us/phoenix");
/** Merged phoenix PRs that close one ticket and stay inside one or two folders. */
const PRS = process.env.PRS?.split(",").map(Number) ?? [10556, 10519, 10239, 10169, 10096, 10189, 10435, 9618, 10260, 10022];
const SCOPE = process.env.SCOPE === "package" ? "package" : "folder";
/** Files no scout reads: pictures, fonts, archives. */
const BINARY = /\.(png|jpe?g|gif|webp|ico|woff2?|ttf|zip|gz|wasm)$/i;
/** How much of a ticket or a file Jev sees. Longer is cut, and the cut is counted. */
const TICKET_CHARS = 8_000;
const FILE_CHARS = 30_000;

const git = (...args: string[]) => execFileSync("git", args, { cwd: PHOENIX, encoding: "utf8", maxBuffer: 64 << 20 });
const gh = <T>(...args: string[]) => JSON.parse(execFileSync("gh", args, { cwd: PHOENIX, encoding: "utf8" })) as T;

const questions = jevQuestions({
  touches: {
    type: "noul",
    instructions:
      "`ticket` is work someone will do in this codebase. `file` is one file of it, with its path. Will doing the work in `ticket` mean changing `file`?",
    criteria: {
      true: "The ticket's change lands in this file: its code, its tests, or its docs have to change for the ticket to be done",
      false: "This file can stay as it is: it is nearby or on the same subject, but the ticket's change does not land in it",
    },
  },
});

interface Case {
  readonly pr: number;
  readonly issue: number;
  readonly ticket: { readonly title: string; readonly body: string };
  readonly touched: readonly string[];
  readonly candidates: readonly string[];
  readonly base: string;
}

function gather(pr: number): Case {
  const view = gh<{ body: string; mergeCommit: { oid: string }; files: { path: string }[] }>(
    "pr", "view", String(pr), "--json", "body,mergeCommit,files",
  );
  const issue = Number(/(?:closes|fixes) #(\d+)/i.exec(view.body)?.[1]);
  const ticket = gh<{ title: string; body: string }>("issue", "view", String(issue), "--json", "title,body");
  const base = `${view.mergeCommit.oid}^`;
  const changed = view.files.map((f) => f.path).filter((p) => /^(packages|apps)\//.test(p));
  const folders =
    SCOPE === "package"
      ? [...new Set(changed.map((p) => p.split("/").slice(0, 3).join("/")))]
      : [...new Set(changed.map(dirname))];
  const list = SCOPE === "package" ? ["ls-tree", "-r", "--name-only"] : ["ls-tree", "--name-only"];
  const candidates = folders.flatMap((folder) =>
    git(...list, base, `${folder}/`).split("\n").filter((p) => p !== "" && !BINARY.test(p)),
  );
  const exists = new Set(candidates);
  return { pr, issue, ticket, base, candidates, touched: changed.filter((p) => exists.has(p)) };
}

const cases = PRS.map(gather).filter((c) => c.touched.length > 0);
const jobs = cases.flatMap((c) => c.candidates.map((path) => ({ c, path })));
let cut = 0;
const answers = await pool(jobs, 12, async ({ c, path }) => {
  const content = git("show", `${c.base}:${path}`);
  if (content.length > FILE_CHARS) cut++;
  const reply = (await askAll(questions, {
    ticket: { title: c.ticket.title, body: c.ticket.body.slice(0, TICKET_CHARS) },
    file: { path, content: content.slice(0, FILE_CHARS) },
  })) as { touches: { noul: number } };
  return { pr: c.pr, path, yes: reply.touches.noul, touched: c.touched.includes(path) };
});

console.log(`tickets: ${cases.length}, files judged: ${answers.length}, files cut to ${FILE_CHARS} chars: ${cut}`);
let found5 = 0;
let found10 = 0;
let found20 = 0;
let foundYes = 0;
let yesTotal = 0;
let touchedTotal = 0;
for (const c of cases) {
  const ranked = answers.filter((a) => a.pr === c.pr).sort((a, b) => b.yes - a.yes);
  const rankOf = (path: string) => ranked.findIndex((a) => a.path === path) + 1;
  const ranks = c.touched.map(rankOf);
  const yes = ranked.filter((a) => a.yes >= 0.5);
  found5 += ranks.filter((r) => r <= 5).length;
  found10 += ranks.filter((r) => r <= 10).length;
  found20 += ranks.filter((r) => r <= 20).length;
  foundYes += yes.filter((a) => a.touched).length;
  yesTotal += yes.length;
  touchedTotal += c.touched.length;
  console.log(
    `#${c.issue} (PR ${c.pr}): ${c.candidates.length} files, touched ${c.touched.length}, ranks ${ranks.join(",")}; ${yes.length} said yes  ${c.ticket.title}`,
  );
  for (const a of ranked.slice(0, 5)) console.log(`    ${a.touched ? "*" : " "} ${a.yes.toFixed(2)} ${a.path}`);
}
console.log(`touched files in the top 5: ${found5}/${touchedTotal}`);
console.log(`touched files in the top 10: ${found10}/${touchedTotal}`);
console.log(`touched files in the top 20: ${found20}/${touchedTotal}`);
console.log(`a yes (0.5 or more): ${yesTotal} files, ${foundYes} of them touched; touched files with a yes: ${foundYes}/${touchedTotal}`);
console.log(`a yes from 0.9: ${answers.filter((a) => a.yes >= 0.9).length} files`);
await writeFile(
  join(import.meta.dirname, "results", `scout-probe${SCOPE === "package" ? "-package" : ""}.json`),
  JSON.stringify({ cases, answers }, null, 2),
);
