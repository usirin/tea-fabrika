// The commit check's pure core (Tier 1, P32; laws p83 to p87 and p89 in docs/plan/tier-1-detail.md),
// on built data with no process, so the mutation step runs fast. The planted repos are in
// commits-git.test.ts. Also the real exam list's rows and the workflow file's text (hole 4).
import {readFileSync} from "node:fs";
import {join} from "node:path";
import {Option} from "effect";
import {describe, expect, it} from "vitest";
import {
	type Answer,
	annotate,
	chain,
	check,
	type Commit,
	decodeExam,
	decodeLink,
	decodeNote,
	examMatcher,
	inScope,
	keysProblem,
	type Link,
	type Logged,
	type Note,
	plain,
	type PullRequest,
	type Role,
	type Signed,
	signedText,
	staleSteps,
} from "./commits.ts";

const ROOT = join(import.meta.dirname, "..", "..", "..", "..", "..");

const T = (c: string) => c.repeat(40);
const A = T("a");
const B = T("b");
const C = T("c");
const D = T("d");
const E = T("e");

const note = (step: Role, from: string, to: string, more: Partial<Note> = {}): Note => ({
	_tag: "attested",
	step,
	ticket: "229",
	version: 1,
	from,
	to,
	key: "SHA256:x",
	sig: "-----BEGIN SSH SIGNATURE-----\n",
	...more,
});
const signed = (n: Note, signer: Role | null = n.step): Signed => ({note: n, signer});

let shas = 0;
const commit = (from: string, to: string, s: Signed | null, paths: string[] = []): Commit => {
	shas += 1;
	return {sha: `c${shas}`, tree: to, parentTree: from, paths, signed: s};
};

const EXAM = examMatcher([
	{glob: "exam-paths.json", why: ""},
	{glob: "boundary-rules.json", why: ""},
	{glob: ".github/**", why: ""},
	{glob: "next/apps/fabrika/src/exam/**", why: ""},
	{glob: "next/**/*.test.ts", why: ""},
	{glob: "fixtures/next/**", why: ""},
]);

const pr = (commits: Commit[], more: Partial<PullRequest> = {}): PullRequest => ({
	head: "head",
	containsBase: true,
	changed: commits.flatMap((c) => c.paths),
	commits,
	notes: commits.flatMap((c) => (c.signed === null ? [] : [c.signed])),
	...more,
});
const answers = (p: PullRequest) => check(p, EXAM).answers;
const DONE = {_tag: "done"};
const stuck = (why: string, sha: string, more: object = {}) => ({_tag: "stuck", why, sha, ...more});

describe("signedText", () => {
	it("is the link in v2, byte for byte: a change here is a change to the exam", () => {
		expect(signedText({step: "build", ticket: "229", version: 3, from: A, to: B})).toBe(
			`fabrika-step attested v2\nstep build\nticket 229\nversion 3\nfrom ${A}\nto ${B}\n`,
		);
	});

	it("names no commit and no parents, and reads only the link's own fields", () => {
		const text = signedText(note("tests", A, B, {key: "other", sig: "other"}));
		expect(text).toBe(signedText(note("tests", A, B)));
		expect(text).not.toContain("commit");
	});
});

describe("decodeNote", () => {
	const json = (n: object) => JSON.stringify(n);
	it("reads an attested note", () => {
		expect(Option.isSome(decodeNote(json(note("tests", A, B))))).toBe(true);
	});

	it.each([
		["not JSON", "step tests"],
		["another _tag", json({...note("tests", A, B), _tag: "committed"})],
		["a fourth role", json({...note("tests", A, B), step: "owner"})],
		["a ticket that is not a number", json({...note("tests", A, B), ticket: "229\nstep lead"})],
		["version 0", json({...note("tests", A, B), version: 0})],
		["a version that is not whole", json({...note("tests", A, B), version: 1.5})],
		["a short tree", json({...note("tests", A, B), from: "abc"})],
		["a tree with a newline", json({...note("tests", A, B), to: `${B}\nx`})],
		["no sig", json({...note("tests", A, B), sig: undefined})],
	])("refuses %s", (_, text) => {
		expect(Option.isNone(decodeNote(text))).toBe(true);
	});
});

const KEY = (c: string) => `AAAAC3NzaC1lZDI1NTE5AAAAI${c.repeat(43)}`;
const line = (role: string, key: string) => `${role} namespaces="fabrika-step" ssh-ed25519 ${key}`;
const GOOD = [line("tests", KEY("A")), line("build", KEY("B")), line("lead", KEY("C"))];

