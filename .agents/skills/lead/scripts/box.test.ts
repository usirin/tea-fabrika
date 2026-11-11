// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "./mutbox.ts?raw";
import "./mutbox-entry.sh?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "./mutbox.Dockerfile?raw";
import "../../mutation/scripts/run.sh?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "../../mutation/scripts/limit.ts?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "../../mutation/scripts/sample.ts?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "../../mutation/scripts/scope.ts?raw";
// Declare script reads for Vitest's affected walk, including transitive calls.
import "./box.sh?raw";
import "./keepruns.sh?raw";
import "./leakgrep.sh?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "./drive.ts?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "./runid.ts?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "./pgrep.ts?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "./agents.ts?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "./codexexec.ts?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "./boxnode.ts?raw";
import "./fieldrow.py?raw";
import "./runplan.sh?raw";
import "./env.sh?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "./gc.ts?raw";
import "./redact.sh?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "./botpush.mjs?raw";
import "./clauderow.py?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "./lane.ts?raw";
import "../../plan/scripts/plancheck.sh?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "./sizecap.ts?raw";
import "../../step-commit/scripts/exam.py?raw";
import "../../step-commit/scripts/stepcommit.sh?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "../../../../exam-paths.json?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "../../../../next/apps/fabrika/src/exam/commits.ts?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "./gcloop.ts?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "./flow/Beat.ts?raw";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import fc from "fast-check";
import { describe, expect, it } from "vitest";

// Today's tooling. Real Git and the installed signer, local paths only. The only keys are
// throwaway keys made here; scripts open them, this test never reads their files.
const root = resolve(import.meta.dirname, "../../../..");
const program = join(import.meta.dirname, "box.sh");
const signer = join(root, "next/apps/fabrika/src/exam/commits.ts");
const options = { seed: 321, numRuns: 3, endOnFailure: true };
const word = fc.stringMatching(/^[a-z][a-z0-9]{1,8}$/);
type Call = { cmd: string; args: string[]; cwd: string; head?: string };
type Operation = { path: string; text?: string; to?: string };

type Setup = {
  operations?: Operation[];
  batches?: Operation[][];
  exit?: number;
  signal?: boolean;
  usage?: boolean;
  hold?: boolean;
  check?: { status: number; text: string };
  secrets?: string[];
  /** Head branches of the open PRs the fake gh lists; `gh: "down"` makes it fail. */
  openPrs?: string[];
  gh?: "down";
  /** A ref the fake git deletes just before the scan's first walk of a branch (its `diff --no-renames`),
   * as a lead's `git branch -D` mid-scan. */
  dropOnWalk?: string;
};

const body = (
  files: Array<[string, string]> = [
    ["src/a.ts", "tests"],
    ["src/b.ts", "build"],
  ],
) =>
  `# Today's tooling\n\n\`\`\`text\nstep -> fetch\n\`\`\`\n\n## Laws\n| Law | Generator | Plant |\n| --- | --- | --- |\n| holds | fc.record: files | break |\n\n## Files\n| File | Owner step |\n| --- | --- |\n${files.map(([path, owner]) => `| ${path} | ${owner} |`).join("\n")}\n\n## Size\n1 agent hour, 80 lines. Confidence: 90%.\n\n## What it records\nRun IDs and digests.\n\n## What it cannot tell us\nNo live service.\n\n## Open questions\nNone.\n`;

const hash = (text: string) => createHash("sha256").update(Buffer.from(text)).digest("hex");

const approve = (text: string) =>
  `Approved by the lead agent, builds the decided note; body ${hash(text).slice(0, 12)}\nPlancheck-Version: 2\n${text}`;

const write = (path: string, text: string) => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
};

// The fixture's git: the real git, its two plants, and one row per call in calls.git. A row is the
// folder, the argument count and each argument, each field ended by a NUL, which no argument can
// hold. It is sh, not the Node stub: box.sh and the signer call git about 400 times a law case, and
// booting Node for each cost about 50 ms over git's own 12 ms (ticket 621). The match on the box
// compares physical paths, so `cd` into the box and a symlinked spelling are refused too.
// String.raw keeps every backslash, so this text holds no backtick and no dollar-brace.
const GIT = String.raw`#!/bin/sh
dir=$T321_FIXTURE
cwd=$(pwd -P)
printf '%s\000' "$cwd" "$#" "$@" >> "$dir/calls.git"
take=
diff=
renames=
for a in "$@"; do
  if [ -n "$take" ]; then
    case $a in /*) cwd=$a ;; *) cwd=$cwd/$a ;; esac
    take=
    continue
  fi
  case $a in
    -C) take=1 ;;
    diff) diff=1 ;;
    --no-renames) renames=1 ;;
  esac
done
read -r ref < "$dir/drop-on-walk"
if [ -n "$diff" ] && [ -n "$renames" ] && [ -n "$ref" ] && [ ! -e "$dir/dropped" ]; then
  : > "$dir/dropped"
  /usr/bin/git -C "$cwd" update-ref -d "$ref" > /dev/null 2>&1
fi
if [ "$T321_FETCH" = 1 ] && [ -d "$cwd" ] &&
  [ "$(cd "$cwd" && pwd -P)" = "$(cd "$dir/boxes/one" 2> /dev/null && pwd -P)" ]; then
  echo "fixture refuses Git inside the box during fetch" >&2
  exit 98
fi
exec /usr/bin/git "$@"
`;

/** Every row the fixture's commands wrote: the Node stub's JSON lines, then the git shim's rows. */
const readCalls = (dir: string): Call[] => {
  const read = (name: string) => (existsSync(join(dir, name)) ? readFileSync(join(dir, name), "utf8") : "");
  const calls: Call[] = read("calls.jsonl")
    .split("\n")
    .filter(Boolean)
    .map((s) => JSON.parse(s));
  const fields = read("calls.git").split("\0");

  for (let i = 0; i + 1 < fields.length; i += 2 + Number(fields[i + 1])) {
    calls.push({ cmd: "git", cwd: fields[i]!, args: fields.slice(i + 2, i + 2 + Number(fields[i + 1])) });
  }

  return calls;
};

// Only codex is fake. pnpm dispatches commits to the real installed program, and refuses all
// package/network commands except the no-op local install. nice is a transparent local shim.
const stub = String.raw`
const fs = require("node:fs"), path = require("node:path"), cp = require("node:child_process");
const dir = process.env.T321_FIXTURE;
const setup = JSON.parse(fs.readFileSync(path.join(dir, "setup.json"), "utf8"));
const cmd = path.basename(process.argv[1]), args = process.argv.slice(2);
const run = (cmd, args, more = {}) => cp.spawnSync(cmd, args, {encoding:"utf8", env:process.env, ...more});
const finish = r => { process.stdout.write(r.stdout || ""); process.stderr.write(r.stderr || ""); process.exit(r.status ?? 2); };
const head = run("/usr/bin/git", ["rev-parse", "HEAD"]).stdout.trim();
fs.appendFileSync(path.join(dir,"calls.jsonl"), JSON.stringify({cmd,args,cwd:process.cwd(),head}) + "\n");
if (cmd === "nice") finish(run(args[2],args.slice(3)));
if (cmd === "pnpm") {
  if (args[0] === "install") process.exit(0);
  if (args[0] === "commits") {
    if (args[1] === "check" && setup.check) { process.stdout.write(setup.check.text); process.exit(setup.check.status); }
    finish(run(process.execPath,[process.env.T321_SIGNER,...args.slice(1)]));
  }
  if (args[0] === "exec" && args[1] === "oxfmt") finish(run(process.env.T321_OXFMT,args.slice(2)));
  console.error("fixture refuses package or network command"); process.exit(97);
}
if (cmd === "gh") {
  if (setup.gh === "down" || args.slice(0,2).join(" ") !== "pr list") { console.error("fixture gh is down"); process.exit(1); }
  for (const head of setup.openPrs || []) console.log(head);
  process.exit(0);
}
if (cmd === "codex") {
  const out = args[args.indexOf("-o")+1];
  let envLeaks = 0;
  for (const [name,value] of Object.entries(process.env)) {
    if (/TOKEN|SECRET|KEY|PASSWORD|_AUTH|^NPM_CONFIG_/i.test(name) && !/^NPM_CONFIG_(USERCONFIG|GLOBALCONFIG)$/i.test(name) && value) envLeaks++;
  }
  // Read only the fixture's user, global and project layers; no npm binary is needed.
  const userConfig=process.env.NPM_CONFIG_USERCONFIG;
  if(!userConfig || !fs.existsSync(userConfig) || fs.readFileSync(userConfig,"utf8")!=="") { console.error("fixture requires an empty user config"); process.exit(96); }
  const layers=[userConfig,process.env.NPM_CONFIG_GLOBALCONFIG || path.join(dir,"global.npmrc"),path.join(process.cwd(),".npmrc")];
  const settings=layers.filter(file=>fs.existsSync(file)).flatMap(file=>fs.readFileSync(file,"utf8").split(/\r?\n/)).map(line=>line.match(/^\s*([^#;\s][^=]*)=(.*)$/)).filter(Boolean);
  const authLeaks=settings.filter(([,key,value])=>/_auth|password|token/i.test(key)&&value.trim()!=="").length;
  const observation = {envLeaks,authLeaks,home:process.env.HOME,path:process.env.PATH};
  fs.writeFileSync(path.join(dir,"observed.json"),JSON.stringify(observation));
  for (const batch of setup.batches || (setup.operations || []).map(op=>[op])) {
    for (const op of batch) {
      const target = path.join(process.cwd(),op.path);
      if (op.to) { fs.mkdirSync(path.dirname(path.join(process.cwd(),op.to)),{recursive:true}); finishIfBad(run("/usr/bin/git",["mv",op.path,op.to])); }
      else if (op.text === undefined) fs.rmSync(target);
      else { fs.mkdirSync(path.dirname(target),{recursive:true}); fs.writeFileSync(target,op.text); }
    }
    finishIfBad(run("/usr/bin/git",["add","--all"]));
    finishIfBad(run("/usr/bin/git",["commit","-q","-m","step change"]));
  }
  function finishIfBad(r) { if (r.status !== 0) finish(r); }
  const tokens = setup.secrets || [];
  const answer = "safe text\n" + tokens.join("\n");
  fs.writeFileSync(out,answer);
  for (const token of tokens) console.log(JSON.stringify({type:"item.completed",text:token,url:"https://example.test/?q="+encodeURIComponent(token)}));
  if (setup.usage !== false) console.log(JSON.stringify({type:"turn.completed",usage:{input_tokens:100,cached_input_tokens:20,output_tokens:10}}));
  if (setup.hold) {
    fs.writeFileSync(path.join(dir,"ready"),"ready");
    setInterval(()=>{},1000);
  } else if (setup.signal) process.kill(process.pid,"SIGTERM");
  else process.exit(setup.exit || 0);
}
`;

class Box {
  readonly dir = mkdtempSync(join(tmpdir(), "bx321-"));
  readonly main = join(this.dir, "main");
  readonly boxes = join(this.dir, "boxes");
  readonly home = join(this.dir, "home");
  readonly bin = join(this.dir, "bin");
  readonly plan = join(this.dir, "plan.md");
  readonly work = join(this.boxes, "one");
  readonly data = join(this.boxes, "one-gitdata");
  readonly branch = "fabrikalfa/one";
  readonly env: NodeJS.ProcessEnv;
  readonly base: string;

