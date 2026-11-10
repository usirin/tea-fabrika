// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "./botpush.mjs?raw";
import "./leakgrep.sh?raw";
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import fc from "fast-check";
import { describe, expect, it } from "vitest";

const options = { seed: 119120, numRuns: 10 };
const word = fc.stringMatching(/^[a-z]{8,12}$/).map((s) => `private_${s}`);
const ranges = ["tip", "saved", "diverged"] as const;
const input = fc.record({ word, leak: fc.boolean(), range: fc.constantFrom(...ranges) });

// Real Git and real caller. Only keychain, HTTP and network Git are replaced. The RSA key exists
// only in this child process's memory. No real key file, login or network request is touched.
const shim = `
import cp from 'node:child_process';
import {generateKeyPairSync} from 'node:crypto';
import {appendFileSync} from 'node:fs';
import {syncBuiltinESMExports} from 'node:module';
const real = cp.execFileSync;
cp.execFileSync = (cmd, args, options) => {
  if (cmd === 'security') return Buffer.from(generateKeyPairSync('rsa', {modulusLength: 2048, privateKeyEncoding: {type: 'pkcs8', format: 'pem'}, publicKeyEncoding: {type: 'spki', format: 'pem'}}).privateKey);
  if (cmd === 'git' && args.includes('ls-remote')) return Buffer.from('');
  if (cmd === 'git' && args.includes('push')) { appendFileSync(process.env.TEST_PUSH_LOG, 'push\\n'); return Buffer.from(''); }
  if (cmd === 'git' && args.includes('fetch')) throw new Error('unexpected network Git');
  return real(cmd, args, options);
};
globalThis.fetch = async (url) => ({ok: true, json: async () => String(url).endsWith('access_tokens') ? {token: 'made-up', expires_at: 'never'} : {id: 1}});
syncBuiltinESMExports();
`;

describe("T325 K6 botpush, today's tooling", () => {
  // Plant: omit the leakgrep call. Removed private text and the repo URL must still push.
  it("scans every submitted commit from the merge base at the requested source", () => {
    fc.assert(
      fc.property(input, ({ word, leak, range }) => {
        const dir = mkdtempSync(join(tmpdir(), "push-"));

        try {
          const scripts = join(dir, ".agents/skills/lead/scripts");
          mkdirSync(scripts, { recursive: true });

          for (const file of ["botpush.mjs", "leakgrep.sh"]) {
            cpSync(join(import.meta.dirname, file), join(scripts, file));
          }

          writeFileSync(join(dir, "shim.mjs"), shim);
          const words = join(tmpdir(), `words-${dir.split("/").at(-1)}`);
          writeFileSync(words, `${word}\n${"https://github.com/usirin/tea-fabrika".split("/").slice(-2).join("\n")}\n`);

          try {
            const git = (...args: string[]) => {
              const out = spawnSync(
                "git",
                ["-c", "user.name=Tests", "-c", "user.email=tests@example.invalid", ...args],
                { cwd: dir, encoding: "utf8" },
              );
              expect(out.status, out.stderr).toBe(0);
              return out.stdout.trim();
            };
            git("init", "-q");
            // A leaked case must add the word; a clean case must remove it.
            writeFileSync(join(dir, "subject.md"), `${leak ? "safe base" : word}\n`);
            git("add", "subject.md");
            git("commit", "-qm", "base");
            git("update-ref", "refs/remotes/origin/main", "HEAD");
            writeFileSync(
              join(dir, "subject.md"),
              `https://github.com/usirin/tea-fabrika/pull/532\n${leak ? word : "safe addition"}\n`,
            );
            git("add", "subject.md");
            git("commit", "-qm", "change");
            const source = git("rev-parse", "HEAD");

            if (range === "diverged") {
              const text = readFileSync(join(dir, "subject.md"), "utf8");
              git("checkout", "-qb", "upstream", "HEAD^");
              writeFileSync(join(dir, "subject.md"), text);
              writeFileSync(join(dir, "upstream.md"), "safe upstream\n");
              git("add", "subject.md", "upstream.md");
              git("commit", "-qm", "independent upstream change");
              git("update-ref", "refs/remotes/origin/main", "HEAD");
              git("checkout", "--detach", source);
            }

            writeFileSync(join(dir, "tip.md"), "safe followup\n");
            git("add", "tip.md");
            git("commit", "-qm", "safe followup");

            if (range === "saved") {
              writeFileSync(join(dir, "subject.md"), `${leak ? "safe after source" : word}\n`);
              git("add", "subject.md");
              git("commit", "-qm", "opposite result after source");
            }

            const sourceArgs = range === "saved" ? [source] : [];
            git("notes", "--ref=fabrika", "add", "-m", "throwaway");
            const pushed = join(dir, "pushed");
            writeFileSync(pushed, "");
            const out = spawnSync(
              process.execPath,
              ["--import", join(dir, "shim.mjs"), join(scripts, "botpush.mjs"), dir, "fabrikalfa/test", ...sourceArgs],
              {
                cwd: dir,
                encoding: "utf8",
                timeout: 10_000,
                env: {
                  ...process.env,
                  GH_REPO: "example/repo",
                  FABRIKA_LEAK_WORDS: words,
                  TEST_PUSH_LOG: pushed,
                  TYPESAFE_API_KEY: undefined,
                },
              },
            );
            expect(out.error).toBeUndefined();
            expect({ code: out.status, pushed: readFileSync(pushed, "utf8") }, out.stdout + out.stderr).toEqual({
              code: leak ? 1 : 0,
              pushed: leak ? "" : "push\n",
            });
            // A refusing shared checker must stop this caller even when its text is safe.
            writeFileSync(join(scripts, "leakgrep.sh"), "#!/bin/sh\necho 'leakgrep: planted refusal' >&2\nexit 1\n");
            writeFileSync(pushed, "");
            const refused = spawnSync(
              process.execPath,
              ["--import", join(dir, "shim.mjs"), join(scripts, "botpush.mjs"), dir, "fabrikalfa/test", ...sourceArgs],
              {
                cwd: dir,
                encoding: "utf8",
                env: {
                  ...process.env,
                  GH_REPO: "example/repo",
                  FABRIKA_LEAK_WORDS: words,
                  TEST_PUSH_LOG: pushed,
                  TYPESAFE_API_KEY: undefined,
                },
              },
            );
            expect(refused.status).toBe(1);
            expect(readFileSync(pushed, "utf8")).toBe("");
          } finally {
            rmSync(words, { force: true });
          }
        } finally {
          rmSync(dir, { recursive: true, force: true });
        }
      }),
      {
        ...options,
        // pinned: earlier commits, a saved source and diverged main must all be scanned.
        examples: [
          [{ word: "private_aaaaaaaa", leak: true, range: "tip" }],
          [{ word: "private_aaaaaaaa", leak: false, range: "tip" }],
          [{ word: "private_aaaaaaaa", leak: true, range: "saved" }],
          [{ word: "private_aaaaaaaa", leak: false, range: "saved" }],
          [{ word: "private_aaaaaaaa", leak: true, range: "diverged" }],
          [{ word: "private_aaaaaaaa", leak: false, range: "diverged" }],
        ],
      },
    );
  });
});

