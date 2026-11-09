import "./box.sh?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "./drive.ts?raw";
import "./fieldrow.py?raw";
import "./runplan.sh?raw";
import "./env.sh?raw";
import "./redact.sh?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "./botpush.mjs?raw";
import "./clauderow.py?raw";
import "../../plan/scripts/plancheck.sh?raw";
import "../../step-commit/scripts/exam.py?raw";
import "../../step-commit/scripts/stepcommit.sh?raw";
import fc from "fast-check";
import {describe, expect, it} from "vitest";
import {backupsOf, decide, IDLE, type Seen, STUCK} from "./gc.ts";

// Today's tooling. The decision is pure; the world (lsof, git, gh, botpush) is not run here.
const sha = fc.stringMatching(/^[0-9a-f]{40}$/);
const seen = fc.record({
	name: fc.stringMatching(/^[a-z][a-z0-9]{0,12}$/),
	git: fc.option(
		fc.record({
			head: fc.option(sha, {nil: null}),
			branch: fc.option(fc.stringMatching(/^(fabrikalfa|person)\/[a-z0-9-]{1,10}(-wip)?$/), {
				nil: null,
			}),
		}),
		{nil: null},
	),
	busy: fc.boolean(),
	idle: fc.integer({min: 0, max: 3 * STUCK}),
	stuck: fc.option(fc.integer({min: 0, max: 3 * STUCK}), {nil: null}),
	merged: fc.boolean(),
	onRemote: fc.boolean(),
}) satisfies fc.Arbitrary<Seen>;
const options = {seed: 119120, numRuns: 300};

describe("box gc, today's tooling", () => {
	// Plants: drop the busy check; drop the 2 h wait; drop the 24 h wait on a kept stuck box.
	it("never touches a box in use, touched in the last 2 h, or kept stuck under 24 h", () => {
		fc.assert(
			fc.property(seen, (s) => {
				const v = decide(s);
				const young = s.busy || s.idle < IDLE || (s.stuck !== null && s.stuck < STUCK);
				const mustKeep = young || s.git === null || s.git.head === null;
				expect(mustKeep && v._tag !== "keep", JSON.stringify(s)).toBe(false);
			}),
			options,
		);
	});

	// Plants: remove a box whose HEAD is on no remote and has no merged pull request.
	it("removes outright only what a merged pull request or a remote branch already holds", () => {
		fc.assert(
			fc.property(seen, (s) => {
				const v = decide(s);
				const held = s.merged || s.onRemote;
				expect(v._tag === "remove" && !held).toBe(false);
				expect(v._tag === "backup" && (held || v.to.length === 0)).toBe(false);
			}),
			options,
		);
	});

	// Plants: keep an idle box forever; skip the backup of unpushed work.
	it("an idle box with a HEAD is always removed or backed up, never kept", () => {
		fc.assert(
			fc.property(seen, sha, (s, head) => {
				const idle = {...s, git: {head, branch: s.git?.branch ?? null}, busy: false};
				const v = decide({...idle, idle: IDLE + s.idle, stuck: s.stuck === null ? null : STUCK});
				expect(v._tag === "remove" || v._tag === "backup").toBe(true);
			}),
			options,
		);
	});

	// Plants: back up to a branch the bot may not push; drop the -wip; double the -wip.
	it("backups go to a fabrikalfa/ -wip branch, the box's own branch first", () => {
		fc.assert(
			fc.property(seen, ({name, git}) => {
				const to = backupsOf(name, git?.branch ?? null);
				for (const b of to) expect(b).toMatch(/^fabrikalfa\/.+(?<!-wip)-wip$/);
				expect(to.at(-1)).toBe(`fabrikalfa/${name}-wip`);
				expect(new Set(to).size).toBe(to.length);
				const base = git?.branch?.replace(/(-wip)+$/, "");
				if (base?.startsWith("fabrikalfa/")) expect(to[0]).toBe(`${base}-wip`);
			}),
			options,
		);
	});
});