  constructor(files?: Array<[string, string]>) {
    for (const path of [this.main, this.boxes, this.home, this.bin, join(this.boxes, "state")]) {
      mkdirSync(path, { recursive: true });
    }

    this.env = {
      HOME: this.home,
      PATH: `${this.bin}:${dirname(process.execPath)}:/usr/bin:/bin`,
      TMPDIR: this.dir,
      MAIN: this.main,
      BOXES: this.boxes,
      REMOTE: this.main,
      GH_REPO: "fixture/local",
      FABRIKA_COAUTHOR: "Person <person@example.test>",
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_TERMINAL_PROMPT: "0",
      GIT_AUTHOR_NAME: "fixture",
      GIT_AUTHOR_EMAIL: "fixture@example.test",
      GIT_COMMITTER_NAME: "fixture",
      GIT_COMMITTER_EMAIL: "fixture@example.test",
      CODEX_MODEL: "gpt-6.1-sol",
      CODEX_EFFORT: "low",
      T321_FIXTURE: this.dir,
      T321_SIGNER: signer,
      T321_OXFMT: join(root, "node_modules/.bin/oxfmt"),
      NPM_CONFIG_USERCONFIG: join(this.home, ".npmrc"),
      NPM_CONFIG_GLOBALCONFIG: join(this.dir, "global.npmrc"),
    };
    write(join(this.home, ".npmrc"), "");
    write(join(this.dir, "global.npmrc"), "");
    this.setup({});

    writeFileSync(join(this.bin, "git"), GIT, { mode: 0o755 });

    for (const cmd of ["pnpm", "codex", "gh"]) {
      writeFileSync(join(this.bin, cmd), `#!${process.execPath}\n${stub}`, { mode: 0o755 });
    }

    writeFileSync(join(this.bin, "nice"), '#!/bin/sh\nshift 2\nexec "$@"\n', { mode: 0o755 });
    this.git(this.main, "init", "-q", "-b", "main", `--separate-git-dir=${join(this.dir, "main-gitdata")}`);
    const lines: string[] = [];

    for (const role of ["tests", "build", "lead", "person", "stranger"]) {
      const key = join(this.home, ".fabrika/step-keys", role);
      mkdirSync(dirname(key), { recursive: true });
      this.must("ssh-keygen", ["-q", "-t", "ed25519", "-N", "", "-C", "fixture", "-f", key]);
      const pub = this.must("ssh-keygen", ["-y", "-f", key]).trim().split(" ").slice(0, 2).join(" ");

      if (role !== "stranger") {
        lines.push(
          `${role === "person" ? "person:fixture" : role} namespaces="${role === "person" ? "git" : "fabrika-step"}" ${pub}`,
        );
      }
    }

    write(join(this.main, "allowed_signers"), `${lines.join("\n")}\n`);
    const exam = JSON.parse(readFileSync(join(root, "exam-paths.json"), "utf8"));
    // The installed checker skips ordinary tooling files. This disposable exam row makes its
    // real signature, person and stale-link checks run instead of accepting its scope skip.
    exam.push({ glob: "src/a.ts", why: "this fixture's signed tests change" });
    write(join(this.main, "exam-paths.json"), JSON.stringify(exam));
    write(join(this.main, "package.json"), "{}\n");
    write(join(this.main, "src/a.ts"), 'export const a = "before";\n');
    write(join(this.main, "src/b.ts"), 'export const b = "before";\n');
    write(join(this.main, "src/old.ts"), 'export const old = "before";\n');
    write(join(this.main, "src/a.test.ts"), 'export const test = "before";\n');
    this.git(this.main, "add", "--all");
    this.git(this.main, "commit", "-q", "-m", "base");
    this.base = this.head(this.main);
    this.git(this.main, "update-ref", "refs/remotes/origin/main", this.base);
    // origin is this disposable local repo. No command can contact a host.
    this.git(this.main, "remote", "add", "origin", this.main);
    this.git(this.dir, "clone", "-q", `--separate-git-dir=${this.data}`, this.main, this.work);
    this.git(this.work, "config", "user.name", "fixture");
    this.git(this.work, "config", "user.email", "fixture@example.test");
    this.git(this.work, "checkout", "-q", "-b", this.branch);
    this.git(this.main, "update-ref", `refs/heads/${this.branch}`, this.base);
    write(this.plan, approve(body(files)));
    write(join(this.dir, "prompt"), "A bounded fixture run.\n");
    this.state();
  }

  close() {
    rmSync(this.dir, { recursive: true, force: true });
  }

  setup(value: Setup) {
    write(join(this.dir, "setup.json"), JSON.stringify(value));
    // The sh git shim reads the planted ref as a plain line, not JSON.
    write(join(this.dir, "drop-on-walk"), value.dropOnWalk ?? "");
  }

  call(cmd: string, args: string[], cwd = this.main, env = this.env) {
    const r = spawnSync(cmd, args, { cwd, env, encoding: "utf8", timeout: 15_000 });
    expect(r.error, `${cmd} failed to start`).toBeUndefined();
    return { code: r.status, signal: r.signal, text: r.stdout + r.stderr, stdout: r.stdout };
  }

  must(cmd: string, args: string[], cwd = this.main) {
    const r = this.call(cmd, args, cwd);
    expect(r.code, r.text).toBe(0);
    return r.stdout;
  }

  git(cwd: string, ...args: string[]) {
    return this.must("/usr/bin/git", args, cwd);
  }

  head(cwd = this.main, rev = "HEAD") {
    return this.git(cwd, "rev-parse", rev).trim();
  }

  state(base = this.base) {
    const approvedBody = readFileSync(this.plan, "utf8").split("\n").slice(2).join("\n");
    write(
      join(this.boxes, "state/one.box"),
      `ticket: 321\nbranch: ${this.branch}\nbase: ${base}\nparent: none\nchildren: none\nplan: ${this.plan}\nplan-sha256: ${hash(approvedBody)}\n`,
    );
  }

  run(step = "tests") {
    return this.call("sh", [
      program,
      "run",
      "one",
      join(this.dir, "prompt"),
      join(this.dir, "answer"),
      "--step",
      step,
      "--ticket",
      "321",
    ]);
  }

  fetch(step = "tests", ticket = "321") {
    return this.call("sh", [program, "fetch", "one", this.branch, "--sign", step, "--ticket", ticket], this.main, {
      ...this.env,
      T321_FETCH: "1",
    });
  }

  new(base = "origin/main", branch = "fabrikalfa/new") {
    return this.call("sh", [program, "new", "new", base, branch, "--ticket", "321", "--plan", this.plan]);
  }

  calls(): Call[] {
    return readCalls(this.dir);
  }

  notes() {
    return this.git(this.main, "notes", "--ref=fabrika", "list");
  }

  sign(cwd: string, step: string, ticket = "321", key = step) {
    return this.must(
      process.execPath,
      [signer, "sign", "--step", step, "--ticket", ticket, "--key", join(this.home, ".fabrika/step-keys", key)],
      cwd,
    );
  }

  commit(cwd: string, path: string, text: string) {
    write(join(cwd, path), text);
    this.git(cwd, "add", "--", path);
    this.git(cwd, "commit", "-q", "-m", "outside change");
    return this.head(cwd);
  }

  rows(): Array<Record<string, unknown>> {
    const path = join(this.boxes, "state/one.rows.jsonl");
    return existsSync(path)
      ? readFileSync(path, "utf8")
          .trim()
          .split("\n")
          .filter(Boolean)
          .map((s) => JSON.parse(s))
      : [];
  }
}

const fixture = (f: (b: Box) => void, files?: Array<[string, string]>) => {
  const b = new Box(files);

  try {
    f(b);
  } finally {
    b.close();
  }
};

const refused = (r: { code: number | null; text: string }, pattern: RegExp) => {
  expect(r.code, r.text).not.toBe(0);
  expect(r.text).toMatch(pattern);
  expect(r.text).not.toMatch(/usage:|Traceback|command not found|cannot open/);
};

/** A start check's no: exit 3 and one `refused <check>: <why>` line, which drive reads (ticket 428). */
const checkRefused = (r: { code: number | null; text: string }, check: string, pattern = /.*/) => {
  refused(r, pattern);
  expect(r.code, r.text).toBe(3);
  expect(r.text).toMatch(new RegExp(`^refused ${check}: .*$`, "m"));
  expect(r.text).not.toMatch(/^stuck /m);
};

// Exercise every independent fault, even while the product still lacks several checks.
const each = <A>(values: readonly A[], check: (value: A) => void) => {
  const errors: Error[] = [];

  for (const value of values) {
    try {
      check(value);
    } catch (cause) {
      errors.push(
        new Error(`${JSON.stringify(value)}: ${cause instanceof Error ? cause.message : String(cause)}`, { cause }),
      );
    }
  }

  if (errors.length) {
    throw new AggregateError(errors, errors.map((e) => e.message).join("\n"));
  }
};

// A real SIGTERM to the runner and its child. The separate group contains only this fixture.
const signalRun = (b: Box, runner: "box" | "plan" = "box") =>
  new Promise<{ code: number | null; signal: NodeJS.Signals | null; text: string }>((resolve, reject) => {
    const args =
      runner === "box"
        ? [program, "run", "one", join(b.dir, "prompt"), join(b.dir, "answer"), "--step", "tests", "--ticket", "321"]
        : [join(import.meta.dirname, "runplan.sh"), "one", join(b.dir, "prompt")];
    const child = spawn("sh", args, { cwd: b.main, env: b.env, detached: true });
    child.stdin.end();
    let text = "",
      sent = false;
    const poll = setInterval(() => {
      if (!sent && existsSync(join(b.dir, "ready"))) {
        sent = true;

        if (child.pid) {
          process.kill(-child.pid, "SIGTERM");
        }
      }
    }, 10);
    const timeout = setTimeout(() => {
      if (child.pid) {
        try {
          process.kill(-child.pid, "SIGKILL");
        } catch {}
      }

      reject(new Error("fixture runner never reached the signal point"));
    }, 10_000);
    child.stdout.on("data", (s) => {
      text += s;
    });
    child.stderr.on("data", (s) => {
      text += s;
    });
    child.on("error", reject);
    child.on("close", (code, signal) => {
      clearInterval(poll);
      clearTimeout(timeout);
      resolve({ code, signal, text });
    });
  });

