// The commit check's planted cases end to end (Tier 1, P32; laws p83 to p87 and p89). Each case is a
// fresh temp repo: git with no global or system config, a `main` with one commit holding
// `allowed_signers` and the real `exam-paths.json`, and a branch `pr` off it. Five throwaway Ed25519
// keys (tests, build, lead, stranger, person) are made once by real `ssh-keygen` in the temp folder and go
// with it; nothing here prints one. The program runs as CI runs it, `node commits.ts ...`.
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import * as fc from "fast-check";
import { afterAll, expect } from "vitest";
import { type Role, signedText } from "./commits.ts";

const ROOT = join(import.meta.dirname, "..", "..", "..", "..", "..");
const PROGRAM = join(import.meta.dirname, "commits.ts");
const EXAM_LIST = readFileSync(join(ROOT, "exam-paths.json"), "utf8");
const TOP = realpathSync(mkdtempSync(join(tmpdir(), "commits-")));
afterAll(() => rmSync(TOP, { recursive: true, force: true }));

const ENV: NodeJS.ProcessEnv = {
  ...process.env,
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_AUTHOR_NAME: "step",
  GIT_AUTHOR_EMAIL: "step@fabrika.test",
  GIT_COMMITTER_NAME: "step",
  GIT_COMMITTER_EMAIL: "step@fabrika.test",
};

delete ENV.GITHUB_STEP_SUMMARY;
delete ENV.GITHUB_ACTIONS;

const sh = (cwd: string, cmd: string, args: string[], input?: string, env = ENV) => {
  const ran = spawnSync(cmd, args, { cwd, env, input, encoding: "utf8" });

  if (ran.status !== 0) {
    throw new Error(`${cmd} ${args.join(" ")}: ${ran.stderr}`);
  }

  return ran.stdout;
};

const KEYS = join(TOP, "keys");
mkdirSync(KEYS, { mode: 0o700 });
type Who = Role | "stranger";

for (const who of ["tests", "build", "lead", "stranger", "person"]) {
  sh(KEYS, "ssh-keygen", ["-q", "-t", "ed25519", "-N", "", "-C", who, "-f", join(KEYS, who)]);
}

sh(KEYS, "ssh-keygen", ["-q", "-t", "ecdsa", "-N", "", "-C", "ecdsa", "-f", join(KEYS, "ecdsa")]);

const pub = (who: string) =>
  readFileSync(join(KEYS, `${who}.pub`), "utf8")
    .split(" ")
    .slice(0, 2)
    .join(" ");

/** A key's fingerprint, as `ssh-keygen -l` prints it and a note's `key` holds it. */
const fingerprint = (who: string) =>
  // oxlint-disable-next-line typescript/no-non-null-assertion -- Moved test setup reads ssh-keygen's fixed output after checking its exit code.
  sh(KEYS, "ssh-keygen", ["-l", "-f", join(KEYS, `${who}.pub`)]).split(" ")[1]!;

const keyLine = (role: string, who: string) => `${role} namespaces="fabrika-step" ${pub(who)}`;

const stepKeys = (build = "build") =>
  `${[keyLine("tests", "tests"), keyLine("build", build), keyLine("lead", "lead")].join("\n")}\n`;

const GOOD_KEYS = stepKeys();
const personLine = (id: string, who = "person") => `person:${id} namespaces="git" ${pub(who)}`;
const PERSON_KEYS = `${GOOD_KEYS}${personLine("github:42")}\n`;

let count = 0;
const repoCount = () => count;

/** A planted repo: `main` with one commit, and the branch `pr` checked out off it. */
class Repo {
  readonly dir: string;
  readonly base: string;

  constructor(keys: string | null = GOOD_KEYS, at?: string, format: "sha1" | "sha256" = "sha1", initial = "x\n") {
    count += 1;
    this.dir = at ?? join(TOP, `r${count}`);
    mkdirSync(this.dir);
    this.git("init", "-q", "-b", "main", `--object-format=${format}`);

    if (keys !== null) {
      this.write("allowed_signers", keys);
    }

    this.write("exam-paths.json", EXAM_LIST);
    this.write("README.md", initial);
    this.write("boundary-rules.json", "[]\n");
    this.write("fixtures/next/v.txt", "v\n");
    this.base = this.commit("main");
    this.git("checkout", "-q", "-b", "pr");
  }