// A real bare repository stands in for GitHub. The shim sends botpush's Git there and, before each
// of the first `races` pushes, has "another session" push a note to it, so the notes botpush merged
// are stale by the time it pushes. ci375 build, 2026-11-09: GitHub refused the -wip push with
// "cannot lock ref 'refs/notes/fabrika'" and a hand rerun worked (ticket 388).
const raceShim = `
import cp from 'node:child_process';
import {generateKeyPairSync} from 'node:crypto';
import {appendFileSync, readFileSync} from 'node:fs';
import {syncBuiltinESMExports} from 'node:module';
const real = cp.execFileSync;
const remote = process.env.TEST_REMOTE;
const races = Number(process.env.TEST_RACES);
const asGithub = process.env.TEST_SERVER === 'github';
cp.execFileSync = (cmd, args, options) => {
  if (cmd === 'security') return Buffer.from(generateKeyPairSync('rsa', {modulusLength: 2048, privateKeyEncoding: {type: 'pkcs8', format: 'pem'}, publicKeyEncoding: {type: 'spki', format: 'pem'}}).privateKey);
  if (cmd !== 'git') return real(cmd, args, options);
  args = args.map((a) => (a === 'https://github.com/example/repo.git' ? remote : a));
  if (args.includes('push')) {
    const n = readFileSync(process.env.TEST_PUSH_LOG, 'utf8').split('\\n').filter(Boolean).length;
    appendFileSync(process.env.TEST_PUSH_LOG, 'push\\n');
    if (n < races) {
      real('git', ['--git-dir', remote, '-c', 'user.name=Other', '-c', 'user.email=other@example.invalid', 'notes', '--ref=fabrika', 'append', '-m', 'race ' + n, process.env.TEST_BASE]);
      if (asGithub && process.env.TEST_BRANCH_REFUSED !== 'true') {
        const e = new Error('push failed');
        // format: GitHub's own words for the race, as the ci375 build's drive log saved them.
        e.stderr = Buffer.from(' ! [remote rejected]   ' + process.env.TEST_SOURCE + ' -> fabrikalfa/test (failed)\\n ! [remote rejected]   refs/notes/fabrika -> refs/notes/fabrika (cannot lock ref \\'refs/notes/fabrika\\': is at a71902ce904538345e9415c9d652a017f5b66416 but expected dd4346f8544fd6b2fc05085a17b832b7b4e4b44f)\\nerror: failed to push some refs\\n');
        throw e;
      }
    }
  }
  return real('git', args, options);
};
globalThis.fetch = async (url) => ({ok: true, json: async () => String(url).endsWith('access_tokens') ? {token: 'made-up', expires_at: 'never'} : {id: 1}});
syncBuiltinESMExports();
`;