describe("T321 K1 fetch, today's tooling", () => {
  // Plant: keep -f in fetch. update-ref creates each bad graph without rewriting this repo.
  it("K1 refuses amend, reset and rebase graphs without moving MAIN's branch ref", () => {
    fc.assert(
      fc.property(word, (text) => {
        each(["amend", "reset", "rebase"], (kind) =>
          fixture((b) => {
            const before = b.commit(b.work, "src/a.ts", `${text}\n`);
            b.git(b.main, "fetch", "-q", b.work, `${b.branch}:${b.branch}`);
            const tree = b.head(b.work, "HEAD^{tree}");
            const rewritten =
              kind === "reset" ? b.base : b.git(b.work, "commit-tree", tree, "-p", b.base, "-m", kind).trim();
            b.git(b.work, "update-ref", `refs/heads/${b.branch}`, rewritten);
            refused(b.fetch(), /rewrite|non.fast.forward|rejected/);
            expect(b.head(b.main, b.branch)).toBe(before);
          }),
        );
      }),
      options,
    );
  });

  // Plants: sign the base or an existing link; move MAIN's HEAD to sign; use the box's signer.
  it("K1 signs only unsigned run-owned commits oldest first; repeat fetch changes nothing", () => {
    fc.assert(
      fc.property(fc.array(word, { minLength: 1, maxLength: 3 }), fc.constantFrom("tests", "mutation"), (texts, step) =>
        fixture(
          (b) => {
            const before = {
              head: b.head(),
              index: b.git(b.main, "write-tree"),
              status: b.git(b.main, "status", "--porcelain"),
            };
            b.setup({
              operations: texts.map((text, i) => ({ path: "src/a.ts", text: `${text}-${i}\n` })),
            });
            expect(b.run(step).code).toBe(0);
            const commits = b.git(b.work, "rev-list", "--reverse", `${b.base}..HEAD`).trim().split("\n");
            const fetched = b.fetch(step);
            expect(fetched.code, fetched.text).toBe(0);
            expect(b.head(b.main, b.branch)).toBe(b.head(b.work));

            for (const [i, sha] of commits.entries()) {
              const note = JSON.parse(b.git(b.main, "notes", "--ref=fabrika", "show", sha));
              expect(note).toMatchObject({ step: "tests", ticket: "321", version: i + 1 });
              expect(note.from).toBe(b.head(b.main, `${sha}^1^{tree}`));
              expect(note.to).toBe(b.head(b.main, `${sha}^{tree}`));
            }

            const verified = b.call(process.execPath, [signer, "check", "--base", b.base, "--head", b.head(b.work)]);
            expect(verified.code, verified.text).toBe(0);
            expect(b.notes().split("\n").filter(Boolean)).toHaveLength(commits.length);
            const notes = b.notes();
            const repeat = b.fetch(step);
            expect(repeat.code, repeat.text).toBe(0);
            expect(b.notes()).toBe(notes);
            expect(readFileSync(join(b.boxes, "state/one.box"), "utf8")).toContain(b.head(b.work));
            expect({
              head: b.head(),
              index: b.git(b.main, "write-tree"),
              status: b.git(b.main, "status", "--porcelain"),
            }).toEqual(before);
            const signs = b.calls().filter((c) => c.cmd === "pnpm" && c.args[1] === "sign");
            expect(signs.map((c) => c.head)).toEqual(commits);
            expect(signs.every((c) => realpathSync(c.cwd) === realpathSync(b.main))).toBe(true);
            const checks = b.calls().filter((c) => c.cmd === "pnpm" && c.args[1] === "check");
            expect(checks).toHaveLength(2);

            for (const c of checks) {
              expect(c.args).toEqual(["commits", "check", "--base", b.base, "--head", b.head(b.work)]);
            }
          },
          [["src/a.ts", "tests"]],
        ),
      ),
      options,
    );
  });

  // Plants: sign a native person signature or an existing valid link; reuse MAIN's index.
  it("K1 preserves verified person signatures, existing links and a dirty MAIN checkout", () => {
    fc.assert(
      fc.property(word, (text) =>
        fixture((b) => {
          const linked = b.commit(b.work, "src/a.ts", "linked\n");
          b.sign(b.work, "tests");
          const note = b.git(b.work, "notes", "--ref=fabrika", "show", linked);
          write(join(b.work, "src/a.ts"), "person\n");
          b.git(b.work, "add", "--", "src/a.ts");
          b.git(
            b.work,
            "-c",
            "gpg.format=ssh",
            "-c",
            `user.signingkey=${join(b.home, ".fabrika/step-keys/person")}`,
            "commit",
            "-q",
            "--gpg-sign",
            "-m",
            "person signed",
          );
          const person = b.head(b.work);
          const control = b.call(process.execPath, [signer, "check", "--base", b.base, "--head", person], b.work);
          expect(control.code, control.text).toBe(0);
          expect(control.text).toContain("exam_read");
          b.setup({ operations: [{ path: "src/a.ts", text: `${text}\n` }] });
          expect(b.run().code).toBe(0);
          write(join(b.main, "src/b.ts"), "staged main edit\n");
          b.git(b.main, "add", "--", "src/b.ts");
          write(join(b.main, "src/old.ts"), "unstaged main edit\n");
          const snapshot = {
            head: b.head(),
            index: b.git(b.main, "write-tree"),
            diff: b.git(b.main, "diff"),
            status: b.git(b.main, "status", "--porcelain"),
          };
          const got = b.fetch();
          expect(got.code, got.text).toBe(0);
          expect(b.git(b.main, "notes", "--ref=fabrika", "show", linked)).toBe(note);
          expect(b.call("/usr/bin/git", ["notes", "--ref=fabrika", "show", person]).code).not.toBe(0);
          expect(b.notes().trim().split("\n")).toHaveLength(2);
          expect(
            b
              .calls()
              .filter((c) => c.cmd === "pnpm" && c.args[1] === "sign")
              .map((c) => c.head),
          ).toEqual([b.head(b.work)]);
          expect({
            head: b.head(),
            index: b.git(b.main, "write-tree"),
            diff: b.git(b.main, "diff"),
            status: b.git(b.main, "status", "--porcelain"),
          }).toEqual(snapshot);
          const check = b.call(process.execPath, [signer, "check", "--base", b.base, "--head", b.head(b.work)]);
          expect(check.code, check.text).toBe(0);
        }),
      ),
      options,
    );
  });

  // Plant: release the shared notes lock before the signer exits, losing one branch's note.
  it("K1 overlapping fetches preserve both branches' independently verified links", async () => {
    await fc.assert(
      fc.asyncProperty(fc.boolean(), async (reverse) => {
        const b = new Box();

        try {
          const two = join(b.boxes, "two"),
            data = join(b.boxes, "two-gitdata");
          b.git(b.dir, "clone", "-q", `--separate-git-dir=${data}`, b.main, two);
          b.git(two, "config", "user.name", "fixture");
          b.git(two, "config", "user.email", "fixture@example.test");
          b.git(two, "checkout", "-q", "-b", "fabrikalfa/two");
          b.git(b.main, "update-ref", "refs/heads/fabrikalfa/two", b.base);
          write(
            join(b.boxes, "state/two.box"),
            readFileSync(join(b.boxes, "state/one.box"), "utf8")
              .replace("ticket: 321", "ticket: 322")
              .replace("branch: fabrikalfa/one", "branch: fabrikalfa/two"),
          );
          b.setup({ operations: [{ path: "src/a.ts", text: "one\n" }] });
          expect(b.run().code).toBe(0);
          b.setup({ operations: [{ path: "src/a.ts", text: "two\n" }] });
          expect(
            b.call("sh", [
              program,
              "run",
              "two",
              join(b.dir, "prompt"),
              join(b.dir, "answer-two"),
              "--step",
              "tests",
              "--ticket",
              "322",
            ]).code,
          ).toBe(0);
          const fetch = (name: string, ticket: string) =>
            new Promise<{ code: number | null; text: string }>((resolve, reject) => {
              const child = spawn(
                "sh",
                [program, "fetch", name, `fabrikalfa/${name}`, "--sign", "tests", "--ticket", ticket],
                { cwd: b.main, env: { ...b.env, T321_FETCH: "1" }, timeout: 15_000 },
              );
              child.stdin.end();
              let text = "";
              child.stdout.on("data", (s) => {
                text += s;
              });
              child.stderr.on("data", (s) => {
                text += s;
              });
              child.on("error", reject);
              child.on("close", (code) => resolve({ code, text }));
            });
          const order = reverse
            ? [
                ["two", "322"],
                ["one", "321"],
              ]
            : [
                ["one", "321"],
                ["two", "322"],
              ];

          for (const got of await Promise.all(order.map(([name, ticket]) => fetch(name!, ticket!)))) {
            expect(got.code, got.text).toBe(0);
          }

          for (const name of ["one", "two"]) {
            const check = b.call(process.execPath, [
              signer,
              "check",
              "--base",
              b.base,
              "--head",
              b.head(b.main, `fabrikalfa/${name}`),
            ]);
            expect(check.code, check.text).toBe(0);
          }

          expect(b.notes().trim().split("\n")).toHaveLength(2);
        } finally {
          b.close();
        }
      }),
      { ...options, numRuns: 2 },
    );
  });

  // Plant: trust --sign without checking the run ticket, step and bounds, or the state base.
  it("K1 refuses a mismatched run, a commit outside its run, or a non-ancestor state base", () => {
    fc.assert(
      fc.property(word, (text) => {
        each(["ticket", "step", "outside", "base"], (fault) =>
          fixture((b) => {
            if (fault === "outside") {
              b.commit(b.work, "src/a.ts", "outside\n");
            }

            b.setup({ operations: [{ path: "src/a.ts", text: `${text}\n` }] });
            expect(b.run().code).toBe(0);

            if (fault === "base") {
              const other = b.git(b.main, "commit-tree", b.head(b.main, "HEAD^{tree}"), "-m", "unrelated").trim();
              b.state(other);
            }

            refused(
              b.fetch(fault === "step" ? "build" : "tests", fault === "ticket" ? "322" : "321"),
              /run|ticket|step|base|ancestor|unsigned/,
            );
            expect(b.notes()).toBe("");
          }),
        );
      }),
      options,
    );
  });

  // Plant: check only rename destinations, or sign mixed and unknown owners before refusal.
  it("K1 checks unknown, mixed, deleted and both renamed paths before any signing", () => {
    fc.assert(
      fc.property(word, (text) => {
        each(["unknown", "mixed", "rename", "delete", "exam"], (fault) =>
          fixture(
            (b) => {
              if (fault === "exam") {
                b.commit(b.work, "src/a.ts", "tests prerequisite\n");
                b.sign(b.work, "tests");
                b.git(
                  b.main,
                  "fetch",
                  "-q",
                  b.work,
                  `${b.branch}:${b.branch}`,
                  "refs/notes/fabrika:refs/notes/fabrika",
                );
              }

              const notes = b.notes();
              const operations: Operation[] = [{ path: "src/a.ts", text: `${text}\n` }];
              operations.push(
                fault === "rename"
                  ? { path: "src/old.ts", to: "src/new.ts" }
                  : fault === "delete"
                    ? { path: "src/old.ts" }
                    : {
                        path:
                          fault === "exam"
                            ? ".agents/skills/lead/scripts/fixture.test.ts"
                            : fault === "mixed"
                              ? "src/b.ts"
                              : "src/unknown.ts",
                        text: "changed\n",
                      },
              );
              b.setup({ batches: [operations] });
              expect(b.run(fault === "exam" ? "build" : "tests").code).toBe(0);
              refused(b.fetch(fault === "exam" ? "build" : "tests"), /owner|exam|path|tests|order/);
              expect(b.calls().filter((c) => c.cmd === "pnpm" && c.args[1] === "sign")).toEqual([]);
              expect(b.notes()).toBe(notes);
            },
            [
              ["src/a.ts", fault === "exam" ? "build" : "tests"],
              ["src/b.ts", "build"],
              ["src/old.ts", "build"],
              ["src/new.ts", "tests"],
              [".agents/skills/lead/scripts/fixture.test.ts", "build"],
            ],
          ),
        );
      }),
      options,
    );
  }, 180_000); // about 55 s alone and over 60 s under load here; same cases and sizes

  // scenario: the exam is the test writer's (nobody-writes-their-own-exam.md), so fetch signs a
  // tests commit that holds an exam path the plan gives to no step, as stepcommit commits it, and
  // still refuses one the plan gives to build. 2026-11-11: three tests steps lost their laws to
  // not_owner on exam paths the plan did not name. Plants: refuse every unlisted path; allow an
  // exam path the plan gives to another step.
  it("K1 signs a tests commit with an exam path no plan row names, never one given to build", () => {
    const exam = ".agents/skills/lead/scripts/fixture.test.ts";
    each(["unlisted", "build"] as const, (row) =>
      fixture(
        (b) => {
          b.setup({
            batches: [
              [
                { path: "src/a.ts", text: "tests change\n" },
                { path: exam, text: "a new law\n" },
              ],
            ],
          });
          expect(b.run().code).toBe(0);
          const got = b.fetch();
          const signs = b.calls().filter((c) => c.cmd === "pnpm" && c.args[1] === "sign");

          if (row === "unlisted") {
            expect(got.code, got.text).toBe(0);
            expect(signs.map((c) => c.head)).toEqual([b.head(b.work)]);
          } else {
            refused(got, new RegExp(`not_owner ${exam.replaceAll(".", "\\.")}`));
            expect(signs).toEqual([]);
            expect(b.notes()).toBe("");
          }
        },
        [["src/a.ts", "tests"], ...(row === "build" ? [[exam, "build"] as [string, string]] : [])],
      ),
    );
  }, 180_000);

  // Plant: overwrite existing notes, including stale or invalid ones; concatenate a conflict.
  it("K1 preserves stale, malformed, invalid and conflicting notes and reports their checks", () => {
    fc.assert(
      fc.property(word, (text) => {
        each(["stale", "malformed", "invalid", "conflict"], (kind) =>
          fixture((b) => {
            b.setup({ operations: [{ path: "src/a.ts", text: `${text}\n` }] });
            expect(b.run().code).toBe(0);
            const sha = b.head(b.work);

            if (kind === "malformed") {
              b.git(b.work, "notes", "--ref=fabrika", "add", "-m", "not JSON", sha);
            } else {
              b.sign(b.work, "tests");

              if (kind === "invalid") {
                const note = JSON.parse(b.git(b.work, "notes", "--ref=fabrika", "show", sha));
                b.git(
                  b.work,
                  "notes",
                  "--ref=fabrika",
                  "add",
                  "-f",
                  "-m",
                  JSON.stringify({ ...note, sig: "bad signature" }),
                  sha,
                );
              }

              if (kind === "stale") {
                b.git(b.main, "fetch", "-q", b.work, "refs/notes/fabrika:refs/notes/fabrika");
                b.git(b.main, "checkout", "-q", "-b", "other");
                b.commit(b.main, "src/a.ts", "newer\n");
                b.sign(b.main, "tests");
                b.git(b.main, "checkout", "-q", "main");
                // Make the box's v1 stale with a real v2 link on the other branch.
                b.git(b.work, "fetch", "-q", b.main, "refs/notes/fabrika:refs/notes/newer");
                b.git(b.work, "notes", "--ref=fabrika", "merge", "newer");
              }
            }

            const original = b.git(b.work, "notes", "--ref=fabrika", "show", sha);

            if (kind === "conflict") {
              b.git(b.main, "fetch", "-q", b.work, `${b.branch}:refs/heads/incoming`);
              b.git(b.main, "notes", "--ref=fabrika", "add", "-m", "different note", sha);
            }

            const mainNote = kind === "conflict" ? b.git(b.main, "notes", "--ref=fabrika", "show", sha) : original;
            refused(
              b.fetch(),
              kind === "stale"
                ? /stale_link/
                : kind === "conflict"
                  ? /conflict|note/
                  : /unsigned_commit|invalid|malformed/,
            );
            expect(b.git(b.main, "notes", "--ref=fabrika", "show", sha)).toBe(mainNote);
            expect(b.calls().filter((c) => c.cmd === "pnpm" && c.args[1] === "sign")).toEqual([]);
          }),
        );
      }),
      options,
    );
  }, 180_000); // measured 61 to 68 s under load in review and here; same cases and sizes

  // Plant: treat exit 2, truncated JSON or a failed check as success; hide owner asks.
  it("K1 prints every check answer and fails closed on status or unreadable output", () => {
    fc.assert(
      fc.property(word, (text) => {
        each(
          [
            [
              1,
              '{"_tag":"stuck","reason":"unsigned_commit","sha":"one"}\n{"_tag":"stuck","reason":"stale_link","sha":"two"}\n',
              false,
            ],
            [2, "", false],
            [2, '{"_tag":"done"}\n', false],
            [0, "not json\n", false],
            [0, '{"_tag":"ask","to":"owner","for":"exam_read","paths":["src/a.test.ts"]}\n', true],
          ] as const,
          ([status, output, pass]) =>
            fixture((b) => {
              b.setup({
                operations: [{ path: "src/a.ts", text: `${text}\n` }],
                check: { status, text: output },
              });
              expect(b.run().code).toBe(0);
              const got = b.fetch();
              expect(got.code, got.text).toBe(pass ? 0 : 1);

              if (status === 1) {
                expect(got.text).toContain("unsigned_commit");
                expect(got.text).toContain("stale_link");
              }

              if (pass) {
                expect(got.text).toContain("exam_read");
              }
            }),
        );
      }),
      options,
    );
  }, 180_000); // about 55 s alone and over 60 s under load here; same cases and sizes
});

