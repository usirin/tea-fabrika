import {describe, expect, it} from "vitest";
import {builderRefusal, promptOf} from "./builder.ts";
import type {BuildBrief} from "./form.ts";

// The builder's own rule and its prompt. No agent runs here.

const TREE = "/work/trees/1";
const TEMP = ["/private/tmp"];
const refused = (tool: string, input: Record<string, unknown>) =>
	builderRefusal(TREE, TEMP, tool, input);

describe("the builder's rule", () => {
	it("reads stay in the working copy and the temp folder", () => {
		expect(refused("Read", {file_path: `${TREE}/src/a.ts`})).toBeNull();
		expect(refused("Read", {file_path: "src/a.ts"})).toBeNull();
		expect(refused("Grep", {path: "/private/tmp/out"})).toBeNull();
		expect(refused("Read", {file_path: "/srv/elsewhere/.config/gh/hosts.yml"})).toContain(
			"outside your working copy",
		);
		expect(refused("Glob", {path: "../../.ssh"})).toContain("outside your working copy");
	});

	it.each([
		"gh pr create",
		"git push origin HEAD",
		"cd x && git fetch",
		"curl https://example.com",
		"pnpm publish",
		"git remote add up https://github.com/kamp-us/demlik",
		"git config credential.helper store",
	])("a command that talks to the network or GitHub is refused: %s", (command) => {
		expect(refused("Bash", {command})).toContain("no network");
	});

	it("a command that asks to leave the sandbox is refused; plain checks are not", () => {
		expect(refused("Bash", {command: "ls", dangerouslyDisableSandbox: true})).toContain("sandbox");
		expect(refused("Bash", {command: "nice -n 19 pnpm --filter @demlik/tea test"})).toBeNull();
		expect(refused("Bash", {command: "git diff --stat"})).toBeNull();
	});
});

describe("the builder's prompt", () => {
	const brief: BuildBrief = {
		ticket: "https://github.com/usirin/tea-fabrika-sandbox/issues/1",
		number: 1,
		title: "stop() hangs",
		body: "the body",
		criteria: [{n: 1, text: "it ends", checked: false, evidence: null}],
		round: 2,
		open: [
			{
				n: 1,
				text: "it ends",
				says: "no test proves it",
				where: ["src/a.ts:3"],
				wants: ["a test that fails at the base"],
			},
		],
		tree: TREE,
		branch: "build/1",
	};

	it("a later round is told what the last review left open, in the review's words", () => {
		const text = promptOf(brief);
		expect(text).toContain("no test proves it");
		expect(text).toContain("a test that fails at the base");
		expect(text).toContain("src/a.ts:3");
	});

	it("a first round is told nothing is open", () => {
		expect(promptOf({...brief, round: 1, open: []})).not.toContain("no test proves it");
	});
});