describe("keysProblem (p87)", () => {
	it("passes the three roles, one key each, with or without a last newline", () => {
		expect(keysProblem(GOOD.join("\n"))).toBeNull();
		expect(keysProblem(`${GOOD.join("\n")}\n`)).toBeNull();
	});

	it("passes a second key for one role, as when a key is rotated", () => {
		expect(keysProblem([...GOOD, line("build", KEY("D"))].join("\n"))).toBeNull();
	});

	it.each([
		["no file", null],
		[
			"an ECDSA key",
			[GOOD[0], GOOD[1], 'lead namespaces="fabrika-step" ecdsa-sha2-nistp256 AAAAE2VjZHNh'].join(
				"\n",
			),
		],
		["one key under tests and build", [GOOD[0], line("build", KEY("A")), GOOD[2]].join("\n")],
		["a fourth role", [...GOOD, line("owner", KEY("D"))].join("\n")],
		["a missing namespace", [GOOD[0], GOOD[1], `lead ssh-ed25519 ${KEY("C")}`].join("\n")],
		[
			"another namespace",
			[GOOD[0], GOOD[1], line("lead", KEY("C")).replace("fabrika-step", "git")].join("\n"),
		],
		[
			"a second option",
			[
				GOOD[0],
				GOOD[1],
				line("lead", KEY("C")).replace("namespaces", "cert-authority,namespaces"),
			].join("\n"),
		],
		[
			"a valid-after option",
			[
				GOOD[0],
				GOOD[1],
				`lead valid-after="20260101",namespaces="fabrika-step" ssh-ed25519 ${KEY("C")}`,
			].join("\n"),
		],
		["a role left out", [GOOD[0], GOOD[1]].join("\n")],
		["a blank line inside", [GOOD[0], "", GOOD[1], GOOD[2]].join("\n")],
		["a key cut short", [GOOD[0], GOOD[1], line("lead", KEY("C").slice(0, 60))].join("\n")],
		["the placeholder", "PLACEHOLDER, not a key."],
	])("refuses %s, naming why", (_, text) => {
		expect(keysProblem(text)).toEqual(expect.any(String));
	});

	it("names the line it refused", () => {
		expect(keysProblem([...GOOD, "build oops"].join("\n"))).toContain('"build oops"');
	});
});

describe("examMatcher and the scope rule", () => {
	it.each([
		"exam-paths.json",
		".github/workflows/x.yaml",
		"next/apps/fabrika/src/exam/commits.ts",
		"next/a.test.ts",
		"next/packages/x/src/deep/a.test.ts",
		"next/packages/.hidden/a.test.ts",
		"fixtures/next/sshsig/allowed_signers",
		"docs/a\nb.md",
		"docs/a\rb.md",
		"docs/\u007f.md",
	])("counts %j as an exam path", (path) => {
		expect(EXAM(path)).toBe(true);
	});

	it.each([
		"next/packages/x/src/a.ts",
		"next/a.test.tsx",
		"boundary-rules.json.bak",
		"x/boundary-rules.json",
		"fixtures/nextx/a",
		"exam-pathsxjson",
		"docs/x.md",
	])("does not count %j", (path) => {
		expect(EXAM(path)).toBe(false);
	});

	it("judges a change under next/ or on the list, and nothing else", () => {
		expect(inScope(["docs/x.md", "field/notes.jsonl"], EXAM)).toBe(false);
		expect(inScope(["docs/x.md", "next/packages/x/src/a.ts"], EXAM)).toBe(true);
		expect(inScope(["boundary-rules.json"], EXAM)).toBe(true);
		expect(inScope([], EXAM)).toBe(false);
	});
});

