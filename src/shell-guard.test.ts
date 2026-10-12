import {describe, expect, it} from "vitest";
import {guardHook, refusal} from "./shell-guard.ts";

const rules = {tree: "/trees/559-r1", alsoWritable: ["/repo/.fabrika", "/tmp"]};
const bash = (command: string) => refusal(rules, "Bash", {command});

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
		expect(refusal(rules, "Edit", {file_path: "/repo/packages/tea/README.md"})).toContain(
			"outside your working copy",
		);
		expect(refusal(rules, "Write", {file_path: "/trees/559-r1/docs/page.md"})).toBeNull();
		expect(refusal(rules, "Write", {file_path: "docs/page.md"})).toBeNull();
		expect(refusal(rules, "Write", {file_path: "../other/page.md"})).toContain(
			"outside your working copy",
		);
		expect(bash("echo hi > /repo/notes.md")).toContain("/repo/notes.md is outside");
		expect(bash("rm -rf /repo/packages")).toContain("outside");
		expect(bash("echo hi > /tmp/scratch.txt")).toBeNull();
		expect(
			bash(
				"node /repo/node_modules/.bin/fabrika lane report 559 --root /repo/.fabrika/lanes --token PASS",
			),
		).toBeNull();
		expect(bash("pnpm test 2>/dev/null")).toBeNull();
	});

	it("does not take a device, or a path with a subshell's bracket stuck to it, for a write outside", () => {
		// Both were refused on the second live run, and a builder had to word its command another way.
		expect(bash("D=$(readlink -f node_modules/x 2>/dev/null) && ls $D")).toBeNull();
		expect(bash("pnpm exec biome check --write src >/dev/stdout 2>&1 | tail -8")).toBeNull();
		expect(bash("x=$(cat a.txt > /repo/leak.txt)")).toContain("/repo/leak.txt is outside");
	});

	it("refuses an approval a shell would give under the account a person approves from, and lets it read for one", () => {
		expect(bash("gh pr review 630 --approve")).toContain("Do not approve");
		expect(bash("git status && gh pr review 630 -a -b 'looks right'")).toContain("Do not approve");
		expect(bash("gh api repos/o/r/pulls/630/reviews -f event=APPROVE")).toContain("Do not approve");
		expect(bash('gh pr comment 630 --body "control-plane-self-approval @ 03135b91"')).toContain(
			"Do not approve",
		);
		expect(
			bash("gh api repos/o/r/issues/630/comments -f body='control-plane-self-approval @ 03135b91'"),
		).toContain("Do not approve");
		expect(
			bash(
				"node /repo/node_modules/.bin/fabrika ship note 630 --body 'control-plane-self-approval @ 03135b91'",
			),
		).toContain("Do not approve");

		expect(bash("gh pr review 630 --comment -b 'one question'")).toBeNull();
		expect(
			bash("gh api repos/o/r/pulls/630/reviews --jq '.[] | select(.state == \"APPROVED\")'"),
		).toBeNull();
		expect(
			bash(
				"gh pr view 630 --json comments --jq '.comments[].body' | grep -c control-plane-self-approval",
			),
		).toBeNull();
		expect(
			bash("node /repo/node_modules/.bin/fabrika ship cp-approval 630 --sha 03135b91"),
		).toBeNull();
		expect(bash("gh pr comment 630 --body 'awaiting control-plane approval'")).toBeNull();
	});

	it("refuses a command left in the background, because the session ends with the shell's turn", () => {
		// On the second live run three builders in a row waited on CI in the background, ended their turn, and were gone.
		const wait = {command: "gh pr checks 628 --watch --interval 20", run_in_background: true};

		expect(refusal(rules, "Bash", wait)).toContain("Run this in the foreground");
		expect(refusal(rules, "Bash", {...wait, run_in_background: false})).toBeNull();
	});

	it("lets reads and ordinary commands through", () => {
		expect(refusal(rules, "Read", {file_path: "/repo/README.md"})).toBeNull();
		expect(bash("gh pr create --title x --body y")).toBeNull();
		expect(bash("gh pr view 12 --json state")).toBeNull();
		expect(bash("git commit -m 'fix: main page wording'")).toBeNull();
	});

	it("answers the SDK's hook with a deny and the reason, and tells the log", async () => {
		const seen: string[] = [];
		const hook = guardHook(rules, (tool, why) => seen.push(`${tool}: ${why}`));
		const call = {
			hook_event_name: "PreToolUse",
			tool_name: "Bash",
			tool_input: {command: "gh pr merge 1"},
		};

		expect(
			await hook(call as never, undefined, {signal: new AbortController().signal}),
		).toMatchObject({
			hookSpecificOutput: {permissionDecision: "deny"},
		});
		expect(seen).toHaveLength(1);
		expect(
			await hook({...call, tool_input: {command: "ls"}} as never, undefined, {
				signal: new AbortController().signal,
			}),
		).toEqual({});
	});
});