  git(...args: string[]) {
    return sh(this.dir, "git", args);
  }

  write(path: string, text: string) {
    mkdirSync(dirname(join(this.dir, path)), { recursive: true });
    writeFileSync(join(this.dir, path), text);
  }

  commit(message = "c") {
    this.git("add", "-A");
    this.git("commit", "-q", "--allow-empty", "-m", message);
    return this.head();
  }

  gitSigned(who: Who | "person" = "person", message = "person") {
    this.git("add", "-A");
    this.git(
      "-c",
      "gpg.format=ssh",
      "-c",
      `user.signingkey=${join(KEYS, who)}`,
      "commit",
      "-q",
      "--gpg-sign",
      "--allow-empty",
      "-m",
      message,
    );
    return this.head();
  }

  head(rev = "HEAD") {
    return this.git("rev-parse", rev).trim();
  }

  /** Commits one file under `next/`, the usual product change. */
  change(name: string) {
    this.write(`next/packages/x/src/${name}`, `${name}\n`);
    return this.commit(name);
  }

  /** Signs a link for a commit the way a step would, with any part planted another way. */
  sign(who: Who, opts: { step?: Role; ticket?: string; version?: number; ns?: string; sha?: string } = {}) {
    const sha = opts.sha ?? this.head();
    const link = {
      step: opts.step ?? (who === "stranger" ? "build" : who),
      ticket: opts.ticket ?? "229",
      version: opts.version ?? 1,
      from: this.head(`${sha}^1^{tree}`),
      to: this.head(`${sha}^{tree}`),
    };
    const args = ["-Y", "sign", "-n", opts.ns ?? "fabrika-step", "-f", join(KEYS, who)];
    const sig = sh(this.dir, "ssh-keygen", args, signedText(link));
    // oxlint-disable-next-line fabrika/no-hand-tag -- Raw signed input for the git exam, preserved from the moved tests.
    const note = { _tag: "attested", ...link, key: fingerprint(who), sig };
    this.setNote(sha, JSON.stringify(note));
    return note;
  }

  setNote(sha: string, text: string) {
    sh(this.dir, "git", ["notes", "--ref=fabrika", "add", "-f", "-F", "-", sha], text);
  }

  /** `pnpm commits sign`, as a step runs it. */
  signWith(step: Role, ticket = "229") {
    return this.run(["sign", "--step", step, "--ticket", ticket, "--key", join(KEYS, step)]);
  }

  run(args: string[], env = ENV, cwd = this.dir) {
    const ran = spawnSync("node", [PROGRAM, ...args], { cwd, env, encoding: "utf8" });
    const answers = ran.stdout
      .split("\n")
      .filter((l) => l.startsWith("{"))
      .map((l) => JSON.parse(l) as Record<string, unknown>);
    return { code: ran.status, answers, out: ran.stdout, err: ran.stderr };
  }

  check(more: string[] = [], base = this.base, head = "HEAD") {
    return this.run(["check", "--base", base, "--head", head, ...more]);
  }
}

// oxlint-disable-next-line fabrika/no-hand-tag -- Expected wire answer for the git exam, preserved from the moved tests.
const DONE = { _tag: "done" };
const runs = { seed: 119120, numRuns: 5 };
const id = fc.stringMatching(/^[A-Za-z0-9._:-]{1,20}$/);
const name = fc.stringMatching(/^[a-z][a-z0-9_-]{0,12}$/);
// oxlint-disable-next-line fabrika/no-hand-tag -- Expected wire answer for the git exam, preserved from the moved tests.
const stuck = (why: string, sha: string, more: object = {}) => ({ _tag: "stuck", why, sha, ...more });
// oxlint-disable-next-line fabrika/no-hand-tag -- Expected wire answer for the git exam, preserved from the moved tests.
const ask = (...paths: string[]) => ({ _tag: "ask", who: "owner", for: "exam_read", paths });

const verifyCommit = (r: Repo, sha: string, keys = PERSON_KEYS) => {
  const allowed = join(TOP, "git-allowed-signers");
  writeFileSync(allowed, keys);
  return spawnSync("git", ["-c", `gpg.ssh.allowedSignersFile=${allowed}`, "verify-commit", sha], {
    cwd: r.dir,
    env: ENV,
    encoding: "utf8",
  }).status;
};