describe("the real exam-paths.json", () => {
	const list = decodeExam(readFileSync(join(ROOT, "exam-paths.json"), "utf8"));
	const globs = Option.isSome(list) ? list.value.map((row) => row.glob) : [];

	it("reads, and every row says why", () => {
		expect(Option.isSome(list)).toBe(true);
		expect(Option.getOrThrow(list).every((row) => row.why.length > 0)).toBe(true);
	});

	it.each([
		"exam-paths.json",
		"allowed_signers",
		".github/**",
		"next/apps/fabrika/src/exam/**",
		"next/**/*.test.ts",
		"next/**/*.test.tsx",
		"fixtures/next/**",
		".oxlintrc.json",
		".oxfmtrc.json",
		"oxlint-plugins/**",
		"vitest.config.ts",
		"layer-rules.json",
		"boundary-rules.json",
		"pnpm-workspace.yaml",
		"compiler-ledger.json",
		"unreachable-ledger.json",
		"package.json",
		"tsconfig.base.json",
		"patches/**",
		"next/apps/fabrika/e2e.ts",
		"next/apps/fabrika/e2e/**",
	])("names %s", (glob) => {
		expect(globs).toContain(glob);
	});

	it("covers this check's own files", () => {
		const isExam = examMatcher(Option.getOrThrow(list));
		for (const path of [
			"next/apps/fabrika/src/exam/commits.ts",
			"next/apps/fabrika/src/exam/commits.test.ts",
			".github/workflows/commits.yaml",
			"allowed_signers",
			"exam-paths.json",
		])
			expect(isExam(path)).toBe(true);
	});
});

describe("check (p83, a commit counts only when its role signed a link that fits it)", () => {
	it("is done when every commit is signed by its role off the list", () => {
		const t = commit(A, B, signed(note("tests", A, B)), ["next/x/a.ts"]);
		const b = commit(B, C, signed(note("build", B, C)), ["next/x/b.ts"]);
		expect(answers(pr([t, b]))).toEqual([DONE]);
		expect(check(pr([t, b]), EXAM).ticket).toBe("229");
	});

	it.each([
		["no note", null],
		["no verified signer", signed(note("tests", A, B), null)],
		["another role's key", signed(note("tests", A, B), "build")],
		["a from that is not the parent's tree", signed(note("tests", C, B))],
		["a to that is not the commit's tree", signed(note("tests", A, C))],
	])("is unsigned_commit with %s", (_, s) => {
		const c = commit(A, B, s);
		expect(answers(pr([c]))).toEqual([stuck("unsigned_commit", c.sha)]);
	});

	it("is unsigned_commit for a link naming another ticket than the pull request's", () => {
		const t = commit(A, B, signed(note("tests", A, B)));
		const b = commit(B, C, signed(note("build", B, C, {ticket: "230"})));
		expect(answers(pr([t, b]))).toEqual([stuck("unsigned_commit", b.sha)]);
	});

	it("lists every stuck, one per commit, not only the first", () => {
		const c1 = commit(A, B, null);
		const c2 = commit(B, C, null);
		expect(answers(pr([c1, c2]))).toEqual([
			stuck("unsigned_commit", c1.sha),
			stuck("unsigned_commit", c2.sha),
		]);
	});
});

describe("check (p84, a build commit never touches the exam)", () => {
	it("is build_touched_exam with the paths sorted", () => {
		const b = commit(A, B, signed(note("build", A, B)), [
			"next/x.ts",
			"fixtures/next/v",
			"boundary-rules.json",
		]);
		expect(answers(pr([b]))[0]).toEqual(
			stuck("build_touched_exam", b.sha, {paths: ["boundary-rules.json", "fixtures/next/v"]}),
		);
	});

	it("lets tests and lead commits touch exam paths, asking the owner instead", () => {
		const t = commit(A, B, signed(note("tests", A, B)), ["next/x/a.test.ts"]);
		const l = commit(B, C, signed(note("lead", B, C)), ["boundary-rules.json"]);
		expect(answers(pr([t, l]))).toEqual([
			{
				_tag: "ask",
				who: "owner",
				for: "exam_read",
				paths: ["boundary-rules.json", "next/x/a.test.ts"],
			},
		]);
	});

	it("judges an unsigned commit's files not at all: unsigned_commit only", () => {
		const c = commit(A, B, null, ["next/apps/fabrika/src/exam/commits.ts"]);
		expect(answers(pr([c], {changed: []}))).toEqual([stuck("unsigned_commit", c.sha)]);
	});

	it("puts unsigned_commit before build_touched_exam for a build note that does not fit", () => {
		const c = commit(A, B, signed(note("build", A, C)), ["boundary-rules.json"]);
		expect(answers(pr([c], {changed: []}))).toEqual([stuck("unsigned_commit", c.sha)]);
	});
});