describe("the check with its read-only rule on", () => {
	const reads = {tree: "/tmp/review-1/code", alsoWritable: ["/tmp"], readOnly: true};
	const why = (tool: string, input: Record<string, unknown>) => refusal(reads, tool, input);

	it("lets the three reads through inside the tree, by a whole path or one from the tree", () => {
		expect(why("Read", {file_path: "/tmp/review-1/code/src/a.ts"})).toBeNull();
		expect(why("Read", {file_path: "src/a.ts"})).toBeNull();
		expect(why("Grep", {pattern: "exit 3"})).toBeNull();
		expect(why("Grep", {pattern: "/etc/passwd", path: "packages"})).toBeNull();
		expect(why("Glob", {pattern: "**/*.test.ts"})).toBeNull();
		expect(why("Glob", {pattern: "src/**/*.ts", path: "/tmp/review-1/code/packages"})).toBeNull();
	});

	it("refuses a read outside the tree, however the path is written", () => {
		expect(why("Read", {file_path: "/repo/.env"})).toContain(
			"/repo/.env is outside the code you were given",
		);
		expect(why("Read", {file_path: "../other/secret.txt"})).toContain(
			"outside the code you were given",
		);
		expect(why("Read", {file_path: "/tmp/review-1/code-of-another-run/a.ts"})).toContain("outside");
		expect(why("Grep", {pattern: "token", path: "/Users"})).toContain("/Users is outside");
		expect(why("Grep", {pattern: "token", path: "../.."})).toContain("outside");
		expect(why("Glob", {pattern: "/etc/*"})).toContain("/etc is outside");
		expect(why("Glob", {pattern: "../../**/*.pem"})).toContain("outside");
		expect(why("Glob", {pattern: "*.ts", path: "/repo"})).toContain("/repo is outside");
	});

	it("refuses every other tool, a write inside the tree and a harmless command among them", () => {
		expect(why("Write", {file_path: "/tmp/review-1/code/src/a.ts", content: ""})).toContain(
			"This run only reads. Write is not allowed here",
		);
		expect(why("Edit", {file_path: "src/a.ts"})).toContain("This run only reads");
		expect(why("Bash", {command: "ls"})).toContain("This run only reads. Bash is not allowed here");
		expect(why("Bash", {command: "gh pr comment 1 --body PASS"})).toContain("This run only reads");
		expect(why("WebFetch", {url: "https://example.com"})).toContain("This run only reads");
		expect(why("Agent", {prompt: "review this"})).toContain("This run only reads");
	});

	it("lets the SDK's own tool for a typed answer through: it touches nothing", () => {
		expect(why("StructuredOutput", {rows: [], findings: [], skipped: []})).toBeNull();
	});

	it("changes nothing for a shell that does not have the rule", () => {
		expect(refusal(rules, "Read", {file_path: "/repo/README.md"})).toBeNull();
		expect(refusal({...rules, readOnly: false}, "Bash", {command: "ls"})).toBeNull();
	});
});
