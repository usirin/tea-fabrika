// The trials of the missing-file probe (experiment 36), shared so a later
// check can rebuild exactly what Jev was shown without asking Jev anything.
//
// One trial per changed file that existed before the PR: that file is hidden,
// the diff is the PR without it, and the candidates are every other untouched
// text file in scope. Needs `gh` and a phoenix checkout at PHOENIX
// (default ~/code/github.com/kamp-us/phoenix).
import { execFileSync } from "node:child_process";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export const PHOENIX = process.env.PHOENIX ?? join(homedir(), "code/github.com/kamp-us/phoenix");
export const PRS = process.env.PRS?.split(",").map(Number) ?? [10519, 10239, 10169, 10096, 10189, 10435, 9618, 10260, 10022];
const BINARY = /\.(png|jpe?g|gif|webp|ico|woff2?|ttf|zip|gz|wasm)$/i;
const TICKET_CHARS = 8_000;
const DIFF_CHARS = 20_000;

export const git = (...args: string[]) => execFileSync("git", args, { cwd: PHOENIX, encoding: "utf8", maxBuffer: 64 << 20 });
const gh = <T>(...args: string[]) => JSON.parse(execFileSync("gh", args, { cwd: PHOENIX, encoding: "utf8" })) as T;

export type Scope = "folder" | "package";

export interface Trial {
  readonly pr: number;
  readonly issue: number;
  readonly title: string;
  readonly hidden: string;
  /** The files the diff shows: the PR's changed files without the hidden one. */
  readonly shown: readonly string[];
  readonly candidates: readonly string[];
  readonly state: { readonly ticket: object; readonly diff: string };
  readonly base: string;
}

/**
 * The trials for one PR. `control` hides nothing (the hidden path is ""), so
 * the diff is whole and every candidate is a file that needed no change.
 */
export function trials(pr: number, scope: Scope, control: boolean): Trial[] {
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
    scope === "package"
      ? [...new Set(code.map((p) => p.split("/").slice(0, 3).join("/")))]
      : [...new Set(code.map(dirname))];
  const list = scope === "package" ? ["ls-tree", "-r", "--name-only"] : ["ls-tree", "--name-only"];
  const pool = folders.flatMap((folder) => git(...list, base, `${folder}/`).split("\n").filter((p) => p !== "" && !BINARY.test(p)));
  const existed = new Set(pool);
  // A file is hidden only if it existed before: a forgotten edit, not a forgotten new file.
  // The control hides "", which is no file: the diff is whole and every candidate is untouched.
  const hide = control ? [""] : code.filter((hidden) => existed.has(hidden));
  return hide.map((hidden) => {
    const shown = changed.filter((p) => p !== hidden);
    return {
      pr,
      issue,
      title: ticket.title,
      hidden,
      shown,
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