describe("check (p85, any exam path asks the owner)", () => {
	it("asks beside every stuck, from the pull request's own change", () => {
		const c = commit(A, B, null, ["next/x/a.test.ts"]);
		expect(answers(pr([c]))).toEqual([
			stuck("unsigned_commit", c.sha),
			{_tag: "ask", who: "owner", for: "exam_read", paths: ["next/x/a.test.ts"]},
		]);
	});

	it("reads the change it is given, not each commit's files", () => {
		const t = commit(A, B, signed(note("tests", A, B)), ["next/x/a.test.ts"]);
		expect(answers(pr([t], {changed: ["next/x/a.ts"]}))).toEqual([DONE]);
	});

	it("names each path once", () => {
		const t = commit(A, B, signed(note("tests", A, B)));
		expect(answers(pr([t], {changed: ["exam-paths.json", "exam-paths.json"]}))).toEqual([
			{_tag: "ask", who: "owner", for: "exam_read", paths: ["exam-paths.json"]},
		]);
	});
});

describe("check (p86 at pull request time, the head contains the base)", () => {
	it("is broken_chain on the head when the branch is behind", () => {
		const t = commit(A, B, signed(note("tests", A, B)));
		expect(answers(pr([t], {containsBase: false}))).toEqual([stuck("broken_chain", "head")]);
	});
});

describe("check (p89, only a step's newest signature for this ticket counts)", () => {
	it("is stale_link when a newer link of the step is left out of the chain", () => {
		const t1 = commit(A, B, signed(note("tests", A, B)));
		const b = commit(B, C, signed(note("build", B, C)));
		const v2 = signed(note("tests", A, D, {version: 2}));
		expect(answers(pr([t1, b], {notes: [t1.signed!, b.signed!, v2]}))).toEqual([
			stuck("stale_link", t1.sha, {step: "tests"}),
		]);
	});

	it("is stale_link for both links of a tie, and picks neither", () => {
		const t = commit(A, B, signed(note("tests", A, B, {version: 2})));
		const other = signed(note("tests", A, D, {version: 2}));
		expect(answers(pr([t], {notes: [t.signed!, other]}))).toEqual([
			stuck("stale_link", t.sha, {step: "tests"}),
		]);
	});

	it("is done with tests v1, build, then tests v2 after the mutation step", () => {
		const t1 = commit(A, B, signed(note("tests", A, B)));
		const b = commit(B, C, signed(note("build", B, C)));
		const t2 = commit(C, D, signed(note("tests", C, D, {version: 2})));
		expect(answers(pr([t1, b, t2]))).toEqual([DONE]);
	});

	it("is stale_link when an older link comes after the newest", () => {
		const t2 = commit(A, B, signed(note("tests", A, B, {version: 2})));
		const t1 = commit(B, C, signed(note("tests", B, C)));
		expect(answers(pr([t2, t1]))).toEqual([
			stuck("stale_link", t2.sha, {step: "tests"}),
			stuck("stale_link", t1.sha, {step: "tests"}),
		]);
	});

	it("ignores a note that does not verify, whatever version it claims", () => {
		const t = commit(A, B, signed(note("tests", A, B)));
		const fake = signed(note("tests", A, E, {version: 99}), null);
		const wrongKey = signed(note("tests", A, E, {version: 98}), "build");
		expect(answers(pr([t], {notes: [t.signed!, fake, wrongKey]}))).toEqual([DONE]);
	});

	it("ignores another ticket's links", () => {
		const t = commit(A, B, signed(note("tests", A, B)));
		const other = signed(note("tests", A, E, {version: 5, ticket: "230"}));
		expect(answers(pr([t], {notes: [t.signed!, other]}))).toEqual([DONE]);
	});

	it("is stale_link on the head when the step's newest link has no commit here at all", () => {
		const b = commit(A, B, signed(note("build", A, B)));
		const tests = signed(note("tests", T("9"), A));
		expect(answers(pr([b], {notes: [b.signed!, tests]}))).toEqual([
			stuck("stale_link", "head", {step: "tests"}),
		]);
	});

	it("gives build_touched_exam over stale_link for one commit", () => {
		const b = commit(A, B, signed(note("build", A, B)), ["boundary-rules.json"]);
		const newer = signed(note("build", A, C, {version: 2}));
		expect(answers(pr([b], {changed: [], notes: [b.signed!, newer]}))).toEqual([
			stuck("build_touched_exam", b.sha, {paths: ["boundary-rules.json"]}),
		]);
	});

	it("staleSteps names nothing for a step with no links", () => {
		expect(staleSteps("229", [], [])).toEqual(new Set());
	});
});

