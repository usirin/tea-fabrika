import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, matchesGlob, relative, resolve } from "node:path";
import type { Options } from "@anthropic-ai/claude-agent-sdk";
import { wrapCommandWithSandboxMacOS } from "@anthropic-ai/sandbox-runtime/dist/sandbox/macos-sandbox-utils.js";
import { afterEach, describe, expect, it } from "vitest";
import { harnessOf } from "./harness.ts";

// T237 review 2, finding 1. Today's version. An injected Bash command must not plant code
// that a later commit, cd, Claude session or pipeline start runs outside the agent's sandbox.
// Every path below must refuse both shell writes and the SDK's Edit/Write tools.
const REFUSED = [
  ".fabrika/fabrika.toml",
  ".fabrika/nested/state.json",
  ".envrc",
  ".husky/pre-commit",
  ".husky/_/pre-commit",
  ".claude/settings.json",
  ".claude/settings.local.json",
  ".claude/commands/run.md",
  ".claude/agents/scout.md",
  ".claude/plugins/cache.json",
  ".github/workflows/ci.yml",
  ".github/workflows/nested/ci.yml",
] as const;

const ORIGINAL = "original repo configuration\n";
const INJECTED = "T237-injected-command";
const made: string[] = [];

afterEach(() => {
  for (const folder of made.splice(0)) {
    rmSync(folder, { recursive: true, force: true });
  }
});

const fixture = () => {
  const folder = realpathSync(mkdtempSync(join(tmpdir(), "harness-write-")));
  made.push(folder);

  for (const path of [...REFUSED, "src/change.ts"]) {
    mkdirSync(dirname(join(folder, path)), { recursive: true });
    writeFileSync(join(folder, path), ORIGINAL);
  }

  const h = harnessOf("claude", folder, null);
  const options = (h.meta as { claudeCode: { options: Options } }).claudeCode.options;
  return { folder, options };
};

// A literal directory deny protects its children too; SDK globs are relative unless prefixed //.
const covers = (folder: string, pattern: string, path: string) => {
  const glob = pattern.startsWith("//") ? pattern.slice(1) : pattern.replace(/^\.\//, "");
  let name = resolve(folder, path);

  while (name !== folder) {
    if (matchesGlob(isAbsolute(glob) ? name : relative(folder, name), glob)) {
      return true;
    }

    name = dirname(name);
  }

  return false;
};

describe("T237-R2-1: injected writes cannot change future commands", () => {
  it("denies every protected path to Bash while ordinary source stays writable", () => {
    const { folder, options } = fixture();
    const files = options.sandbox?.filesystem;
    expect(options.sandbox).toMatchObject({ enabled: true, allowUnsandboxedCommands: false });
    expect(files?.allowWrite).toContain(folder);
    const denies = files?.denyWrite ?? [];
    expect(denies.some((rule) => covers(folder, rule, "src/change.ts"))).toBe(false);
    expect(REFUSED.filter((path) => !denies.some((rule) => covers(folder, rule, path)))).toEqual([]);
  });

  it("also denies every protected path to Edit/Write, which do not run inside the Bash sandbox", () => {
    const { folder, options } = fixture();
    const settings = options.settings;
    const denies = (typeof settings === "object" ? (settings.permissions?.deny ?? []) : []).flatMap((rule) => {
      const match = /^Edit\((.*)\)$/.exec(rule);
      return match?.[1] === undefined ? [] : [match[1]];
    });
    expect(denies.some((rule) => covers(folder, rule, "src/change.ts"))).toBe(false);
    expect(REFUSED.filter((path) => !denies.some((rule) => covers(folder, rule, path)))).toEqual([]);
  });
});

// Like harness.env.laws.test.ts: no model, the real OS sandbox, and a visible skip in an agent
// box that cannot start Seatbelt. The lead runs these laws outside that box.
const seatbelt = spawnSync("/usr/bin/sandbox-exec", ["-p", "(version 1)(allow default)", "/usr/bin/true"], {
  encoding: "utf8",
});

const nested = seatbelt.stderr?.includes("sandbox_apply: Operation not permitted") ?? false;
const noSeatbelt = process.platform !== "darwin" || seatbelt.error !== undefined || nested;
const word = (text: string) => `'${text.replaceAll("'", `'\\''`)}'`;

describe.skipIf(noSeatbelt)("T237-R2-1: real sandbox refuses planted commands", () => {
  const run = (f: ReturnType<typeof fixture>, command: string) => {
    const files = f.options.sandbox!.filesystem!;
    const path = (p: string) => (isAbsolute(p) ? p : resolve(f.folder, p));
    const wrapped = wrapCommandWithSandboxMacOS({
      command,
      needsNetworkRestriction: false,
      readConfig: {
        denyOnly: (files.denyRead ?? []).map(path),
        allowWithinDeny: (files.allowRead ?? []).map(path),
      },
      writeConfig: {
        allowOnly: (files.allowWrite ?? []).map(path),
        denyWithinAllow: (files.denyWrite ?? []).map(path),
      },
      binShell: "/bin/sh",
    });
    return spawnSync("/bin/sh", ["-c", wrapped], { cwd: f.folder, encoding: "utf8" });
  };

  it.each(REFUSED)("refuses to alter or create %s even when Bash is auto-allowed", (path) => {
    const f = fixture();
    const control = run(f, `printf '%s\\n' ordinary-change >> src/change.ts`);
    expect(control.error, control.stderr).toBeUndefined();
    expect(control.status, control.stderr).toBe(0);
    expect(readFileSync(join(f.folder, "src/change.ts"), "utf8")).toContain("ordinary-change");
    const altered = run(f, `printf '%s\\n' ${word(INJECTED)} >> ${word(path)}`);
    expect(altered.error, altered.stderr).toBeUndefined();
    expect.soft(altered.status, `write to existing ${path}`).not.toBe(0);
    expect.soft(readFileSync(join(f.folder, path), "utf8"), path).toBe(ORIGINAL);
    rmSync(join(f.folder, path));
    const created = run(f, `printf '%s\\n' ${word(INJECTED)} > ${word(path)}`);
    expect(created.error, created.stderr).toBeUndefined();
    expect(created.status, `create ${path}`).not.toBe(0);
  });
});
