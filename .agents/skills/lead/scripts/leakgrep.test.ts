import "./leakgrep.sh?raw";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import fc from "fast-check";
import { describe, expect, it } from "vitest";

const script = process.env.TEST_LEAKGREP ?? join(import.meta.dirname, "leakgrep.sh");
const word = fc.stringMatching(/^[a-z]{8,16}$/).map((s) => `private_${s}[x]`);
const options = { seed: 325, numRuns: 8 };

describe("T325 K6 leakgrep, today's tooling", () => {
  // R4 findings 1 and 3. CLI text has no domain Schema; generate diff syntax edge cases.
  // Plants: skip every +++ line; reject prose punctuation around the canonical URL.
  it("R4 scans plus-prefixed additions and accepts public URLs in prose", () => {
    fc.assert(
      fc.property(fc.record({ word, pluses: fc.integer({ min: 2, max: 6 }) }), ({ word, pluses }) => {
        const dir = mkdtempSync(join(tmpdir(), "lg-plus-"));

        try {
          const repo = join(dir, "repo");
          mkdirSync(repo);
          expect(spawnSync("git", ["init", "-q", repo]).status).toBe(0);
          const words = join(dir, "words");
          const url = "https://github.com/usirin/tea-fabrika";
          writeFileSync(words, [word, ...url.split("/").slice(-2)].join("\n"));
          const run = (input: string) =>
            spawnSync("sh", [script], {
              cwd: repo,
              input,
              encoding: "utf8",
              env: { ...process.env, FABRIKA_LEAK_WORDS: words, TYPESAFE_API_KEY: undefined },
            });

          for (const leak of [
            word,
            "/" + "tmp/private-501",
            `npm_${"a".repeat(36)}`,
            String.fromCodePoint(0x2014),
            "https://claude.ai/" + "design/private",
          ]) {
            const ran = run(`diff --git a/a b/a\n--- a/a\n+++ b/a\n@@ -0,0 +1 @@\n+${"+".repeat(pluses)}${leak}\n`);
            expect(ran.status, "added content beginning with ++ was skipped").toBe(1);
            expect(ran.stdout + ran.stderr).not.toContain(leak);

            for (const space of ["", " "]) {
              const minimal = run(`+${"+".repeat(pluses)}${space}${leak}\n`);
              expect(minimal.status, "headerless ++ addition was skipped").toBe(1);
            }
          }

          for (const prose of [`<${url}>`, `${url}.`, `[repo](${url})`, `${url}.git.`, `<${url}/pull/545>.`]) {
            expect(run(`+See ${prose}\n`).status, prose).toBe(0);
          }

          for (const unsafe of [`${url}.evil`, `${url}>${word}`, `${url}/${word}`]) {
            expect(run(`+${unsafe}\n`).status).toBe(1);
          }
        } finally {
          rmSync(dir, { recursive: true, force: true });
        }
      }),
      { ...options, numRuns: 3 },
    );
  });

  // R4 finding 2. Plant: let mktemp, cat, git, decoding or cleanup print their raw error.
  it("R4 keeps private words and paths out of every error exit", () => {
    fc.assert(
      fc.property(word, (word) => {
        const dir = mkdtempSync(join(tmpdir(), "lg-errors-"));

        try {
          const repo = join(dir, "repo"),
            words = join(dir, "words"),
            draft = join(dir, "draft");
          mkdirSync(repo);
          spawnSync("git", ["init", "-q", repo]);
          writeFileSync(words, word);
          writeFileSync(draft, "safe text\n");
          const missing = join(dir, word, "missing");
          const local = join(repo, word);
          writeFileSync(local, word);
          const invalid = join(dir, "invalid");
          writeFileSync(invalid, Buffer.from([0xff]));
          const leak = join(dir, "leak");
          writeFileSync(leak, word);
          const loop = join(dir, "loop");
          symlinkSync(loop, loop);
          const cases = [
            { args: [], env: { TMPDIR: missing } },
            { args: ["--text", missing] },
            { args: ["--text", join(dir, word)] },
            { args: [word] },
            { args: [word, draft] },
            { args: [word, draft, word] },
            { args: ["--text", repo] },
            { args: ["--text", loop] },
            { args: ["--text", leak], code: 1 },
            { args: ["--text", draft], env: { FABRIKA_LEAK_WORDS: missing }, code: 0 },
            { args: ["--text", draft], env: { FABRIKA_LEAK_WORDS: local } },
            { args: ["--text", draft], env: { FABRIKA_LEAK_WORDS: invalid } },
            { args: ["--text", invalid] },
            { args: ["--text", draft], cwd: dir },
          ];

          for (const flow of cases) {
            const ran = spawnSync("sh", [script, ...flow.args], {
              cwd: flow.cwd ?? repo,
              input: "safe\n",
              encoding: "utf8",
              env: {
                ...process.env,
                TMPDIR: dir,
                FABRIKA_LEAK_WORDS: words,
                TYPESAFE_API_KEY: undefined,
                ...flow.env,
              },
            });
            expect(ran.stdout + ran.stderr).not.toContain(word);
            expect(ran.stdout + ran.stderr).not.toContain(dir);
            expect(ran.status).toBe(flow.code ?? 2);
          }
        } finally {
          rmSync(dir, { recursive: true, force: true });
        }
      }),
      { ...options, numRuns: 3 },
    );
  });

  // Plant: scan '-' instead of '+'. Every family is tried alone in every generated flow.
  it("finds every added private word and fixed pattern, ignores removals and safe URLs", () => {
    fc.assert(
      fc.property(
        fc.record({ word, suffix: fc.stringMatching(/^[a-z]{4,12}$/), crlf: fc.boolean() }),
        ({ word, suffix, crlf }) => {
          const dir = mkdtempSync(join(tmpdir(), "lg-"));

          try {
            const repo = join(dir, "repo");
            mkdirSync(repo);
            expect(spawnSync("git", ["init", "-q", repo]).status).toBe(0);
            const words = join(dir, "words");
            writeFileSync(
              words,
              `${word}\n${"https://github.com/usirin/tea-fabrika".split("/").slice(-2).join("\n")}\n`,
            );
            const run = (input: string) =>
              spawnSync("sh", [script], {
                cwd: repo,
                input,
                encoding: "utf8",
                timeout: 5_000,
                env: { ...process.env, FABRIKA_LEAK_WORDS: words, TYPESAFE_API_KEY: undefined },
              });
            const leaks = [
              word.toUpperCase(),
              `/` + `Users/${suffix}/work`,
              `/` + `home/${suffix}/work`,
              `/` + `tmp/${suffix}-501/work`,
              `/private/` + `var/folders/${suffix}`,
              `C:\\Users\\${suffix}`,
              ...["npm_", "ghp_", "gho_", "sk-"].map((prefix) => prefix + suffix.repeat(12)),
              `github_pat_${suffix.repeat(21)}`,
              String.fromCodePoint(0x2014),
              `https://claude.ai/` + `design/${suffix}`,
            ];
            const eol = crlf ? "\r\n" : "\n";

            for (const leak of leaks) {
              const safe = `--- a/input${eol}+++ b/${word}${eol}@@ -1 +1 @@${eol}-${leak}${eol}+https://github.com/usirin/tea-fabrika/pull/532${eol}`;
              const clean = run(safe);
              expect(clean.error).toBeUndefined();
              expect(clean.status, clean.stderr).toBe(0);
              const hit = run(`${safe}+prefix ${leak} suffix${eol}`);
              expect(hit.status).toBe(1);
              expect(hit.stderr).toContain("leakgrep: leak");
              expect(hit.stdout + hit.stderr).not.toContain(leak);
              expect(hit.stdout + hit.stderr).not.toContain(word);
            }

            const publicUrl = "https://github.com/usirin/tea-fabrika";

            for (const url of [
              `${publicUrl.replace(/[^/]+$/, "other")}/${suffix}`,
              `${publicUrl}-evil/${suffix}`,
              `${publicUrl}/issues/${word}`,
            ]) {
              expect(run(`+${url}\n`).status).toBe(1);
            }
          } finally {
            rmSync(dir, { recursive: true, force: true });
          }
        },
      ),
      options,
    );
  });

  // Plant: accept a repo-local word list.
  it("checks whole drafts, uses a private default, and refuses repo-linked word files", () => {
    fc.assert(
      fc.property(fc.record({ word, linked: fc.boolean() }), ({ word, linked }) => {
        const dir = mkdtempSync(join(tmpdir(), "lg-home-"));

        try {
          const repo = join(dir, "repo"),
            home = join(dir, "home");
          mkdirSync(repo);
          mkdirSync(join(home, ".fabrika"), { recursive: true });
          spawnSync("git", ["init", "-q", repo]);
          writeFileSync(join(home, ".fabrika/leak-words"), word);
          const draft = join(repo, "draft.md");
          writeFileSync(draft, `# Plan\n${word}\n`);
          const run = (words?: string) =>
            spawnSync("sh", [script, "--text", draft], {
              cwd: repo,
              encoding: "utf8",
              env: {
                ...process.env,
                HOME: home,
                FABRIKA_LEAK_WORDS: words,
                TYPESAFE_API_KEY: undefined,
              },
            });
          expect(run().status).toBe(1);
          const local = join(repo, "words");
          writeFileSync(local, word);
          const alias = join(dir, "alias");
          symlinkSync(local, alias);
          expect(run(linked ? alias : local).status).toBe(2);
          expect(run(join(dir, "missing")).status).toBe(0);
        } finally {
          rmSync(dir, { recursive: true, force: true });
        }
      }),
      options,
    );
  });
});