/** Git accepts PGP here, so the exam must still prove that the real header is SSH. */
const acceptPgp = (r: Repo) => {
  const verifier = join(TOP, "pgp-verifier");
  writeFileSync(
    verifier,
    [
      "#!/bin/sh",
      "cat >/dev/null",
      "cat <<'STATUS'",
      "[GNUPG:] NEWSIG",
      "[GNUPG:] GOODSIG 1111111111111111 Fixture",
      "[GNUPG:] VALIDSIG 1111111111111111111111111111111111111111 2026-11-08 1794168000 0 4 0 1 10 00 1111111111111111111111111111111111111111",
      "[GNUPG:] TRUST_FULLY",
      "STATUS",
      // Keep the logged key check from hiding a header parsing bug after the squash.
      `echo 'fixture key ${fingerprint("person")}' >&2`,
      "",
    ].join("\n"),
    { mode: 0o700 },
  );
  r.git("config", "gpg.program", verifier);
};

const personLink = (r: Repo, sha: string, who = "person") => {
  const signature = /^gpgsig(?:-sha256)? (.*(?:\n .*)*)/m.exec(r.git("cat-file", "commit", sha));
  expect(signature).not.toBeNull();
  return {
    // oxlint-disable-next-line fabrika/no-hand-tag -- Raw signed input for the git exam, preserved from the moved tests.
    _tag: "attested",
    step: "person",
    ticket: "229",
    version: 1,
    from: r.head(`${sha}^1^{tree}`),
    to: r.head(`${sha}^{tree}`),
    key: fingerprint(who),
    // oxlint-disable-next-line typescript/no-non-null-assertion -- The moved test assertion above requires the git signature header.
    sig: `${signature![1]!.replaceAll("\n ", "\n")}\n`,
  };
};

const verifies = (repo: Repo, note: { sig: string; step: Role }, text: string) => {
  writeFileSync(join(repo.dir, ".allowed"), GOOD_KEYS);
  writeFileSync(join(repo.dir, ".sig"), note.sig);
  const args = ["-Y", "verify", "-f", ".allowed", "-I", note.step, "-n", "fabrika-step", "-s", ".sig"];
  return spawnSync("ssh-keygen", args, { cwd: repo.dir, input: text }).status === 0;
};

const squashed = (r: Repo, notes: Array<{ note: object; commit: string }>, moveMain = false) => {
  r.git("checkout", "-q", "main");

  if (moveMain) {
    r.write("docs/other.md", "o\n");
    r.commit("main moves");
  }

  r.git("merge", "--squash", "-q", "pr");
  const squash = r.commit("squash");
  const rows = notes.map(
    ({ note, commit }, i): { date: string; run: string; attested: Array<Record<string, unknown>> } => ({
      date: "2026-11-07",
      run: `r${i}`,
      attested: [
        {
          ...note,
          by: "agent:planted",
          arrivedAt: "2026-11-07T10:00:00-08:00",
          parent: null,
          traceId: `trace-step-${i}`,
          commit,
          pr: "usirin/tea-fabrika#1",
          base: r.base,
          squash,
          keys: r.base,
        },
      ],
    }),
  );
  return { squash, rows };
};

const log = (r: Repo, rows: object[]) => {
  r.write("field/runs.jsonl", `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`);
  return r.commit("log");
};

/** A branch with a tests commit and a build commit, each signed. */
const twoSteps = (r: Repo) => {
  const c1 = r.change("a.ts");
  const n1 = r.sign("tests");
  const c2 = r.change("b.ts");
  const n2 = r.sign("build");
  return [
    { note: n1, commit: c1 },
    { note: n2, commit: c2 },
  ];
};

export {
  EXAM_LIST,
  TOP,
  ENV,
  sh,
  KEYS,
  pub,
  fingerprint,
  keyLine,
  stepKeys,
  GOOD_KEYS,
  personLine,
  PERSON_KEYS,
  repoCount,
  Repo,
  DONE,
  runs,
  id,
  name,
  stuck,
  ask,
  verifyCommit,
  acceptPgp,
  personLink,
  verifies,
  squashed,
  log,
  twoSteps,
};