describe("T321 K2 box start, today's tooling", () => {
  // Plant: inspect only the current branch's links, or block on any branch that shares the
  // ticket. Main and this box's branch are allowed; another branch blocks only while it is live,
  // and an older branch whose links the base already holds never does. Plant: walk from main.
  // Plant: block on an open branch whose only change is field/*.jsonl rows, or row files (0090).
  it("K2 refuses a shared ticket only when another live branch carries its links", () => {
    const places = [
      "main",
      "this",
      "open-pr",
      "running-box",
      "history",
      "merged",
      "gh-down",
      "different-ticket",
      "inside",
      "field-rows",
      "field-files",
    ] as const;
    const blocks = new Set(["open-pr", "running-box", "gh-down"]);
    fc.assert(
      fc.property(word, (text) => {
        each(places, (place) =>
          fixture((b) => {
            b.git(b.main, "checkout", "-q", place === "main" ? "main" : b.branch);
            const other = !["main", "this", "inside"].includes(place);

            if (other) {
              b.git(b.main, "checkout", "-q", "-b", "fabrikalfa/other");
            }

            // Lead-only field rows on an open PR are not a lane (PR 601, 2026-11-09).
            const path =
              place === "field-rows"
                ? "field/runs.jsonl"
                : place === "field-files"
                  ? "field/runs/2026-11-11-t321-tests1.json"
                  : "src/a.ts";
            const rows = place === "field-rows" || place === "field-files";
            const sha = b.commit(b.main, path, `${text}\n`);
            b.sign(b.main, rows ? "lead" : "tests", place === "different-ticket" ? "322" : "321");

            if (place === "main" || place === "merged") {
              b.git(b.main, "update-ref", "refs/remotes/origin/main", sha);
            }

            // An older branch of this lane that the base already holds is history (#590).
            if (place === "inside") {
              b.git(b.main, "branch", "fabrikalfa/old", sha);
            }

            b.setup({
              openPrs: ["open-pr", "field-rows", "field-files"].includes(place)
                ? ["fabrikalfa/other"]
                : ["fabrikalfa/unrelated"],
              ...(place === "gh-down" ? { gh: "down" as const } : {}),
            });

            if (place === "running-box") {
              write(join(b.boxes, "state/two.box"), "ticket: 321\nbranch: fabrikalfa/other\n");
              mkdirSync(join(b.boxes, "two"));
            }

            if (place === "history") {
              // A box state left behind with no box on disk is not a running lane.
              write(join(b.boxes, "state/two.box"), "ticket: 321\nbranch: fabrikalfa/other\n");
            }

            b.git(b.main, "checkout", "-q", "main");
            const got =
              place === "inside"
                ? b.new(sha, b.branch)
                : b.new("origin/main", place === "this" ? b.branch : "fabrikalfa/new");
            expect(got.code).not.toBeNull();

            // A live branch is the check saying no; open PRs gh cannot read is a check that
            // could not run, which stays stuck (ticket 428).
            if (place === "gh-down") {
              refused(got, /^stuck shared_ticket 321 on fabrikalfa\/other: open PRs cannot be read/m);
              expect(got.code, got.text).toBe(1);
            } else if (blocks.has(place)) {
              checkRefused(got, "shared_ticket", /321 on fabrikalfa\/other/);
            } else {
              expect(got.code, got.text).toBe(0);
            }
          }),
        );
      }),
      options,
    );
  }, 180_000); // about 51 s alone on CI, over 60 s on a busy shard (#598); same cases

  // Plant: walk each branch by its name again after listing it (box.sh before ticket 567). A branch
  // deleted during the scan then fails the start as "stuck base commit walk failed" with no reason,
  // as layout-tests3 and layout-tests6 did on 2026-11-10. Both branches carry the ticket, so the scan
  // walks both, and neither is live.
  it("K2 scenario: a branch deleted while the shared-ticket scan runs does not fail the start", () => {
    fixture((b) => {
      for (const name of ["fabrikalfa/aa-first", "fabrikalfa/zz-gone"]) {
        b.git(b.main, "checkout", "-q", "-b", name, b.base);
        b.commit(b.main, "src/b.ts", `${name}\n`);
        b.sign(b.main, "tests", "321");
      }

      b.git(b.main, "checkout", "-q", "main");
      b.setup({ openPrs: [], dropOnWalk: "refs/heads/fabrikalfa/zz-gone" });
      const got = b.new();
      expect(existsSync(join(b.dir, "dropped")), "the fake git deleted the branch mid-scan").toBe(true);
      expect(got.code, got.text).toBe(0);
    });
  });

  // Plant: read only each branch tip's note, walk each branch with its own rev-list again, or list
  // every branch when no link is found (ticket 673: the per-branch walk took 128 s on 1,655
  // branches). A link two commits under a live branch's tip still blocks, a malformed note and a
  // note on another ticket count for nothing, and the scan asks git for the branches once.
  it("K2 scenario: the batched scan finds a link under a live branch's tip in one branch listing", () => {
    fixture((b) => {
      b.git(b.main, "checkout", "-q", "-b", "fabrikalfa/noise", b.base);
      b.commit(b.main, "src/c.ts", "noise\n");
      b.git(b.main, "notes", "--ref=fabrika", "add", "-m", "not json {", "HEAD");
      b.commit(b.main, "src/d.ts", "other ticket\n");
      b.sign(b.main, "tests", "322");
      b.git(b.main, "checkout", "-q", "-b", "fabrikalfa/other", b.base);
      b.commit(b.main, "src/a.ts", "linked\n");
      b.sign(b.main, "tests", "321");
      b.commit(b.main, "src/e.ts", "after one\n");
      b.commit(b.main, "src/f.ts", "after two\n");
      b.git(b.main, "checkout", "-q", "main");
      b.setup({ openPrs: ["fabrikalfa/other", "fabrikalfa/noise"] });
      const got = b.new();
      checkRefused(got, "shared_ticket", /321 on fabrikalfa\/other/);
      const listings = b.calls().filter((c) => c.cmd === "git" && c.args.some((a) => a.startsWith("--contains=")));
      expect(listings.length).toBe(1);
      expect(b.calls().some((c) => c.cmd === "git" && c.args.includes("rev-list"))).toBe(false);
    });
  });

  // format: box.sh new prints one `phase <name> <ms>` line per start phase, which drive reads from
  // the box's log (ticket 673).
  it("K2 format: a made box prints its start phases in order", () => {
    fixture((b) => {
      b.setup({ openPrs: [] });
      const got = b.new();
      expect(got.code, got.text).toBe(0);
      expect([...got.text.matchAll(/^phase ([a-z_]+) \d+$/gm)].map((m) => m[1])).toEqual([
        "box_plancheck_fetch",
        "box_scan",
        "box_clone",
        "box_install",
      ]);
    });
  });

  // Plant: drop git's stderr from a failed git call's refusal.
  it("K2 scenario: a git call that fails names git's own words in its stuck line", () => {
    fixture((b) => {
      const got = b.new("fabrikalfa/no-such-branch");
      refused(got, /^stuck unknown ref fabrikalfa\/no-such-branch: fatal: Needed a single revision/m);
    });
  });

  // Plant: judge a field-rows branch by its diff from the lane's base, not from main. A lane that
  // started on an older main then sees main's newer files on the rows branch and refuses
  // (projectwin build on ticket 276 beside field-rows PR 601, 2026-11-09).
  it("K2 scenario: a rows-only branch on a newer main does not block a lane on an older one", () => {
    fixture((b) => {
      b.git(b.main, "checkout", "-q", b.branch);
      const lane = b.commit(b.main, "src/a.ts", "lane work\n");
      b.git(b.main, "checkout", "-q", "main");
      const newer = b.commit(b.main, "src/b.ts", "main moved on\n");
      b.git(b.main, "update-ref", "refs/remotes/origin/main", newer);
      b.git(b.main, "checkout", "-q", "-b", "fabrikalfa/other");
      b.commit(b.main, "field/runs.jsonl", "{}\n");
      b.sign(b.main, "lead", "321");
      b.setup({ openPrs: ["fabrikalfa/other"] });
      b.git(b.main, "checkout", "-q", "main");
      const got = b.new(lane, b.branch);
      expect(got.code, got.text).toBe(0);
    });
  });

  // Plant: drop --root, save the base as the root, or accept a root the base does not hold.
  it("K2 saves the lane's root only when the base holds it", () => {
    fc.assert(
      fc.property(word, (text) => {
        each(["none", "held", "elsewhere"] as const, (root) =>
          fixture((b) => {
            b.git(b.main, "checkout", "-q", b.branch);
            const head = b.commit(b.main, "src/a.ts", `${text}\n`);
            b.git(b.main, "checkout", "-q", "-b", "fabrikalfa/side", "main");
            const side = b.commit(b.main, "src/b.ts", `${text}\n`);
            b.git(b.main, "checkout", "-q", "main");
            const extra = root === "none" ? [] : ["--root", root === "held" ? b.base : side];
            const got = b.call("sh", [
              program,
              "new",
              "new",
              head,
              b.branch,
              "--ticket",
              "321",
              "--plan",
              b.plan,
              ...extra,
            ]);

            if (root === "elsewhere") {
              checkRefused(got, "root_not_ancestor", /root is not an ancestor/);
              return;
            }

            expect(got.code, got.text).toBe(0);
            const state = readFileSync(join(b.boxes, "state/new.box"), "utf8");
            expect(state).toContain(`base: ${head}`);

            if (root === "held") {
              expect(state).toContain(`root: ${b.base}`);
            } else {
              expect(state).not.toContain("root:");
            }
          }),
        );
      }),
      options,
    );
  });

  // Plant: accept any parent head, any role or any signer, rather than a verified build or lead link.
  // layers and themes, 2026-11-09: a signed lead commit (a merge of main, a lockfile) was refused.
  // Plant: require main's tip, not any commit main holds. Eight of nine base_not_signed refusals on
  // 2026-11-09 were a lane's plan base, an older main, after main moved on (ticket 428).
  it("K2 accepts any commit origin/main holds or a verified parent build or lead head and records checked facts", () => {
    fc.assert(
      fc.property(word, (text) => {
        each(["main", "older-main", "build", "lead", "unsigned", "tests", "forged"], (kind) =>
          fixture((b) => {
            b.git(b.main, "checkout", "-q", "-b", "fabrikalfa/parent");
            const parent = b.commit(b.main, "src/b.ts", `${text}\n`);

            if (kind === "build" || kind === "tests" || kind === "lead") {
              b.sign(b.main, kind, "300");
            }

            if (kind === "forged") {
              b.git(
                b.main,
                "notes",
                "--ref=fabrika",
                "add",
                "-m",
                '{"step":"build","ticket":"300","sig":"fake"}',
                parent,
              );
            }

            b.git(b.main, "checkout", "-q", "main");

            // main moves on; box.sh new's own fetch of origin then sees the newer tip.
            if (kind === "older-main") {
              b.commit(b.main, "src/old.ts", `${text} newer\n`);
            }

            const onMain = kind === "main" || kind === "older-main";
            const got = b.new(kind === "main" ? "origin/main" : kind === "older-main" ? b.base : parent);
            expect(got.code).not.toBeNull();

            if (onMain || kind === "build" || kind === "lead") {
              expect(got.code, got.text).toBe(0);
              expect(existsSync(join(b.boxes, "state/new.box")), "new must save its checked facts").toBe(true);
              const state = readFileSync(join(b.boxes, "state/new.box"), "utf8");
              expect(state).toContain(`base: ${onMain ? b.base : parent}`);
              expect(state).toContain(`plan-sha256: ${hash(body())}`);
              expect(state).toContain("ticket: 321");

              if (onMain) {
                expect(state).toContain("parent: none");
              } else {
                expect(state).toContain(`fabrikalfa/parent@${parent}`);
              }
            } else {
              checkRefused(got, "base_not_signed");
            }
          }),
        );
      }),
      options,
    );
  });

  // Plants: skip the approval hash or hash line one too; accept a branch without the prefix.
  it("K2 rejects bad branch names, unsigned plans and byte edits anywhere in the approved body", () => {
    fc.assert(
      fc.property(word, fc.constantFrom("\n", "\r\n", "猫"), (text, ending) => {
        each(["branch", "unsigned", "body", "amendment", "renewed"], (fault) =>
          fixture((b) => {
            const original = `${body()}\n## Amendment 1\n${text}${ending}`;
            let plan = approve(original);

            if (fault === "unsigned") {
              plan = `\nPlancheck-Version: 2\n${original}`;
            }

            if (fault === "body") {
              plan = plan.replace(text, `${text}changed`);
            }

            if (fault === "amendment") {
              plan += "\n## Amendment 2\nChanged.\n";
            }

            if (fault === "renewed") {
              plan = approve(`${original}\n## Amendment 2\nChanged.\n`);
            }

            write(b.plan, plan);
            const got = b.new("origin/main", fault === "branch" ? "other/new" : "fabrikalfa/new");
            expect(got.code).not.toBeNull();

            if (fault === "renewed") {
              expect(got.code, got.text).toBe(0);
            } else if (fault === "branch") {
              refused(got, /branch|prefix/);
            } else {
              checkRefused(got, "plan_unapproved", /plan|approval|hash|body/);
            }
          }),
        );
      }),
      options,
    );
  });
});