describe("T325 R5 leakgrep defaults and token lengths, today's tooling", () => {
  // No domain Schema for missing files or token text. Plant: refuse when the list is absent.
  it("keeps built-in checks in both modes when the private word list is missing", () => {
    fc.assert(
      fc.property(word, (privateWord) => {
        const dir = mkdtempSync(join(tmpdir(), "lg-missing-"));

        try {
          const repo = join(dir, "repo"),
            home = join(dir, "home"),
            draft = join(dir, "draft");
          mkdirSync(home);
          expect(spawnSync("git", ["init", "-q", repo]).status).toBe(0);

          for (const override of [undefined, join(dir, privateWord, "missing")]) {
            for (const textMode of [false, true]) {
              for (const [text, kind] of [
                [privateWord, undefined],
                ["/" + "Users/test/work", "machine_path"],
                ["/" + "home/test/work", "machine_path"],
                ["/private/" + "tmp/test", "machine_path"],
                [`npm_${"x".repeat(36)}`, "key"],
                ["-----BEGIN " + "RSA PRIVATE KEY-----", "key"],
                [String.fromCodePoint(0x2014), "em_dash"],
              ] as const) {
                writeFileSync(draft, `${text}\n`);
                const ran = spawnSync("sh", [script, ...(textMode ? ["--text", draft] : [])], {
                  cwd: repo,
                  input: `+${text}\n`,
                  encoding: "utf8",
                  env: {
                    ...process.env,
                    HOME: home,
                    FABRIKA_LEAK_WORDS: override,
                    TYPESAFE_API_KEY: undefined,
                  },
                });
                expect(ran.status, ran.stderr).toBe(kind ? 1 : 0);
                const notice = ran.stderr.split("\n").filter((line) => /word list.*missing/i.test(line));
                expect(notice).toHaveLength(1);

                if (kind) {
                  expect(ran.stderr).toContain(`leak ${kind}`);
                }

                expect(ran.stdout + ran.stderr).not.toContain(privateWord);
                expect(ran.stdout + ran.stderr).not.toContain(dir);
              }
            }
          }
        } finally {
          rmSync(dir, { recursive: true, force: true });
        }
      }),
      { ...options, numRuns: 2, endOnFailure: true },
    );
  });

  // Real formats and minimum lengths: Gitleaks' provider rules, read 2026-11-08.
  // https://github.com/gitleaks/gitleaks/blob/master/config/gitleaks.toml
  // Generated fake text pushes each length boundary. Plants: match any suffix, or drop a family.
  it("finds real-length made-up tokens and accepts short words and SSH key type names", () => {
    fc.assert(
      fc.property(fc.stringMatching(/^[A-Za-z0-9]{160}$/), (payload) => {
        const dir = mkdtempSync(join(tmpdir(), "lg-tokens-"));

        try {
          const repo = join(dir, "repo"),
            words = join(dir, "words"),
            draft = join(dir, "draft");
          expect(spawnSync("git", ["init", "-q", repo]).status).toBe(0);
          writeFileSync(words, "");
          const run = (text: string, textMode: boolean) => {
            writeFileSync(draft, text);
            return spawnSync("sh", [script, ...(textMode ? ["--text", draft] : [])], {
              cwd: repo,
              input: `+${text}\n`,
              encoding: "utf8",
              env: { ...process.env, FABRIKA_LEAK_WORDS: words, TYPESAFE_API_KEY: undefined },
            });
          };

          for (const textMode of [false, true]) {
            for (const [prefix, minimum] of [
              ["npm_", 36],
              ...["p", "o", "u", "s", "r"].map((kind) => [`gh${kind}_`, 36] as const),
              ["github_pat_", 82],
              ["sk-", 48],
              ["sk-proj-", 124],
              ["sk-svcacct-", 124],
              ["sk-admin-", 124],
            ] as const) {
              for (const length of [3, minimum - 1, minimum, minimum + 1]) {
                const token = prefix + payload.slice(0, length);
                const ran = run(`value="${token}"`, textMode);
                expect(ran.status, `${prefix} suffix length ${length}`).toBe(length < minimum ? 0 : 1);
                expect(ran.stdout + ran.stderr).not.toContain(token);
              }
            }

            // T325's 20-PR replay: a fake signer and both OpenSSH security-key type names.
            for (const safe of ["sk-key", "sk-ecdsa-sha2-nistp256@openssh.com", "sk-ssh-ed25519@openssh.com"]) {
              expect(run(`${safe} ${payload}`, textMode).status, safe).toBe(0);
            }

            for (const prefix of ["github_pat_", "sk-proj-"]) {
              expect(run(prefix + payload.replace(/.{8}/g, "$&_"), textMode).status).toBe(1);
            }
          }
        } finally {
          rmSync(dir, { recursive: true, force: true });
        }
      }),
      { ...options, numRuns: 2, endOnFailure: true },
    );
  });
});

