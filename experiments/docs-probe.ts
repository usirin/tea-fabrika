// Can Jev check a "the docs say X" criterion by reading the whole doc?
//
// Four real phoenix docs (3 to 18k characters), read whole, at a fixed commit.
// For each, claims labelled by hand: "says" (the doc states it, often in other
// words), "silent" (on the doc's subject, plausible, but never stated), or
// "contradicts" (the doc states something else). Several are built to trip it:
// a right fact with one detail changed (a number, an exit code, which variable),
// a claim the doc's subject makes likely but the text never makes.
//
// A docs criterion passes only on a yes at 0.9 or more. The dangerous answer is
// a pass on a doc that does not say it: the builder's docs would be accepted
// missing the thing the ticket asked for. Each claim is asked 3 times.
//
// Run with `node experiments/docs-probe.ts`; needs TYPESAFE_API_KEY and a
// phoenix checkout at PHOENIX (default ~/code/github.com/kamp-us/phoenix).
import { execFileSync } from "node:child_process";
import { homedir } from "node:os";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { jevQuestions } from "@demlik/tea/jev";
import { askAll, pool } from "./jev.ts";

const REPEATS = 3;
const PASS_FLOOR = 0.9;
const PHOENIX = process.env.PHOENIX ?? join(homedir(), "code/github.com/kamp-us/phoenix");
const AT = "434614900d";

type Label = "says" | "silent" | "contradicts";
const docs: Record<string, readonly { readonly claim: string; readonly label: Label }[]> = {
  "packages/fabrika-cli/docs/running-fabrika-in-a-repo.md": [
    { claim: "The CLI can be installed globally with pnpm.", label: "says" },
    { claim: "pnpm 10 holds back the package's postinstall step until you approve it.", label: "says" },
    { claim: "A run from source shows the commit it was built from, and marks uncommitted changes.", label: "says" },
    { claim: "With no GitHub token anywhere, a GitHub-reading verb refuses and names GITHUB_TOKEN and GH_TOKEN.", label: "says" },
    { claim: "FABRIKA_GLOBAL_WARNING_DISABLED=1 silences the warning about running the global copy.", label: "says" },
    { claim: "A copy that lives in a different repository refuses to run, with exit 127.", label: "contradicts" },
    { claim: "The GitHub token is read only from GITHUB_TOKEN; GH_TOKEN is ignored.", label: "contradicts" },
    { claim: "A non-zero exit with empty output means the verb found nothing.", label: "contradicts" },
    { claim: "The CLI needs Node 24 or newer.", label: "silent" },
    { claim: "fabrika --version also checks that the GitHub token works.", label: "silent" },
    { claim: "Running `fabrika update` upgrades the global install.", label: "silent" },
  ],
  "claude-plugins/fabrika/guide/choose-a-model-per-shell.md": [
    { claim: "No fabrika shell picks its own model; each runs on the model of the session that spawned it.", label: "says" },
    { claim: "CLAUDE_CODE_SUBAGENT_MODEL sets the model for every shell at once.", label: "says" },
    { claim: "The per-spawn model parameter takes an alias such as sonnet, not a full model ID.", label: "says" },
    { claim: "There is no Claude Code setting that pins the model of one plugin agent.", label: "says" },
    { claim: "The agent file's frontmatter beats the model passed with a spawn.", label: "contradicts" },
    { claim: "Setting CLAUDE_CODE_SUBAGENT_MODEL_FORCE=1 is the way to pin one role's model.", label: "contradicts" },
    { claim: "The reviewer must run on a different model family than the builder.", label: "silent" },
    { claim: "Running a shell on haiku makes reviews cheaper but less accurate.", label: "silent" },
  ],
  "packages/fabrika-cli/docs/packaging.md": [
    { claim: "Inside a git worktree of phoenix, a bare fabrika runs that worktree's copy of the CLI.", label: "says" },
    { claim: "The compiled dist/ runs on Node 22.12 and newer.", label: "says" },
    { claim: "Node will not strip types from a .ts file under node_modules, which is why the published package ships compiled code.", label: "says" },
    { claim: "FABRIKA_SKIP_INFER skips delegation, like the --skip-infer flag.", label: "says" },
    { claim: "The compiled dist/ runs on Node 20.", label: "contradicts" },
    { claim: "In a consumer repo with no install, the global copy runs without any warning.", label: "contradicts" },
    { claim: "The child process keeps the caller's working directory.", label: "contradicts" },
    { claim: "The published package is signed with npm provenance.", label: "silent" },
    { claim: "dist/ is rebuilt on every pnpm install in the workspace.", label: "silent" },
  ],
  "claude-plugins/fabrika/guide/getting-started.md": [
    { claim: "The lesson takes about half an hour.", label: "says" },
    { claim: "fabrika's run state goes under .fabrika/ and is added to .gitignore.", label: "says" },
    { claim: "The first ship from the main folder refuses with exit 33 and merges nothing.", label: "says" },
    { claim: "After a build the clone is left on a detached HEAD, and that is expected.", label: "says" },
    { claim: "The CODEOWNERS file needs only the rows for paths your repo has.", label: "contradicts" },
    { claim: "The first ship refuses with exit 34.", label: "contradicts" },
    { claim: "An issue that changes a screen is built with /fabrika:build.", label: "contradicts" },
    { claim: "Triage always labels a README issue p1.", label: "contradicts" },
    { claim: "The lesson works on a GitLab repo too.", label: "silent" },
    { claim: "Branch protection on main must be turned on before the first merge.", label: "silent" },
    { claim: "The builder runs the repo's tests before opening the pull request.", label: "silent" },
  ],
};

const questions = jevQuestions({
  says: {
    type: "noul",
    instructions: "Does `doc` state `claim`? Read the whole doc. The wording may differ; the fact must be the same in every detail.",
    criteria: {
      true: "Somewhere in `doc` the same fact is stated, with the same numbers, names and conditions",
      false: "`doc` never states it, states something different, or only makes it seem likely",
    },
  },
});

const cases = Object.entries(docs).flatMap(([path, claims]) => claims.map((c) => ({ path, ...c })));
const text = Object.fromEntries(
  Object.keys(docs).map((path) => [path, execFileSync("git", ["show", `${AT}:${path}`], { cwd: PHOENIX, encoding: "utf8" })]),
);
const jobs = cases.flatMap((c) => Array.from({ length: REPEATS }, () => c));
const answers = await pool(jobs, 8, async (c) => {
  const reply = (await askAll(questions, { doc: { path: c.path, text: text[c.path] }, claim: c.claim })) as {
    says: { noul: number };
  };
  return { ...c, yes: reply.says.noul, passed: reply.says.noul >= PASS_FLOOR };
});

const count = (f: (a: (typeof answers)[number]) => boolean) => answers.filter(f).length;
console.log(`answers: ${answers.length}`);
console.log(`passed a claim the doc does not make (dangerous): ${count((a) => a.label !== "says" && a.passed)}`);
console.log(`  of them contradicted: ${count((a) => a.label === "contradicts" && a.passed)}`);
console.log(`a claim the doc makes, not passed (costs a person): ${count((a) => a.label === "says" && !a.passed)} of ${count((a) => a.label === "says")}`);
for (const c of cases) {
  const mine = answers.filter((a) => a.path === c.path && a.claim === c.claim);
  console.log(`${c.label.padEnd(11)} ${mine.map((a) => a.yes.toFixed(2)).join(" ")}  ${c.claim}`);
}
await writeFile(join(import.meta.dirname, "results", "docs-probe.json"), JSON.stringify(answers, null, 2));