describe("T321 review round 1 fixes, today's tooling", () => {
  // Plant: merge the box's notes ref, so a note the box deleted is dropped from MAIN.
  // Review round 1, finding 3.
  it("K1 scenario: a note the box deleted stays in MAIN, and the linked commit is not signed again", () => {
    fixture((b) => {
      b.setup({ operations: [{ path: "src/a.ts", text: "linked\n" }] });
      expect(b.run().code).toBe(0);
      const first = b.fetch();
      expect(first.code, first.text).toBe(0);
      const linked = b.notes();
      const sha = b.head(b.main, b.branch);
      expect(linked).toContain(sha);
      const note = b.git(b.main, "notes", "--ref=fabrika", "show", sha);
      b.git(b.work, "fetch", "-q", b.main, "refs/notes/fabrika:refs/notes/fabrika");
      b.git(b.work, "notes", "--ref=fabrika", "remove", sha);
      b.call("sh", [program, "fetch", "one", b.branch], b.main, { ...b.env, T321_FETCH: "1" });
      expect(b.notes()).toContain(sha);
      expect(b.git(b.main, "notes", "--ref=fabrika", "show", sha)).toBe(note);
      const again = b.fetch();
      expect(
        b
          .notes()
          .split("\n")
          .filter((l) => l.endsWith(sha)),
      ).toHaveLength(1);
      expect(again.text).not.toMatch(/sign failed/);
    });
  });

  // Plant: compare every note the box holds, not only its run's commits. Themes and layers tests
  // (2026-11-09) were stuck at fetch after MAIN re-signed another branch's commit mid-run.
  it("K1 scenario: MAIN re-signing a commit outside the run after box start does not stop the fetch", () => {
    fixture((b) => {
      b.git(b.main, "checkout", "-q", "-b", "other");
      const outside = b.commit(b.main, "src/b.ts", "other\n");
      b.sign(b.main, "tests");
      b.git(b.main, "checkout", "-q", "main");
      // The box copies MAIN's notes at start, as box.sh new does.
      b.git(b.work, "fetch", "-q", b.main, "refs/notes/fabrika:refs/notes/fabrika");
      b.git(b.main, "notes", "--ref=fabrika", "add", "-f", "-m", "re-signed in MAIN", outside);
      b.setup({ operations: [{ path: "src/a.ts", text: "run\n" }] });
      expect(b.run().code).toBe(0);
      const got = b.fetch();
      expect(got.code, got.text).toBe(0);
      expect(got.text).not.toMatch(/conflict/);
      expect(b.git(b.main, "notes", "--ref=fabrika", "show", outside).trim()).toBe("re-signed in MAIN");
      expect(b.notes()).toContain(b.head(b.main, b.branch));
    });
  });

  // Plants: refuse on every stale link; waive a stale link of a step the lane signed. Themes tests4
  // (2026-11-09) stopped at fetch on stale_link lead: PR 565 had a lead link on ticket 343.
  it("K1 scenario: a stale link only for a step the lane has not signed does not stop the fetch", () => {
    each(["lead", "tests"] as const, (step) =>
      fixture((b) => {
        const stale = JSON.stringify({ _tag: "stuck", reason: "stale_link", sha: "head", step });
        const ask = JSON.stringify({ _tag: "ask", to: "owner", for: "exam_read", paths: [] });
        b.setup({
          operations: [{ path: "src/a.ts", text: "run\n" }],
          check: { status: 1, text: `${stale}\n${ask}\n` },
        });
        expect(b.run().code).toBe(0);
        const got = b.fetch();

        if (step === "tests") {
          refused(got, /commits check failed/);
        } else {
          expect(got.code, got.text).toBe(0);
          expect(got.text).toContain("stale_link_outside_lane");
        }
      }),
    );
  });

  // Plants: hand the checker the lane's root, or the merge-base even when it does not hold the root.
  // Layers tests10 (2026-11-09): after a lead merge of main, main's own commits sat in root..head.
  it("K1 scenario: main's commits after the lane's root are not judged as the lane's", () => {
    each(["main-moved", "root-off-main"] as const, (kind) =>
      fixture((b) => {
        const moved = b.commit(b.main, "src/b.ts", "main moved\n");
        b.git(b.main, "update-ref", "refs/remotes/origin/main", moved);
        b.git(b.work, "fetch", "-q", b.main, moved);
        b.git(b.work, "reset", "-q", "--hard", moved);
        let start = moved;

        if (kind === "root-off-main") {
          start = b.commit(b.work, "src/old.ts", "off main\n");
          b.git(b.main, "fetch", "-q", b.work, start);
        }

        b.state(start);
        const root = kind === "main-moved" ? b.base : start;
        appendFileSync(join(b.boxes, "state/one.box"), `root: ${root}\n`);
        b.setup({ operations: [{ path: "src/a.ts", text: "tested\n" }] });
        expect(b.run().code).toBe(0);
        const got = b.fetch();
        expect(got.code, got.text).toBe(0);
        const check = b.calls().find((c) => c.cmd === "pnpm" && c.args[0] === "commits" && c.args[1] === "check");
        expect(check?.args[check.args.indexOf("--base") + 1]).toBe(start);
      }),
    );
  });

  // One lane, end to end on the real checker: a signed tests step, main moves, the lead merges main
  // in (signed as `lead`, or not, or with another commit's link), main may move again, and the next
  // step's box starts at the lane head with the first step's root saved.
  const afterLeadMerge = (b: Box, lead: "signed" | "unsigned" | "foreign", movedAgain: boolean) => {
    b.setup({ operations: [{ path: "src/a.ts", text: "first tests\n" }] });
    expect(b.run().code).toBe(0);
    const first = b.fetch();
    expect(first.code, first.text).toBe(0);
    const moved = b.commit(b.main, "src/b.ts", "main moved\n");
    b.git(b.main, "update-ref", "refs/remotes/origin/main", moved);
    b.git(b.main, "checkout", "-q", b.branch);
    b.git(b.main, "merge", "-q", "--no-ff", "-m", "lead merge of main", "main");

    if (lead === "signed") {
      b.sign(b.main, "lead", "321");
    } else if (lead === "foreign") {
      // The signer refuses a key allowed_signers lacks, so the foreign link is the first step's own
      // valid link, replayed onto the merge: trusted key, wrong trees.
      const lifted = b.git(b.main, "notes", "--ref=fabrika", "list", `${b.branch}^1`).trim();
      b.git(b.main, "notes", "--ref=fabrika", "add", "-C", lifted, "HEAD");
    }

    const merged = b.head(b.main);
    b.git(b.main, "checkout", "-q", "main");

    if (movedAgain) {
      b.git(b.main, "update-ref", "refs/remotes/origin/main", b.commit(b.main, "src/old.ts", "main moved again\n"));
    }

    b.git(b.work, "fetch", "-q", b.main, `${b.branch}:refs/remotes/lane`, "refs/notes/fabrika:refs/notes/fabrika");
    b.git(b.work, "reset", "-q", "--hard", merged);
    b.state(merged);
    appendFileSync(join(b.boxes, "state/one.box"), `root: ${b.base}\n`);
    b.setup({ operations: [{ path: "src/a.ts", text: "second tests\n" }] });
    expect(b.run().code).toBe(0);
    return b.fetch();
  };

  // Plants: check from the box base, from the saved root, or without main's merge-base. 13 fetches
  // on lane p12 (2026-11-09) stopped after a signed lead merge of main (tickets 545, 662).
  it("K1 scenario: a lane caught up with main by a signed lead merge passes the next step's fetch", () => {
    each([false, true], (movedAgain) =>
      fixture((b) => {
        const got = afterLeadMerge(b, "signed", movedAgain);
        expect(got.code, got.text).toBe(0);
        expect(got.text).not.toMatch(/"_tag":"stuck"/);
      }),
    );
  });

  // Plant: pass any merge commit, or any note that verifies somewhere. The law that must not get
  // weaker: a merge nobody signed, or one carrying a link made for another commit, stops fetch.
  it("K1 scenario: an unsigned or foreign lead merge still stops the next step's fetch", () => {
    each(["unsigned", "foreign"] as const, (lead) =>
      fixture((b) => {
        refused(afterLeadMerge(b, lead, false), /commits check failed: (unsigned_commit|unlinked_commit) [0-9a-f]{8}/);
      }),
    );
  });

  // Plants: say only "commits check failed"; drop the commit, the step or the count past five.
  // 18 fetches on 2026-11-09 stopped with no rule named, so nobody knew where to send them (T429).
  it("K1 the fetch refusal names each rule and commit that held it, five at most", () => {
    const rule = fc.constantFrom("unsigned_commit", "build_touched_exam", "broken_chain", "stale_link");
    // A stale link holds only for a step the lane signed (tests, here); others are waived.
    const answer = fc
      .record({
        reason: rule,
        sha: fc.stringMatching(/^[0-9a-f]{40}$/),
        step: fc.option(fc.constantFrom("tests", "build"), { nil: undefined }),
      })
      .map((a) => (a.reason === "stale_link" ? { ...a, step: "tests" as const } : a));
    fc.assert(
      fc.property(fc.array(answer, { minLength: 1, maxLength: 7 }), (answers) =>
        fixture((b) => {
          const lines = answers.map((a) => JSON.stringify({ _tag: "stuck", ...a }));
          b.setup({
            operations: [{ path: "src/a.ts", text: "run\n" }],
            check: { status: 1, text: `${lines.join("\n")}\n` },
          });
          expect(b.run().code).toBe(0);
          const got = b.fetch();
          expect(got.code, got.text).toBe(1);
          const said = answers.map((a) => `${a.reason} ${a.sha.slice(0, 8)}${a.step ? ` step ${a.step}` : ""}`);
          const more = said.length > 5 ? `; and ${said.length - 5} more` : "";
          expect(got.text.trim().split("\n").at(-1)).toBe(
            `stuck commits check failed: ${said.slice(0, 5).join("; ")}${more}`,
          );
        }),
      ),
      { seed: 429, numRuns: 4, endOnFailure: true },
    );
  }, 180_000);

  // Plant: trust the installed checker's scope skip. Review round 1, finding 4.
  it("K1 scenario: an unsigned commit outside the exam list is refused on a plain fetch", () => {
    fixture((b) => {
      b.setup({ operations: [{ path: "src/b.ts", text: "unsigned\n" }] });
      expect(b.run().code).toBe(0);
      const got = b.call("sh", [program, "fetch", "one", b.branch], b.main, {
        ...b.env,
        T321_FETCH: "1",
      });
      refused(got, /commits check failed: unlinked_commit [0-9a-f]{8}/);
    });
  });

  // Plant: drop every answer when one line is unreadable. Review round 1, finding 11.
  it("K1 scenario: a valid stuck answer before a bad line is still printed", () => {
    fixture((b) => {
      b.setup({
        operations: [{ path: "src/a.ts", text: "answer\n" }],
        check: { status: 1, text: '{"_tag":"stuck","reason":"fixture_reason"}\nnot json\nnull\n' },
      });
      expect(b.run().code).toBe(0);
      const got = b.fetch();
      refused(got, /unreadable/);
      expect(got.text).toContain("fixture_reason");
    });
  });

  // Plants: accept only origin/main or a parent build head, or treat the lane's own -wip backup
  // as another open branch. drive.ts starts one box per step on the lane's branch, so the next
  // box starts at that branch's tests head.
  it("K2 scenario: a new box may continue its own branch beside its -wip backup", () => {
    fixture((b) => {
      b.setup({ operations: [{ path: "src/a.ts", text: "tested\n" }] });
      expect(b.run().code).toBe(0);
      const fetched = b.fetch();
      expect(fetched.code, fetched.text).toBe(0);
      const head = b.head(b.main, b.branch);
      b.git(b.main, "update-ref", `refs/heads/${b.branch}-wip`, head);
      const started = b.call("sh", [program, "new", "two", head, b.branch, "--ticket", "321", "--plan", b.plan]);
      expect(started.code, started.text).toBe(0);
      const state = readFileSync(join(b.boxes, "state/two.box"), "utf8");
      expect(state).toContain(`base: ${head}`);
    });
  });

  // Plant: check the approval digest only at new. Review round 1, finding 6.
  it("K2 scenario: a run refuses a plan amended after approval", () => {
    fixture((b) => {
      writeFileSync(b.plan, `${readFileSync(b.plan, "utf8")}\n## Amendment\nUnsigned.\n`);
      const got = b.run("tests");
      refused(got, /hash mismatch|approval/);
      expect(b.calls().some((c) => c.cmd === "codex")).toBe(false);
    });
  });
});