const link = (n: Note, more: Partial<Link> = {}): Link => ({
	...n,
	by: "agent:test-writer",
	arrivedAt: "2026-11-07T10:00:00-08:00",
	parent: null,
	traceId: "trace-tests-229",
	commit: T("1"),
	pr: "usirin/tea-fabrika#1",
	base: T("0"),
	squash: T("f"),
	keys: T("0"),
	...more,
});
const logged = (l: Link, signer: Role | null = l.step): Logged => ({link: l, signer});
const TREES = new Map([
	[T("0"), A],
	[T("f"), C],
]);
const PLACED = {onMain: true, before: new Set([T("0")])};

describe("d4: logged links use parent and traceId (Q15)", () => {
	it.each([null, "in-process-test-1"])("keeps parent %s and the request's traceId", (parent) => {
		const value = link(note("tests", A, B), {parent});
		expect(decodeLink(value)).toEqual(Option.some(value));
	});
	it("refuses the old cause field even alongside parent and traceId", () => {
		const value = link(note("tests", A, B));
		// Plant: accept cause as an extra field, or as the old name for parent.
		expect(Option.isNone(decodeLink({...value, cause: null}))).toBe(true);
		const {parent: _, ...old} = value;
		expect(Option.isNone(decodeLink({...old, cause: null}))).toBe(true);
	});
	it.each(["parent", "traceId"] as const)("requires %s", (field) => {
		const value: Record<string, unknown> = {...link(note("tests", A, B))};
		delete value[field];
		expect(Option.isNone(decodeLink(value))).toBe(true);
	});
});

describe("chain (p86 and p89 after the merge)", () => {
	const good = [logged(link(note("tests", A, B))), logged(link(note("build", B, C)))];

	it("is done when the links run from the base's tree to the squash's tree", () => {
		expect(chain(T("f"), good, TREES, PLACED)).toEqual([DONE]);
	});

	it("is done through a lead merge in the middle", () => {
		const rows = [
			logged(link(note("tests", A, B))),
			logged(link(note("lead", B, D))),
			logged(link(note("build", D, C))),
		];
		expect(chain(T("f"), rows, TREES, PLACED)).toEqual([DONE]);
	});

	it("reads only the squash's own links for the chain", () => {
		const other = logged(link(note("tests", E, D, {ticket: "7"}), {squash: T("e")}));
		expect(chain(T("f"), [other, ...good], TREES, PLACED)).toEqual([DONE]);
	});

	it.each([
		["no links", []],
		["a gap between two links", [good[0]!, logged(link(note("build", D, C)))]],
		["a link that does not verify", [good[0]!, logged(good[1]!.link, null)]],
		["a link verified as another role", [good[0]!, logged(good[1]!.link, "lead")]],
		[
			"a first link that does not start at the base's tree",
			[logged(link(note("tests", D, B))), good[1]!],
		],
		[
			"a last link that does not end at the squash's tree",
			[good[0]!, logged(link(note("build", B, D)))],
		],
		["two tickets", [good[0]!, logged(link(note("build", B, C, {ticket: "230"})))]],
		[
			"a tree left by two links",
			[good[0]!, logged(link(note("build", B, A))), logged(link(note("tests", A, B))), good[1]!],
		],
	])("is broken_chain with %s", (_, rows) => {
		expect(chain(T("f"), rows, TREES, PLACED)).toEqual([stuck("broken_chain", T("f"))]);
	});

	it("is broken_chain when the base or the squash is not a known commit", () => {
		expect(chain(T("f"), good, new Map([[T("0"), A]]), PLACED)).toEqual([
			stuck("broken_chain", T("f")),
		]);
		expect(chain(T("f"), good, new Map([[T("f"), C]]), PLACED)).toEqual([
			stuck("broken_chain", T("f")),
		]);
	});

	it("is broken_chain when the squash is not on main", () => {
		expect(chain(T("f"), good, TREES, {...PLACED, onMain: false})).toEqual([
			stuck("broken_chain", T("f")),
		]);
	});

	it("is broken_chain when a link's base is not on main before the squash", () => {
		expect(chain(T("f"), good, TREES, {...PLACED, before: new Set()})).toEqual([
			stuck("broken_chain", T("f")),
		]);
		const later = [good[0]!, logged(link(note("build", B, C), {base: T("9")}))];
		expect(chain(T("f"), later, TREES, PLACED)).toEqual([stuck("broken_chain", T("f"))]);
	});

	it("is stale_link when another row holds a newer link of a step for the ticket", () => {
		const newer = logged(link(note("tests", A, D, {version: 2}), {squash: T("e")}));
		expect(chain(T("f"), [...good, newer], TREES, PLACED)).toEqual([
			stuck("stale_link", T("f"), {step: "tests"}),
		]);
	});

	it("ignores a newer row that does not verify", () => {
		const newer = logged(link(note("tests", A, D, {version: 2}), {squash: T("e")}), null);
		expect(chain(T("f"), [...good, newer], TREES, PLACED)).toEqual([DONE]);
	});

	it("decodeLink takes a field/ link with every field the note's table lists", () => {
		expect(Option.isSome(decodeLink(link(note("tests", A, B))))).toBe(true);
		const {keys: _, ...noKeys} = link(note("tests", A, B));
		expect(Option.isNone(decodeLink(noKeys))).toBe(true);
	});
});

