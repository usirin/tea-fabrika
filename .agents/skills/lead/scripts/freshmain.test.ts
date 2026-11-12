import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Today's tooling. Git is real, on disposable repos; pnpm is a stub that says what it was asked and
// which files it saw. The stub's lint is red only on a tree that holds both `head.txt` and
// `planted-red`: each side alone is green, as on the day of ticket 552.
const script = join(import.meta.dirname, "freshmain.ts");

const pnpm = `#!/bin/sh
echo "$* | $(ls | tr '\\n' ' ')" >>"$FRESHMAIN_CALLS"
if [ "$1" = lint ] && [ -f planted-red ] && [ -f head.txt ]; then
  for n in $(seq 40); do echo "planted lint line $n"; done
  exit 1
fi
exit 0
`;

type World = {
  /** What main gets after the head left it: file name to text. Empty: main did not move. */
  readonly main: Record<string, string>;
  /** The origin folder is gone before the check runs. */
  readonly offline?: boolean;
};

const check = (world: World) => {
  const dir = mkdtempSync(join(tmpdir(), "fm-"));

  try {
    const env = {
      ...process.env,
      PATH: `${join(dir, "bin")}:/usr/bin:/bin`,
      HOME: join(dir, "home"),
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_CONFIG_GLOBAL: "/dev/null",
      // As on a CI machine: git has no committer identity to fall back on.
      GIT_CONFIG_COUNT: "1",
      GIT_CONFIG_KEY_0: "user.useConfigOnly",
      GIT_CONFIG_VALUE_0: "true",
      FRESHMAIN_CALLS: join(dir, "calls"),
      TYPESAFE_API_KEY: undefined,
    };
    const git = (at: string, ...args: string[]) => {
      const got = spawnSync(
        "/usr/bin/git",
        ["-C", at, "-c", "user.name=Fixture", "-c", "user.email=fixture@example.test", ...args],
        { encoding: "utf8", env, timeout: 10_000 },
      );
      expect(got.status, got.stderr).toBe(0);
      return got.stdout.trim();
    };
    const origin = join(dir, "origin");
    const work = join(dir, "work");

    for (const folder of ["bin", "home", "origin"]) {
      mkdirSync(join(dir, folder));
    }

    writeFileSync(join(dir, "bin/pnpm"), pnpm, { mode: 0o755 });
    git(origin, "init", "-q", "--initial-branch=main");
    writeFileSync(join(origin, "base.txt"), "base\n");
    git(origin, "add", ".");
    git(origin, "commit", "-qm", "base");
    git(dir, "clone", "-q", origin, work);
    writeFileSync(join(work, "head.txt"), "head\n");
    writeFileSync(join(work, "base.txt"), "base, as the head has it\n");
    git(work, "add", ".");
    git(work, "commit", "-qm", "head");
    const tip = git(work, "rev-parse", "HEAD");

    for (const [name, text] of Object.entries(world.main)) {
      writeFileSync(join(origin, name), text);
    }

    if (Object.keys(world.main).length > 0) {
      git(origin, "add", ".");
      git(origin, "commit", "-qm", "main moved");
    }

    const main = git(origin, "rev-parse", "HEAD");

    if (world.offline) {
      rmSync(origin, { recursive: true });
    }

    const ran = spawnSync(process.execPath, [script, "900", tip], {
      cwd: work,
      encoding: "utf8",
      env,
      timeout: 60_000,
    });
    expect(ran.error).toBeUndefined();
    const calls = existsSync(env.FRESHMAIN_CALLS) ? readFileSync(env.FRESHMAIN_CALLS, "utf8").trim().split("\n") : [];
    return {
      code: ran.status,
      out: ran.stdout,
      err: ran.stderr,
      calls,
      tip,
      main,
      // The checkout is left at the checked head with nothing staged or changed.
      left: [git(work, "rev-parse", "HEAD"), git(work, "status", "--porcelain")],
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

describe("freshmain, today's tooling", () => {
  it("T552 scenario: main did not move, so nothing new runs (the common case must stay free)", () => {
    const got = check({ main: {} });
    expect(got.code, got.err).toBe(0);
    expect(got.calls).toEqual([]);
    expect(got.out + got.err).toBe("");
    expect(got.left).toEqual([got.tip, ""]);
  });

  it("T552 scenario: main moved and lint is green on the merged tree, so the merge may go on (lint must see both sides)", () => {
    const got = check({ main: { "other.txt": "main\n" } });
    expect(got.code, got.err).toBe(0);
    expect(got.calls).toHaveLength(2);
    expect(got.calls[0]).toMatch(/^install --frozen-lockfile --silent \| /);
    // Lint ran where the head's file and main's new file are both present.
    expect(got.calls[1]).toMatch(/^lint \| .*\bhead\.txt\b.*\bother\.txt\b/);
    expect(got.out).toContain(`pr 900: main moved to ${got.main.slice(0, 9)}`);
    expect(got.left).toEqual([got.tip, ""]);
  });

  it("T552 scenario: main moved and lint is red only on the merged tree, so the merge is refused (the hole ticket 552 names)", () => {
    const got = check({ main: { "planted-red": "main\n" } });
    expect(got.code).toBe(1);
    expect(got.err).toContain("pr 900: merge refused at the lint check");
    expect(got.err).toContain("pnpm lint is red on the head merged with it; the lane must merge main and push");
    // The check's last 30 lines are shown, not all 40.
    expect(got.err).toContain("planted lint line 40");
    expect(got.err).toContain("planted lint line 11\n");
    expect(got.err).not.toContain("planted lint line 10\n");
    expect(got.left).toEqual([got.tip, ""]);
  });

  it("T552 scenario: the head conflicts with the moved main, so the merge is refused before any check runs (no tree to lint)", () => {
    const got = check({ main: { "base.txt": "base, as main has it\n" } });
    expect(got.code).toBe(1);
    expect(got.err).toContain("pr 900: merge refused at the merge check");
    expect(got.err).toContain("the head conflicts with it; the lane must merge main and push");
    expect(got.calls).toEqual([]);
    expect(got.left).toEqual([got.tip, ""]);
  });

  it("T552 scenario: main cannot be fetched, so the merge is refused (an unknown main fails closed)", () => {
    const got = check({ main: { "planted-red": "main\n" }, offline: true });
    expect(got.code).toBe(1);
    expect(got.err).toContain("pr 900: merge refused at the fetch check");
    expect(got.calls).toEqual([]);
    expect(got.left).toEqual([got.tip, ""]);
  });

  it("T552 format: a head that is not a full commit ID is refused before git runs (catch-up always passes 40 hex)", () => {
    const ran = spawnSync(process.execPath, [script, "900", "main"], { encoding: "utf8", timeout: 60_000 });
    expect(ran.status).not.toBe(0);
  });
});