describe("T321 K3 step order and rows, today's tooling", () => {
  // Plant: count tests from before base, or any unverified note; skip review's mutation row; read
  // only the box's own rows, not the lane's where drive writes them (review boxes, 2026-11-09); read
  // from the box's base when the lane's root is saved (layers build, 2026-11-09: each step's box
  // starts at the last step's head, so its tests link sat before that box's base).
  it("K3 gates build on a verified tests link since base and review on mutation or a recorded skip", () => {
    fc.assert(
      fc.property(word, (text) => {
        each(
          [
            "absent",
            "before-base",
            "since-root",
            "bad-note",
            "tests",
            "review-absent",
            "mutation",
            "skip",
            "lane-row",
            "lane-row-skip",
            "lane-row-stuck",
          ],
          (kind) =>
            fixture((b) => {
              if (["before-base", "since-root", "bad-note", "tests"].includes(kind)) {
                const sha = b.commit(b.work, "src/a.ts", `${text}\n`);

                if (kind === "bad-note") {
                  b.git(b.work, "notes", "--ref=fabrika", "add", "-m", '{"step":"tests"}', sha);
                } else {
                  b.sign(b.work, "tests");
                }

                b.git(
                  b.main,
                  "fetch",
                  "-q",
                  b.work,
                  `${b.branch}:${b.branch}`,
                  "refs/notes/fabrika:refs/notes/fabrika",
                );

                if (kind === "before-base") {
                  b.state(sha);
                }

                if (kind === "since-root") {
                  b.state(sha);
                  appendFileSync(join(b.boxes, "state/one.box"), `root: ${b.base}\n`);
                }
              }

              if (kind === "mutation" || kind === "skip") {
                write(
                  join(b.boxes, "state/one.rows.jsonl"),
                  `${JSON.stringify({
                    run: "mutation-321",
                    ticket: "321",
                    step: "mutation",
                    role: "mutation",
                    outcome: kind === "skip" ? "skip" : "done",
                    why: "recorded fixture result",
                  })}\n`,
                );
              }

              if (kind.startsWith("lane-row")) {
                // Where drive writes a step's row: BOXES/<lane>-rows.jsonl, not the box's own.
                appendFileSync(join(b.boxes, "state/one.box"), "lane: onelane\n");
                write(
                  join(b.boxes, "onelane-rows.jsonl"),
                  `${JSON.stringify({
                    run: "t321-mutation1",
                    ticket: "321",
                    role: "hand",
                    step: "mutation",
                    // drive writes `skip` for a mutation step that answered skip (ticket 423).
                    outcome: { "lane-row": "pass", "lane-row-skip": "skip" }[kind] ?? "stopped",
                    why: "drive.ts mutation fixture row",
                  })}\n`,
                );
              }

              const review = [
                "review-absent",
                "mutation",
                "skip",
                "lane-row",
                "lane-row-skip",
                "lane-row-stuck",
              ].includes(kind);
              const pass = ["tests", "since-root", "mutation", "skip", "lane-row", "lane-row-skip"].includes(kind);
              const got = b.run(review ? "review" : "build");
              expect(got.code).not.toBeNull();

              if (pass) {
                expect(got.code, got.text).toBe(0);
              } else {
                refused(got, /step_out_of_order|tests|mutation/);
                expect(b.calls().filter((c) => c.cmd === "codex")).toEqual([]);
              }
            }),
        );
      }),
      options,
    );
  });

  // Plant: count dead pid files as live; omit the eighth-slot cap.
  it("K3 refuses a ninth live box, ignores dead pid files and frees finished slots", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 9 }), (count) =>
        fixture((b) => {
          for (let i = 0; i < count; i++) {
            write(join(b.boxes, `state/live-${i}.pid`), `${process.pid}\n`);
          }

          for (let i = 0; i < 3; i++) {
            write(join(b.boxes, `state/dead-${i}.pid`), "2147483647\n");
          }

          const got = b.run();

          if (count >= 8) {
            refused(got, /slot|running|limit/);
            expect(b.calls().filter((c) => c.cmd === "codex")).toEqual([]);
          } else {
            expect(got.code, got.text).toBe(0);
            expect(b.rows()).toHaveLength(1);
          }

          expect(readdirSync(join(b.boxes, "state")).filter((n) => n === "one.pid")).toEqual([]);

          for (let i = 0; i < count; i++) {
            rmSync(join(b.boxes, `state/live-${i}.pid`), { force: true });
          }

          expect(b.run().code).toBe(0);
          const rows = b.rows();
          expect(rows).toHaveLength(count >= 8 ? 1 : 2);
          expect(new Set(rows.map((row) => row.run)).size).toBe(rows.length);
        }),
      ),
      // pinned: the slot-cap off-by-one plant (a ninth box let through at exactly 8 live) and
      // the empty-state plant (a stale pid file counted as live at 0).
      { ...options, examples: [[8], [0]] },
    );
  });

  // Plants: drop failed/missing-usage runs, leave a pid behind, or append a row on every fetch.
  it("K3 every exit saves one run with bounds, status and nullable usage; collection is idempotent", () => {
    fc.assert(
      fc.property(fc.record({ exit: fc.constantFrom(0, 7), signal: fc.boolean(), usage: fc.boolean() }), (setup) =>
        fixture((b) => {
          const start = b.commit(b.work, "src/a.ts", "before this run\n");
          b.sign(b.work, "tests");
          b.git(b.main, "fetch", "-q", b.work, `${b.branch}:${b.branch}`, "refs/notes/fabrika:refs/notes/fabrika");
          b.setup(setup);
          const got = b.run();
          expect(got.code, got.text).toBe(setup.signal ? 143 : setup.exit);
          const rows = b.rows();
          expect(rows).toHaveLength(1);
          expect(rows[0]).toMatchObject({
            ticket: "321",
            step: "tests",
            outcome: setup.signal || setup.exit ? "stuck" : "done",
          });
          expect(rows[0]!.run).toEqual(expect.any(String));
          expect(rows[0]!.started).toEqual(expect.any(String));
          expect(rows[0]!.ended).toEqual(expect.any(String));
          expect(rows[0]!.billed).toBe(setup.usage ? 110 : null);
          const state = readFileSync(join(b.boxes, "state/one.box"), "utf8");
          expect(state).toContain(start);
          expect(state).toContain(String(rows[0]!.run));
          expect(state).toContain("tests");
          expect(existsSync(join(b.boxes, "state/one.pid"))).toBe(false);
          b.fetch();
          b.fetch();
          expect(b.rows()).toEqual(rows);
        }),
      ),
      {
        ...options,
        // pinned: the dropped-row plants: no row for a failed run with no usage, or for an
        // interrupted run that exited 0.
        examples: [[{ exit: 7, signal: false, usage: false }], [{ exit: 0, signal: true, usage: true }]],
      },
    );
  });

  // Plant: reset usage totals at each completed turn, retaining only the last turn.
  it("K3 fieldrow sums usage across completed turns and ignores partial events", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            fresh: fc.integer({ min: 1, max: 100_000 }),
            cached: fc.integer({ min: 0, max: 50_000 }),
            output: fc.integer({ min: 0, max: 50_000 }),
          }),
          { minLength: 2, maxLength: 5 },
        ),
        (turns) => {
          const dir = mkdtempSync(join(tmpdir(), "row321-"));

          try {
            const events = join(dir, "events.jsonl");
            const lines = turns.map((turn) =>
              JSON.stringify({
                type: "turn.completed",
                usage: {
                  input_tokens: turn.fresh + turn.cached,
                  cached_input_tokens: turn.cached,
                  output_tokens: turn.output,
                },
              }),
            );
            lines.splice(1, 0, "partial{", '{"type":"item.completed"}');
            lines.push('{"type":"turn.completed","usage":{"input_tokens":999}}');
            writeFileSync(events, `${lines.join("\n")}\n`);
            const got = spawnSync(
              "python3",
              [
                join(import.meta.dirname, "fieldrow.py"),
                "--model",
                "gpt-6.1-sol",
                events,
                "multi-turn",
                "321",
                "done",
                "test usage",
              ],
              {
                encoding: "utf8",
                timeout: 5_000,
                env: { HOME: dir, PATH: `${dirname(process.execPath)}:/usr/bin:/bin` },
              },
            );
            expect(got.error).toBeUndefined();
            expect(got.status, got.stderr).toBe(0);
            const input = turns.reduce((sum, turn) => sum + turn.fresh + turn.cached, 0);
            const cached = turns.reduce((sum, turn) => sum + turn.cached, 0);
            const output = turns.reduce((sum, turn) => sum + turn.output, 0);
            expect(JSON.parse(got.stdout)).toMatchObject({
              inputTokens: input,
              cachedTokens: cached,
              outputTokens: output,
              billed: input + output,
              tokens: null,
            });
          } finally {
            rmSync(dir, { recursive: true, force: true });
          }
        },
      ),
      { seed: 119120, numRuns: 4, endOnFailure: true },
    );
  });

  // Plant: trap only a normal child exit and lose the row or slot on a runner signal.
  it("K3 SIGTERM releases the slot and records the interrupted run without usage", async () => {
    await fc.assert(
      fc.asyncProperty(fc.boolean(), async (usage) => {
        const b = new Box();

        try {
          b.setup({ hold: true, usage });
          const got = await signalRun(b);
          expect(got.code === 143 || got.signal === "SIGTERM").toBe(true);
          expect(b.rows()).toHaveLength(1);
          expect(b.rows()[0]).toMatchObject({
            ticket: "321",
            step: "tests",
            outcome: "stuck",
            billed: usage ? 110 : null,
          });
          expect(existsSync(join(b.boxes, "state/one.pid"))).toBe(false);
        } finally {
          b.close();
        }
      }),
      { ...options, numRuns: 2 },
    );
  });
});