describe("T396 leakgrep plain /tmp paths, today's tooling (decision 0011)", () => {
  const run = (text: string) => {
    const dir = mkdtempSync(join(tmpdir(), "lg-tmp-"));

    try {
      const repo = join(dir, "repo"),
        words = join(dir, "words");
      expect(spawnSync("git", ["init", "-q", repo]).status).toBe(0);
      writeFileSync(words, "");
      return spawnSync("sh", [script], {
        cwd: repo,
        input: `+${text}\n`,
        encoding: "utf8",
        env: { ...process.env, FABRIKA_LEAK_WORDS: words, TYPESAFE_API_KEY: undefined },
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };

  // vector: AGENTS.md asks test homes to use a short path under /tmp; 0011 lets it through.
  it("vector: a short test home under /tmp passes", () => {
    const ran = run("/" + "tmp/fh.abc");
    expect(ran.status, ran.stderr).toBe(0);
  });

  // pinned: 0011 keeps these flagged. A /tmp first part ending in -<number> may hold a user id,
  // and the other four are home or per-user temp folders.
  for (const leak of ["/" + "tmp/claude-501/x", "/private/" + "tmp/x", "/" + "var/folders/ab/x", "/" + "Users/x"]) {
    it(`pinned: ${leak.replace(/^\//, "")} is a machine path`, () => {
      const ran = run(leak);
      expect(ran.status).toBe(1);
      expect(ran.stderr).toContain("leak machine_path");
      expect(ran.stdout + ran.stderr).not.toContain(leak);
    });
  }

  // A home folder matches in its real case, so a lowercase API path passes and a home path fails,
  // whatever the name. Ticket 439's sweep was held (ticket 464) on GitHub's REST path /users/<name>/keys.
  // Plants: match homes in any case (the API path fails), or drop /home (the Linux home passes).
  it("a lowercase users API path passes, and a Mac or Linux home folder fails, for any name", () => {
    fc.assert(
      fc.property(fc.stringMatching(/^[a-z][a-z0-9]{2,11}$/), (name) => {
        expect(run(`"/${"users"}/${name}/keys"`).status).toBe(0);

        for (const home of ["Users", "home"]) {
          const ran = run(`"/${home}/${name}/keys"`);
          expect(ran.status).toBe(1);
          expect(ran.stderr).toContain("leak machine_path");
        }
      }),
      { seed: 119120, numRuns: 4 },
    );
  });
});
