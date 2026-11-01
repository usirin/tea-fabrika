import {readdirSync, readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {describe, expect, it} from "vitest";
import {fenced, fill, hashOfBrief, parseBrief} from "./briefs.ts";

// Today's version. The step briefs as they are on disk, and the small parts that fill them.

const FOLDER = fileURLToPath(new URL("../../../../../programs/pipeline/briefs/", import.meta.url));
const FILES = readdirSync(FOLDER).filter((file) => file.endsWith(".md"));

describe("the step briefs on disk", () => {
	it("one file for each step that runs an agent", () => {
		expect([...FILES].sort()).toEqual([
			"build.md",
			"exam.md",
			"plan.md",
			"review.md",
			"test-writer-mutants.md",
			"test-writer.md",
			"triage.md",
		]);
	});

	it.each(FILES)("%s declares every slot its text uses", (file) => {
		const brief = parseBrief(file, readFileSync(`${FOLDER}${file}`, "utf8"));
		expect(brief.body.length).toBeGreaterThan(0);
		for (const [, slot] of brief.body.matchAll(/\{([a-z_]+)\}/g))
			expect(brief.slots).toContain(slot);
	});

	it("a slot is used, but for a note, which comes back as a turn of its own", () => {
		const unused = FILES.flatMap((file) => {
			const brief = parseBrief(file, readFileSync(`${FOLDER}${file}`, "utf8"));
			return brief.slots.flatMap((slot) =>
				slot === "note" || brief.body.includes(`{${slot}}`) ? [] : [`${file}: ${slot}`],
			);
		});
		// As compiled: this brief declares the ticket and never shows it to the agent.
		expect(unused).toEqual(["test-writer-mutants.md: ticket"]);
	});
});

describe("a brief's parts", () => {
	const TEXT =
		"---\nstep: plan\nslots:\n  ticket: its text\n  rules: the rules\n---\nDo {ticket} by {rules}. {other}\n";

	it("reads the slots and the body, and hashes the whole file", () => {
		const brief = parseBrief("plan.md", TEXT);
		expect(brief.slots).toEqual(["ticket", "rules"]);
		expect(brief.body).toBe("Do {ticket} by {rules}. {other}");
		expect(brief.hash).toBe(hashOfBrief(TEXT));
		expect(brief.hash).not.toBe(hashOfBrief(`${TEXT} `));
	});

	it("a value is never read as a slot, a missing one says so, and other braces stay", () => {
		const brief = parseBrief("plan.md", TEXT);
		expect(fill(brief, {ticket: "{rules}"})).toBe("Do {rules} by (none). {other}");
	});

	it("a fence outlasts the backticks inside it, so a ticket's text cannot close it", () => {
		expect(fenced("a ``` b", "text")).toBe("````text\na ``` b\n````");
	});
});