describe("T321 K19 box and plan runners, today's tooling", () => {
  // Plant: let the read-only planner run with workspace-write access.
  it("K19 plan writer remains read-only in the main checkout", () => {
    fc.assert(
      fc.property(word, (name) =>
        fixture((b) => {
          const got = b.call("sh", [join(import.meta.dirname, "runplan.sh"), name, join(b.dir, "prompt")]);
          expect(got.code, got.text).toBe(0);
          const calls = b.calls().filter((call) => call.cmd === "codex");
          expect(calls).toHaveLength(1);
          const args = calls[0]!.args;
          expect(args[args.indexOf("-s") + 1]).toBe("read-only");
          expect(args[args.indexOf("-C") + 1]).toBe(b.main);
          expect(args).toContain("--ignore-user-config");
        }),
      ),
      { ...options, seed: 119120 },
    );
  });

  // [secrets] Plants: match names case-sensitively, leak any config layer, skip either output
  // on a failed or signaled run. Values are made up and never taken from the parent environment.
  it.each(["box", "plan"])(
    "K19 %s sanitizes children and redacts both outputs on success, failure and signal",
    (runner) => {
      fc.assert(
        fc.property(
          fc.record({
            value: word,
            lower: fc.boolean(),
            exit: fc.constantFrom(0, 7),
            signal: fc.boolean(),
          }),
          ({ value, lower, exit, signal }) => {
            fixture((b) => {
              const secrets = [
                `npm_${value.repeat(36).slice(0, 36)}`,
                `ghp_${value.repeat(36).slice(0, 36)}`,
                `sk-${value.repeat(48).slice(0, 48)}`,
                `private-${value}-pass`,
              ];

              for (const name of [
                "MY_TOKEN",
                "SERVICE_SECRET",
                "MY_KEY",
                "DB_PASSWORD",
                "HTTP_AUTH",
                "NPM_CONFIG_AUTH",
              ]) {
                b.env[lower ? name.toLowerCase() : name] = secrets[3];
              }

              for (const [file, token] of [
                [join(b.home, ".npmrc"), secrets[0]],
                [join(b.dir, "global.npmrc"), secrets[1]],
                [join(runner === "box" ? b.work : b.main, ".npmrc"), secrets[2]],
              ]) {
                write(file!, `//registry.example.test/:_authToken=${token}\n`);
              }

              b.env.NPM_CONFIG_GLOBALCONFIG = join(b.dir, "global.npmrc");
              b.setup({ secrets, exit, signal });
              const got =
                runner === "box"
                  ? b.run()
                  : b.call("sh", [join(import.meta.dirname, "runplan.sh"), "one", join(b.dir, "prompt")]);
              expect(got.code).toBe(signal ? 143 : exit);
              const seen = JSON.parse(readFileSync(join(b.dir, "observed.json"), "utf8"));
              expect(seen.envLeaks, "secret-shaped env names reached the child").toBe(0);
              expect(seen.authLeaks, "auth settings reached the child").toBe(0);
              expect(seen.home === b.home, "HOME must stay set").toBe(true);
              expect(seen.path === b.env.PATH, "PATH must stay set").toBe(true);
              const answer = runner === "box" ? join(b.dir, "answer") : join(b.boxes, "one-plan.md");
              const events = runner === "plan" ? readFileSync(join(b.boxes, "one-plan.jsonl"), "utf8") : got.text;

              for (const output of [readFileSync(answer, "utf8"), events]) {
                for (const secret of secrets) {
                  expect(output.includes(secret)).toBe(false);
                  expect(output.includes(encodeURIComponent(secret))).toBe(false);
                }

                expect(output).toContain("[redacted]");
              }
            });
          },
        ),
        {
          ...options,
          // pinned: the case-sensitive secret-name plant (a lowercase name kept its value)
          // and the interrupted-run plant (a signal skipped the scrub).
          examples: [
            [{ value: "madeup", lower: true, exit: 7, signal: false }],
            [{ value: "madeup", lower: false, exit: 0, signal: true }],
          ],
        },
      );
    },
  );

  // [secrets] Plant: redact only when Codex returns normally, leaving outputs on SIGTERM.
  it.each(["box", "plan"] as const)(
    "K19 %s redacts answer and events before a signaled runner returns",
    async (runner) => {
      await fc.assert(
        fc.asyncProperty(word, async (value) => {
          const b = new Box();

          try {
            const secret = `npm_${value.repeat(40).slice(0, 36)}`;
            b.env.PLANTED_TOKEN = secret;
            b.setup({ hold: true, secrets: [secret], usage: false });
            const got = await signalRun(b, runner);
            expect(got.code === 143 || got.signal === "SIGTERM").toBe(true);
            const answer = runner === "box" ? join(b.dir, "answer") : join(b.boxes, "one-plan.md");
            const events = runner === "box" ? got.text : readFileSync(join(b.boxes, "one-plan.jsonl"), "utf8");

            for (const output of [readFileSync(answer, "utf8"), events]) {
              expect(output.includes(secret)).toBe(false);
              expect(output).toContain("[redacted]");
            }
          } finally {
            b.close();
          }
        }),
        { ...options, numRuns: 2 },
      );
    },
  );
});

