import "./box.sh?raw";
import "./leakgrep.sh?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "./drive.ts?raw";
import "./fieldrow.py?raw";
import "./runplan.sh?raw";
import "./env.sh?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "./gc.ts?raw";
import "./redact.sh?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "./botpush.mjs?raw";
import "./clauderow.py?raw";
import "../../plan/scripts/plancheck.sh?raw";
import "../../step-commit/scripts/exam.py?raw";
import "../../step-commit/scripts/stepcommit.sh?raw";
import fc from "fast-check";
import {describe, expect, it} from "vitest";
import {
	checkHolds,
	laneRoot,
	laneStuck,
	lockfileBehind,
	startHead,
	wipOf,
	workspaceGlobs,
} from "./lane.ts";

// Today's tooling. Pure rules drive.ts and gc.ts share.
const options = {seed: 119120, numRuns: 300};
const branch = fc.stringMatching(/^fabrikalfa\/[a-z0-9]{1,8}(-[a-z0-9]{1,4})?$/);
const step = fc.constantFrom("tests", "build", "mutation", "review", "lead");

describe("lane rules, today's tooling", () => {
	// Plant: always append -wip. p12, 2026-11-09: a -wip lane was backed up to p12-wip-wip.
	it("the backup branch ends in exactly one -wip, and a -wip branch is kept as it is", () => {
		fc.assert(
			fc.property(branch, fc.nat({max: 3}), (b, n) => {
				const lane = b + "-wip".repeat(n);
				const to = wipOf(lane);
				expect(to).toMatch(/(?<!-wip)-wip$/);
				expect(to.replace(/-wip$/, "")).toBe(b);

				if (n === 1) {
					expect(to).toBe(lane);
				}
			}),
			options,
		);
	});

	// Plants: read only the branch's tip (the old rule); take the saved head over a newer tip; take the
	// first tip over a newer one. layers, 2026-11-09: a lead merge pushed only to -wip was skipped.
	it("starts at the newest of the branch, its -wip backup and the saved head; an off-branch save loses", () => {
		// One line of history, commits "c0" < "c1" < ...; "x<n>" is off the line and holds nothing.
		const at = (c: string) => Number(c.slice(1));
		const isAncestor = (a: string, b: string) =>
			a[0] === "c" && b[0] === "c" ? at(a) <= at(b) : a === b;
		const tip = fc.nat({max: 9}).map((n) => `c${n}`);
		fc.assert(
			fc.property(
				fc.option(tip, {nil: undefined}),
				fc.option(tip, {nil: undefined}),
				fc.option(
					fc.oneof(
						tip,
						fc.nat({max: 9}).map((n) => `x${n}`),
					),
					{nil: undefined},
				),
				(onBranch, onWip, saved) => {
					const pushed = [onBranch, onWip].filter((t): t is string => t !== undefined);
					const got = startHead(pushed, saved, isAncestor);
					const newest = pushed.toSorted((a, b) => at(b) - at(a))[0];
					const savedAhead =
						saved !== undefined &&
						(newest === undefined || (saved[0] === "c" && at(saved) > at(newest)));
					expect(got).toBe(savedAhead || newest === undefined ? saved : newest);
				},
			),
			options,
		);
	});

	// Plants: keep any saved root the base holds (the old rule); always take the fresh merge base.
	// ci375 tests6, 2026-11-09: after a catch-up, 48 of main's squash commits read as unsigned.
	it("the lane root is the fresh merge base unless the base holds a saved root the merge base does not", () => {
		// One line of history, "c0" < "c1" < ...; "x<n>" is off the line and holds nothing.
		const at = (c: string) => Number(c.slice(1));
		const isAncestor = (a: string, b: string) =>
			a[0] === "c" && b[0] === "c" ? at(a) <= at(b) : a === b;
		const on = fc.nat({max: 9});
		fc.assert(
			fc.property(
				on,
				on,
				fc.option(
					fc.oneof(
						on.map((n) => `c${n}`),
						on.map((n) => `x${n}`),
					),
					{nil: undefined},
				),
				(a, b, saved) => {
					const [fresh, base] = [`c${Math.min(a, b)}`, `c${Math.max(a, b)}`];
					const got = laneRoot(saved, fresh, base, isAncestor);
					const between =
						saved !== undefined &&
						saved[0] === "c" &&
						at(saved) > at(fresh) &&
						at(saved) <= at(base);
					expect(got).toBe(between ? saved : fresh);
				},
			),
			options,
		);
	});

	// Plants: waive every stale link; waive a stale link of a step the lane signed; waive other stuck.
	// themes tests4, 2026-11-09: PR 565's lead link on ticket 343 made the lane's tests step stale_link lead.
	it("holds every stuck answer except a stale link of a step the lane has not signed", () => {
		const answer = fc.oneof(
			fc.record({_tag: fc.constant("stuck"), why: fc.constant("stale_link"), step}),
			fc.record({
				_tag: fc.constant("stuck"),
				why: fc.constantFrom("unsigned_commit", "broken_chain"),
			}),
			fc.record({
				_tag: fc.constant("ask"),
				who: fc.constant("owner"),
				for: fc.constant("exam_read"),
			}),
		);
		fc.assert(
			fc.property(fc.array(answer), fc.uniqueArray(step), (answers, signed) => {
				const lane = new Set<string>(signed);
				const out = [...answers.map((a) => JSON.stringify(a)), "commits: noise"].join("\n");
				const held = laneStuck(out, lane).map((l) => JSON.parse(l));
				const want = answers.filter(
					(a) =>
						a._tag === "stuck" && !(a.why === "stale_link" && "step" in a && !lane.has(a.step)),
				);
				expect(held).toEqual(want);
				const stuck = answers.some((a) => a._tag === "stuck");
				expect(checkHolds(0, out, lane)).toBe(false);
				expect(checkHolds(1, out, lane)).toBe(want.length > 0 || !stuck);
				expect(checkHolds(2, out, lane)).toBe(true);
			}),
			options,
		);
	});
});

