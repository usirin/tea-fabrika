import { describe, expect, it } from "vitest";
import { guardHook, refusal } from "./shell-guard.ts";

const rules = { tree: "/trees/559-r1", alsoWritable: ["/repo/.fabrika", "/tmp"] };
const bash = (command: string) => refusal(rules, "Bash", { command });

describe("the check before each step of a shell", () => {
  it("refuses a merge by hand, an armed auto-merge and a deleted branch, alone or inside a chain", () => {
    expect(bash("gh pr merge 12 --squash")).toContain("Do not merge by hand");
    expect(bash("git status && gh pr merge 12")).toContain("Do not merge by hand");
    expect(bash("gh pr edit 12 --auto")).toContain("`--auto`");
    expect(bash("gh pr close 12 --delete-branch")).toContain("`--delete-branch`");
  });

  it("refuses a push to main however it is spelled, and lets a push of the shell's own branch through", () => {
    expect(bash("git push origin main")).toContain("Do not push to main");
    expect(bash("git push origin HEAD:main")).toContain("Do not push to main");
    expect(bash("git push --force origin fix:refs/heads/main")).toContain("Do not push to main");
    expect(bash("git push -u origin fix/559-ts1309-text")).toBeNull();
    expect(bash("git push origin HEAD:fix/main-page")).toBeNull();
  });

  it("refuses a second working copy, so the lane has the one the machine made", () => {
    expect(bash("git worktree add ../other -b x")).toContain("already in one");
    expect(bash("git worktree list")).toBeNull();
  });

  it("refuses a write outside the working copy by a tool or by a command's shape, and allows the ledger and temp", () => {
    expect(refusal(rules, "Edit", { file_path: "/repo/packages/tea/README.md" })).toContain("outside your working copy");
    expect(refusal(rules, "Write", { file_path: "/trees/559-r1/docs/page.md" })).toBeNull();
    expect(refusal(rules, "Write", { file_path: "docs/page.md" })).toBeNull();
    expect(refusal(rules, "Write", { file_path: "../other/page.md" })).toContain("outside your working copy");
    expect(bash("echo hi > /repo/notes.md")).toContain("/repo/notes.md is outside");
    expect(bash("rm -rf /repo/packages")).toContain("outside");
    expect(bash("echo hi > /tmp/scratch.txt")).toBeNull();
    expect(bash("node /repo/node_modules/.bin/fabrika lane report 559 --root /repo/.fabrika/lanes --token PASS")).toBeNull();
    expect(bash("pnpm test 2>/dev/null")).toBeNull();
  });

  it("lets reads and ordinary commands through", () => {
    expect(refusal(rules, "Read", { file_path: "/repo/README.md" })).toBeNull();
    expect(bash("gh pr create --title x --body y")).toBeNull();
    expect(bash("gh pr view 12 --json state")).toBeNull();
    expect(bash("git commit -m 'fix: main page wording'")).toBeNull();
  });

  it("answers the SDK's hook with a deny and the reason, and tells the log", async () => {
    const seen: string[] = [];
    const hook = guardHook(rules, (tool, why) => seen.push(`${tool}: ${why}`));
    const call = { hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: "gh pr merge 1" } };

    expect(await hook(call as never, undefined, { signal: new AbortController().signal })).toMatchObject({
      hookSpecificOutput: { permissionDecision: "deny" },
    });
    expect(seen).toHaveLength(1);
    expect(await hook({ ...call, tool_input: { command: "ls" } } as never, undefined, { signal: new AbortController().signal })).toEqual({});
  });
});