describe("printed lines (hole 2)", () => {
	const ask: Answer = {
		_tag: "ask",
		who: "owner",
		for: "exam_read",
		paths: ["a\n::add-mask::next/apps/fabrika/src/exam/commits.ts", "b\rc|`d`%"],
	};

	it("JSON-quotes a path in a plain line, so no raw newline, backtick or bar is printed", () => {
		const text = plain(ask);
		expect(text).not.toMatch(/[\n\r`|]/);
		expect(text).toContain('"a\\n::add-mask::');
	});

	it("escapes a raw path in an annotation as GitHub's toolkit does", () => {
		const text = annotate(plain(ask, (p) => p));
		expect(text).not.toMatch(/[\n\r]/);
		expect(text).toContain("a%0A::add-mask::");
		expect(text).toContain("b%0Dc|`d`%25");
	});

	it("prints a stuck answer with its step and paths", () => {
		expect(plain({_tag: "stuck", why: "stale_link", sha: "s", step: "tests"})).toBe(
			"stuck stale_link s step tests",
		);
	});
});

describe("the workflow file (hole 4)", () => {
	const text = readFileSync(join(ROOT, ".github", "workflows", "commits.yaml"), "utf8");
	const lines = text.split("\n");

	it("runs on pull_request_target into main and on a push to main", () => {
		expect(text).toMatch(/^on:\n {2}pull_request_target:\n {4}branches:\n {6}- main\n/m);
		expect(text).not.toMatch(/^ {2}pull_request:/m);
	});

	it("uses no pull request field but its number and the two shas", () => {
		const used = [...text.matchAll(/\$\{\{[^}]*?github\.event\.pull_request\.([\w.]+)/g)].map(
			(m) => m[1],
		);
		expect(used.length).toBeGreaterThan(0);
		for (const field of used) expect(["number", "head.sha", "base.sha"]).toContain(field);
		expect(text).not.toMatch(/head\.ref|\.title|\.body|head_ref|github\.head_ref/);
	});

	it("puts no expression inside a run block", () => {
		const inRuns: string[] = [];
		let inRun = -1;
		for (const l of lines) {
			const indent = l.length - l.trimStart().length;
			if (inRun >= 0 && l.trim() !== "" && indent <= inRun) inRun = -1;
			const run = /^(\s*)(?:- )?run:(.*)$/.exec(l);
			if (run !== null) inRun = run[1]!.length;
			if (run !== null || inRun >= 0) inRuns.push(l);
		}
		expect(inRuns.length).toBeGreaterThanOrEqual(4);
		expect(inRuns.filter((l) => l.includes("${{"))).toEqual([]);
	});

	it("checks out with persist-credentials: false, every time", () => {
		const checkouts = lines.filter((l) => l.includes("actions/checkout@")).length;
		expect(checkouts).toBeGreaterThan(0);
		expect(text.match(/persist-credentials: false/g)?.length).toBe(checkouts);
		expect(text).not.toMatch(/\bref:/);
	});

	it("asks for contents: read and nothing else, and uses no secret", () => {
		expect(text.match(/permissions:/g)).toHaveLength(1);
		expect(text).toMatch(/^permissions:\n {2}contents: read\n\n/m);
		expect(text).not.toContain("secrets.");
	});

	it("runs the check on the event's shas, fetched by the program", () => {
		expect(text).toContain(
			'commits check --fetch --pr "$PR" --base "$BASE" --head "$HEAD" --main "$MAIN"',
		);
		expect(text).toContain(
			'commits chain --fetch --pr "$PR" --base "$BASE" --head "$HEAD" --main "$MAIN"',
		);
		expect(text.match(/MAIN: \$\{\{ github\.sha \}\}/g)).toHaveLength(2);
		expect(text).not.toContain("--keys-from");
	});
});