const shimGit = (
  dir: string,
  args: string[],
  more: { cwd?: string; fetch?: boolean; input?: string; real?: boolean } = {},
) => {
  const r = spawnSync(more.real ? "/usr/bin/git" : join(dir, "git"), args, {
    cwd: more.cwd ?? dir,
    input: more.input ?? "",
    encoding: "utf8",
    timeout: 15_000,
    env: {
      PATH: "/usr/bin:/bin",
      T321_FIXTURE: dir,
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_AUTHOR_NAME: "fixture",
      GIT_AUTHOR_EMAIL: "fixture@example.test",
      GIT_COMMITTER_NAME: "fixture",
      GIT_COMMITTER_EMAIL: "fixture@example.test",
      ...(more.fetch ? { T321_FETCH: "1" } : {}),
    },
  });
  expect(r.error, "git failed to start").toBeUndefined();
  return { code: r.status, stdout: r.stdout, stderr: r.stderr };
};

// The git shim alone, in a fresh folder: a repo at `main`, a repo at `boxes/one` (the box) and
// `link`, a symlink to the folder. Real git runs beside it for the answers to compare with.
const shim = (f: (dir: string, git: typeof shimGit) => void) => {
  const dir = mkdtempSync(join(tmpdir(), "gs621-"));

  try {
    writeFileSync(join(dir, "git"), GIT, { mode: 0o755 });
    write(join(dir, "drop-on-walk"), "");
    symlinkSync(dir, join(dir, "link"));

    for (const repo of ["main", "boxes/one"]) {
      mkdirSync(join(dir, repo), { recursive: true });
      expect(shimGit(dir, ["init", "-q"], { cwd: join(dir, repo), real: true }).code).toBe(0);
      expect(
        shimGit(dir, ["commit", "-q", "--allow-empty", "-m", "base"], { cwd: join(dir, repo), real: true }).code,
      ).toBe(0);
    }

    f(dir, shimGit);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

// Arguments as a caller may spell them: empty, spaces, quotes, tabs, newlines, a leading dash.
const arg = fc.string({ unit: fc.constantFrom("a", "Z", " ", "'", '"', "\t", "\n", "-", "\\", "$", "*", "é") });

describe("T621 the fixture's git shim, today's tooling", () => {
  // Plant: compare the folder as written instead of `pwd -P`; the symlink and `cd` spellings pass.
  it("L2 during fetch the shim refuses git whose folder is the box, however spelled, and passes others", () => {
    const spellings = {
      absolute: (dir: string, to: string) => ({ cwd: dir, C: [["-C", join(dir, to)]] }),
      relative: (dir: string, to: string) => ({ cwd: dir, C: [["-C", to]] }),
      twice: (dir: string, to: string) => ({
        cwd: dir,
        C: [
          ["-C", "boxes"],
          ["-C", `../${to}`],
        ],
      }),
      cd: (dir: string, to: string) => ({ cwd: join(dir, to), C: [] }),
      symlink: (dir: string, to: string) => ({ cwd: dir, C: [["-C", join(dir, "link", to)]] }),
    };
    const spelling = fc.constantFrom(...(Object.keys(spellings) as Array<keyof typeof spellings>));

    fc.assert(
      fc.property(fc.record({ spelling, fetch: fc.boolean(), box: fc.boolean() }), ({ spelling, fetch, box }) =>
        shim((dir, git) => {
          const { cwd, C } = spellings[spelling](dir, box ? "boxes/one" : "main");
          const got = git(dir, [...C.flat(), "rev-parse", "--is-inside-work-tree"], { cwd, fetch });
          const refused = fetch && box;
          expect(got).toEqual({
            code: refused ? 98 : 0,
            stdout: refused ? "" : "true\n",
            stderr: refused ? "fixture refuses Git inside the box during fetch\n" : "",
          });
        }),
      ),
      {
        ...options,
        // pinned: the logical-path plant, which only the cd and symlink spellings catch.
        examples: [[{ spelling: "cd", fetch: true, box: true }], [{ spelling: "symlink", fetch: true, box: true }]],
      },
    );
  });

  // Plant: drop the `dropped` marker; a later walk deletes the ref again after it came back.
  it("L3 the first diff --no-renames deletes the planted ref once, and only when one is planted", () => {
    fc.assert(
      fc.property(fc.record({ planted: fc.boolean(), walks: fc.integer({ min: 0, max: 3 }) }), ({ planted, walks }) =>
        shim((dir, git) => {
          const main = join(dir, "main");
          const has = () => git(dir, ["rev-parse", "--verify", "-q", "refs/heads/gone"], { cwd: main, real: true });
          write(join(dir, "drop-on-walk"), planted ? "refs/heads/gone" : "");

          for (let walk = 1; walk <= walks; walk++) {
            expect(git(dir, ["branch", "-f", "gone"], { cwd: main, real: true }).code).toBe(0);
            expect(git(dir, ["diff", "--name-only", "HEAD"], { cwd: main }).code).toBe(0);
            expect(has().code, "a diff without --no-renames is no walk").toBe(0);
            expect(git(dir, ["diff", "--name-only", "--no-renames", "HEAD"], { cwd: main }).code).toBe(0);
            expect(has().code === 0, `walk ${walk}`).toBe(!(planted && walk === 1));
          }

          expect(existsSync(join(dir, "dropped"))).toBe(planted && walks > 0);
        }),
      ),
      { ...options, examples: [[{ planted: true, walks: 2 }]] },
    );
  });

  // Plant: end the shim with `/usr/bin/git "$@"; exit 0`, or read no stdin; the codes or hashes differ.
  it("L4 the shim passes stdin and the exit code through exactly", () => {
    fc.assert(
      fc.property(fc.string(), (input) =>
        shim((dir, git) => {
          const hashed = ["hash-object", "--stdin"];
          expect(git(dir, hashed, { input })).toEqual(git(dir, hashed, { input, real: true }));
          const missing = git(dir, ["rev-parse", "--verify", "nope"], { cwd: join(dir, "main") });
          expect(missing.code).toBe(128);
          expect(missing).toEqual(git(dir, ["rev-parse", "--verify", "nope"], { cwd: join(dir, "main"), real: true }));
        }),
      ),
      options,
    );
  });

  // Plant: pass `$*` instead of `"$@"`; an argument with a space splits.
  it("L5 the shim passes every argument through unchanged", () => {
    fc.assert(
      fc.property(fc.array(arg), (args) =>
        shim((dir, git) => {
          const quoted = ["rev-parse", "--sq-quote", ...args];
          expect(git(dir, quoted)).toEqual(git(dir, quoted, { real: true }));
        }),
      ),
      { ...options, examples: [[["a b", "", "-x"]]] },
    );
  });

  // Plant: end a row with a newline, or log `$*`; a tab, newline or empty argument reads back wrong.
  it("L6 every row the shim writes reads back through calls() as the same folder and arguments", () => {
    fc.assert(
      fc.property(fc.array(fc.array(arg), { minLength: 1, maxLength: 3 }), (lists) =>
        shim((dir, git) => {
          for (const args of lists) {
            git(dir, ["rev-parse", "--sq-quote", ...args], { cwd: join(dir, "main") });
          }

          expect(readCalls(dir)).toEqual(
            lists.map((args) => ({
              cmd: "git",
              cwd: realpathSync(join(dir, "main")),
              args: ["rev-parse", "--sq-quote", ...args],
            })),
          );
        }),
      ),
      { ...options, examples: [[[["", "a\tb", "c\nd", "-e"], []]]] },
    );
  });
});

describe("T614 a box never installs, today's tooling", () => {
  // scenario: a step that moves the lockfile or a manifest, then runs `pnpm exec`, kept its box's
  // node_modules. pnpm's default `verifyDepsBeforeRun: install` started an install there, with no
  // network, that deleted them (ticket 477's boxes layout2-tests4 and layout2-tests6). Real pnpm on
  // a two-package workspace with no outside dependency, so nothing reaches the network.
  // Plant: drop `verifyDepsBeforeRun` from pnpm-workspace.yaml (caught: it reads undefined). With
  // `install` in the temp workspace, pnpm unlinks node_modules/a (checked by hand, 2026-11-11).
  it("T614 scenario: pnpm exec behind the lockfile warns and leaves node_modules alone", () => {
    // `pnpm exec vitest` hands its children `pnpm_config_verify_deps_before_run=false`; a box's
    // shell has no such variable, so the child pnpm reads the setting from the files alone.
    const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^p?npm_config_/i.test(k)));
    const pnpm = (cwd: string, ...args: string[]) => spawnSync("pnpm", args, { cwd, env, encoding: "utf8" });
    const setting = pnpm(root, "config", "get", "verifyDepsBeforeRun").stdout.trim();
    expect(setting).toBe("warn");

    const dir = mkdtempSync(join(tmpdir(), "vd614-"));

    try {
      // No `packageManager` pin: under the test's fresh home, a pin would fetch pnpm itself.
      const manifest = (more: object) => JSON.stringify({ name: "root", private: true, ...more });
      write(join(dir, "pnpm-workspace.yaml"), `packages:\n  - a\nverifyDepsBeforeRun: ${setting}\n`);
      write(join(dir, "a/package.json"), JSON.stringify({ name: "a", version: "1.0.0" }));
      write(join(dir, "package.json"), manifest({ dependencies: { a: "workspace:*" } }));
      expect(pnpm(dir, "install", "--offline").status).toBe(0);
      expect(existsSync(join(dir, "node_modules/a"))).toBe(true);

      // The step's change: the manifest no longer matches the lockfile.
      write(join(dir, "package.json"), manifest({}));
      const ran = pnpm(dir, "exec", "true");
      expect(ran.status).toBe(0);
      expect(`${ran.stdout}${ran.stderr}`).toMatch(/out of sync with your lockfile/);
      expect(existsSync(join(dir, "node_modules/a"))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
