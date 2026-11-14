import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

// Today's tooling. A `pnpm patch` file under patches/ quotes upstream's removed and context lines
// byte for byte, so nobody can reword them. Inside a patch's hunk those quoted lines skip the
// style shapes (the em dash), and keep every secret, path, name and private-word shape. The patch's
// own added lines, its headers, and every other file keep every check. Each case runs as a diff git
// wrote, as a pushed commit and as a whole draft. The private word is made up.
const script = process.env.TEST_LEAKGREP ?? join(import.meta.dirname, "leakgrep.sh");
const word = "private_zzqxjv";
const dash = String.fromCodePoint(0x2014);

// One pnpm patch file, with `line` put in at one place.
const patch = (part: "removed" | "context" | "added" | "header", line: string) => [
  "diff --git a/dist/index.js b/dist/index.js",
  "index 1111111..2222222 100644",
  "--- a/dist/index.js",
  "+++ b/dist/index.js",
  ...(part === "header" ? [` ${line}`] : []),
  "@@ -1,3 +1,3 @@",
  ` const a = 1;${part === "context" ? ` ${line}` : ""}`,
  `-const b = 2;${part === "removed" ? ` ${line}` : ""}`,
  `+const b = 3;${part === "added" ? ` ${line}` : ""}`,
  " const c = 4;",
];

type Read = { readonly status: number | null; readonly stderr: string };

// How the check reads one file holding these lines, in each of its three modes.
const read = (path: string, lines: ReadonlyArray<string>): Record<"diff" | "commits" | "text", Read> => {
  const dir = mkdtempSync(join(tmpdir(), "lg-patches-"));

  try {
    const repo = join(dir, "repo");
    const words = join(dir, "words");
    mkdirSync(repo);
    writeFileSync(words, `${word}\n`);
    const git = (...args: string[]) => {
      const ran = spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.invalid", ...args], {
        cwd: repo,
        encoding: "utf8",
      });
      expect(ran.status, ran.stderr).toBe(0);
      return ran.stdout;
    };
    git("init", "-q");
    const file = join(repo, path);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, lines.map((line) => `${line}\n`).join(""));
    git("add", "-A");
    git("commit", "-q", "-m", "a patch");
    const run = (args: ReadonlyArray<string>, input?: string): Read => {
      const ran = spawnSync("sh", [script, ...args], {
        cwd: repo,
        input,
        encoding: "utf8",
        env: { ...process.env, FABRIKA_LEAK_WORDS: words, TYPESAFE_API_KEY: undefined },
      });
      expect(ran.stdout + ran.stderr).not.toContain(word);
      expect(ran.stdout + ran.stderr).not.toContain(dir);
      return { status: ran.status, stderr: ran.stderr };
    };
    return {
      diff: run([], git("show", "HEAD")),
      commits: run(["--commits", "HEAD"]),
      text: run(["--text", file]),
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

describe("leakgrep reads upstream text a patch only quotes, today's tooling", () => {
  // Plant (red on the script before this change): any em dash in a patch file fails.
  for (const part of ["removed", "context"] as const) {
    it(`an em dash on an inner ${part} line of a patches/ file passes`, () => {
      for (const [mode, ran] of Object.entries(read("patches/upstream@1.0.0.patch", patch(part, dash)))) {
        expect(ran.status, `${mode}: ${ran.stderr}`).toBe(0);
      }
    });
  }

  // Plants: skip a whole patch file, or skip every line that starts with a space or a dash.
  for (const part of ["added", "header"] as const) {
    it(`an em dash on an inner ${part} line of a patches/ file still fails`, () => {
      for (const [mode, ran] of Object.entries(read("patches/upstream@1.0.0.patch", patch(part, dash)))) {
        expect(ran.status, mode).toBe(1);
        expect(ran.stderr, mode).toContain("leak em_dash");
      }
    });
  }

  // Plant: skip every shape on a quoted line, not only the style ones.
  for (const [kind, leak] of [
    ["private_word", word],
    ["machine_path", "/" + "home/someone/work"],
    ["key", `npm_${"a".repeat(36)}`],
    ["canvas", "https://claude.ai/" + "design/private"],
  ] as const) {
    it(`a ${kind} on an inner removed line of a patches/ file still fails`, () => {
      for (const [mode, ran] of Object.entries(read("patches/upstream@1.0.0.patch", patch("removed", leak)))) {
        expect(ran.status, mode).toBe(1);
        expect(ran.stderr, mode).toContain(`leak ${kind}`);
      }
    });
  }

  // Plant: match patches/ anywhere in the path, or skip any file shaped like a patch.
  for (const path of ["docs/upstream@1.0.0.patch", "next/patches/upstream@1.0.0.patch"]) {
    it(`an em dash on a removed-looking line of ${path} still fails`, () => {
      for (const [mode, ran] of Object.entries(read(path, patch("removed", dash)))) {
        expect(ran.status, mode).toBe(1);
        expect(ran.stderr, mode).toContain("leak em_dash");
      }
    });
  }
});