const race = fc.record({
  server: fc.constantFrom("git", "github"),
  races: fc.constantFrom(0, 1, 2),
  branchRefused: fc.boolean(),
});

describe("T388 botpush retries a notes race once, today's tooling", () => {
  // Plants: no retry; retry on any refusal; retry more than once; force the notes.
  it("pushes again once when only the notes went stale, and never on any other refusal", () => {
    fc.assert(
      fc.property(race, ({ server, races, branchRefused }) => {
        const dir = mkdtempSync(join(tmpdir(), "race-"));

        try {
          const scripts = join(dir, "work/.agents/skills/lead/scripts");
          mkdirSync(scripts, { recursive: true });

          for (const file of ["botpush.mjs", "leakgrep.sh"]) {
            cpSync(join(import.meta.dirname, file), join(scripts, file));
          }

          writeFileSync(join(dir, "shim.mjs"), raceShim);
          writeFileSync(join(dir, "words"), "private_zzzzzzzz\n");
          const work = join(dir, "work");
          const remote = join(dir, "remote.git");
          const run = (cwd: string, ...args: string[]) => {
            const out = spawnSync("git", ["-c", "user.name=Tests", "-c", "user.email=tests@example.invalid", ...args], {
              cwd,
              encoding: "utf8",
            });
            expect(out.status, out.stderr).toBe(0);
            return out.stdout.trim();
          };
          run(dir, "init", "-q", "--bare", remote);
          run(work, "init", "-q");
          writeFileSync(join(work, "a.md"), "base\n");
          run(work, "add", "a.md");
          run(work, "commit", "-qm", "base");
          const base = run(work, "rev-parse", "HEAD");
          run(work, "push", "-q", remote, "HEAD:refs/heads/main");
          run(work, "update-ref", "refs/remotes/origin/main", base);

          if (branchRefused) {
            // The remote branch holds a commit the source lacks: a real refusal.
            writeFileSync(join(work, "other.md"), "other\n");
            run(work, "add", "other.md");
            run(work, "commit", "-qm", "elsewhere");
            run(work, "push", "-q", remote, "HEAD:refs/heads/fabrikalfa/test");
            run(work, "reset", "-q", "--hard", base);
          }

          writeFileSync(join(work, "a.md"), "step\n");
          run(work, "add", "a.md");
          run(work, "commit", "-qm", "step");
          const source = run(work, "rev-parse", "HEAD");
          run(work, "notes", "--ref=fabrika", "add", "-m", "signed", source);
          const tipOf = () =>
            spawnSync(
              "git",
              ["--git-dir", remote, "rev-parse", "-q", "--verify", "refs/heads/fabrikalfa/test^{commit}"],
              { encoding: "utf8" },
            ).stdout.trim();
          const before = tipOf();
          const pushed = join(dir, "pushed");
          writeFileSync(pushed, "");
          const out = spawnSync(
            process.execPath,
            ["--import", join(dir, "shim.mjs"), join(scripts, "botpush.mjs"), work, "fabrikalfa/test"],
            {
              cwd: work,
              encoding: "utf8",
              timeout: 20_000,
              env: {
                ...process.env,
                GH_REPO: "example/repo",
                FABRIKA_LEAK_WORDS: join(dir, "words"),
                TEST_PUSH_LOG: pushed,
                TEST_REMOTE: remote,
                TEST_RACES: String(races),
                TEST_SERVER: server,
                TEST_BASE: base,
                TEST_SOURCE: source,
                TEST_BRANCH_REFUSED: String(branchRefused),
                TYPESAFE_API_KEY: undefined,
              },
            },
          );
          expect(out.error).toBeUndefined();
          const pushes = readFileSync(pushed, "utf8").split("\n").filter(Boolean).length;
          const tip = tipOf();
          const lands = !branchRefused && races <= 1;
          expect({ code: out.status, pushes }, out.stdout + out.stderr).toEqual({
            code: lands ? 0 : 1,
            // A real refusal is never retried; a race is retried once, never twice.
            pushes: branchRefused ? 1 : Math.min(races, 1) + 1,
          });
          expect(tip).toBe(lands ? source : before);

          if (lands) {
            // Nothing forced: the other session's notes are kept beside ours.
            const notes = (sha: string) =>
              spawnSync("git", ["--git-dir", remote, "notes", "--ref=fabrika", "show", sha], {
                encoding: "utf8",
              }).stdout;
            expect(notes(source)).toContain("signed");

            if (races > 0) {
              expect(notes(base)).toContain("race 0");
            }
          }
        } finally {
          rmSync(dir, { recursive: true, force: true });
        }
      }),
      {
        seed: 119120,
        numRuns: 12,
        // scenario: each mix of server words, race count and a real branch refusal runs once.
        examples: (["git", "github"] as const).flatMap((server) =>
          ([0, 1, 2] as const).flatMap((races) =>
            [false, true].map(
              (branchRefused) =>
                [{ server, races, branchRefused }] as [typeof race extends fc.Arbitrary<infer T> ? T : never],
            ),
          ),
        ),
      },
    );
  }, 300_000);
});