describe("the lockfile follows the manifests, today's tooling", () => {
	const globs = ["apps/*", "packages/*", "oxlint-plugins", "!packages/old"];
	const dep = fc.stringMatching(/^[a-z][a-z0-9-]{0,7}$/);
	const version = fc.stringMatching(/^[0-9]\.[0-9]{1,2}\.[0-9]$/);
	const deps = fc.dictionary(dep, version, {maxKeys: 4});
	const locked = fc.record({
		dependencies: deps,
		devDependencies: deps,
	});
	const loose = fc.record({
		scripts: fc.dictionary(dep, fc.string({maxLength: 6}), {maxKeys: 3}),
		version,
	});
	const member = fc.constantFrom(
		"package.json",
		"apps/fabrika/package.json",
		"oxlint-plugins/package.json",
	);
	const outside = fc.constantFrom(
		"fixtures/slugify/repo/package.json",
		"packages/old/package.json",
		"experiments/results/x-package.json",
	);
	const text = (o: object) => JSON.stringify(o, null, "\t");
	const reversed = (o: Record<string, unknown>) =>
		Object.fromEntries(Object.entries(o).toReversed());

	// Plant: compare scripts too; compare raw text; drop the reorder canon.
	it("a workspace manifest is behind exactly when a locked field changed, never on a reorder or other fields", () => {
		fc.assert(
			fc.property(member, locked, fc.option(locked), loose, loose, (path, a, other, la, lb) => {
				// Half the runs keep the locked fields and change only the rest.
				const b = other ?? a;
				const before = text({...la, ...a});
				const after = text(reversed({...lb, ...b, dependencies: reversed(b.dependencies)}));
				const moved =
					JSON.stringify(Object.entries(a.dependencies).toSorted()) !==
						JSON.stringify(Object.entries(b.dependencies).toSorted()) ||
					JSON.stringify(Object.entries(a.devDependencies).toSorted()) !==
						JSON.stringify(Object.entries(b.devDependencies).toSorted());
				expect(lockfileBehind([{path, before, after}], globs, false)).toEqual(moved ? [path] : []);
				// The step refreshed the lockfile itself, and CI's frozen install judges it.
				expect(lockfileBehind([{path, before, after}], globs, true)).toEqual([]);
			}),
			options,
		);
	});

	// Plant: count every package.json; forget a negated glob.
	it("a manifest outside the workspace never counts; an added, removed or unreadable one does", () => {
		fc.assert(
			fc.property(outside, member, locked, (out, path, a) => {
				expect(lockfileBehind([{path: out, before: null, after: text(a)}], globs, false)).toEqual(
					[],
				);
				expect(lockfileBehind([{path, before: null, after: text(a)}], globs, false)).toEqual([
					path,
				]);
				expect(lockfileBehind([{path, before: text(a), after: null}], globs, false)).toEqual([
					path,
				]);
				expect(lockfileBehind([{path, before: text(a), after: "{"}], globs, false)).toEqual([path]);
			}),
			options,
		);
	});

	// pinned: the workspace file itself moves the lockfile (catalog, overrides, packages).
	it("any change to pnpm-workspace.yaml counts, and the same text does not", () => {
		const path = "pnpm-workspace.yaml";
		expect(lockfileBehind([{path, before: "a: 1\n", after: "a: 2\n"}], globs, false)).toEqual([
			path,
		]);
		expect(lockfileBehind([{path, before: "a: 1\n", after: "a: 1\n"}], globs, false)).toEqual([]);
	});

	// format: the packages block as this repo writes it, comments and quotes included.
	it("reads the packages globs from pnpm-workspace.yaml", () => {
		const yaml = [
			"# a comment",
			"packages:",
			"  - apps/*",
			"  # next/: the new version",
			"  - 'next/packages/*'",
			'  - "!next/old"',
			"  - .github/ci",
			"",
			"catalog:",
			"  effect: 4.1.2",
		].join("\n");
		expect(workspaceGlobs(yaml)).toEqual(["apps/*", "next/packages/*", "!next/old", ".github/ci"]);
		expect(workspaceGlobs("catalog:\n  a: 1\n")).toEqual([]);
	});
});
