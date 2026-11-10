import {spawnSync} from "node:child_process";
import {mkdirSync} from "node:fs";
import {join} from "node:path";
import * as fc from "fast-check";
import {describe, expect, it} from "vitest";
import {
	EXAM_LIST,
	TOP,
	ENV,
	sh,
	KEYS,
	pub,
	fingerprint,
	keyLine,
	GOOD_KEYS,
	personLine,
	PERSON_KEYS,
	count,
	Repo,
	DONE,
	runs,
	name,
	stuck,
	ask,
	verifyCommit,
	personLink,
	squashed,
	log,
} from "./commits-git.test-support.ts";

describe("stale_link (p89)", () => {
	// scenario: branch switching and real sign commands share the notes version history.
	it("scenario: tests signs version 1, redoes it as version 2 on another commit; the branch uses version 1", () => {
		const r = new Repo();
		const t1 = r.change("a.test.ts");
		r.signWith("tests");
		r.git("checkout", "-q", "-b", "redo", r.base);
		r.change("a2.test.ts");
		expect(r.signWith("tests").answers[0]).toMatchObject({version: 2});
		r.git("checkout", "-q", "pr");
		r.change("b.ts");
		r.sign("build");
		expect(r.check().answers).toEqual([
			stuck("stale_link", t1, {step: "tests"}),
			ask("next/packages/x/src/a.test.ts"),
		]);
	});

	// scenario: two branches hold independent signatures at the same version.
	it("scenario: two verified tests links for the ticket, both version 2", () => {
		const r = new Repo();
		const t = r.change("a.ts");
		r.sign("tests", {version: 2});
		r.git("checkout", "-q", "-b", "other", r.base);
		r.change("z.ts");
		r.sign("tests", {version: 2});
		r.git("checkout", "-q", "pr");
		expect(r.check().answers).toEqual([stuck("stale_link", t, {step: "tests"})]);
	});
});

describe("build_touched_exam (p84)", () => {
	// Plant: omit build exam refusal. Generated initial contents vary the real trees.
	it("G13: a build commit changing next/apps/fabrika/src/exam/commits.ts", () => {
		fc.assert(
			fc.property(fc.string(), (initial) => {
				const r = new Repo(GOOD_KEYS, undefined, "sha1", initial);
				const path = "next/apps/fabrika/src/exam/commits.ts";
				r.write(path, "weaker\n");
				const c = r.commit();
				r.sign("build");
				expect(r.check().answers).toEqual([
					stuck("build_touched_exam", c, {paths: [path]}),
					ask(path),
				]);
			}),
			runs,
		);
	});

	// scenario: git rename detection must return both sides of the move.
	it("scenario: a build commit moving a file out of fixtures/next/: the rename's old path", () => {
		const r = new Repo();
		mkdirSync(join(r.dir, "next/packages/x"), {recursive: true});
		r.git("mv", "fixtures/next/v.txt", "next/packages/x/v.txt");
		const c = r.commit();
		r.sign("build");
		expect(r.check().answers).toEqual([
			stuck("build_touched_exam", c, {paths: ["fixtures/next/v.txt"]}),
			ask("fixtures/next/v.txt"),
		]);
	});

	// scenario: real tree reads must use the ancestor list despite the changed list on head.
	it("scenario: a build commit dropping a row from exam-paths.json and touching that path: the base's list counts", () => {
		const r = new Repo();
		const rows = JSON.parse(EXAM_LIST) as Array<{glob: string}>;
		r.write(
			"exam-paths.json",
			JSON.stringify(rows.filter((row) => row.glob !== "boundary-rules.json")),
		);
		r.write("boundary-rules.json", "[3]\n");
		const c = r.commit();
		r.sign("build");
		const both = ["boundary-rules.json", "exam-paths.json"];
		expect(r.check().answers).toEqual([
			stuck("build_touched_exam", c, {paths: both}),
			ask(...both),
		]);
	});

	// scenario: git first-parent merge changes differ from the PR three-dot diff.
	it("scenario: a build commit that merges main in, bringing main's exam change", () => {
		const r = new Repo();
		r.change("a.ts");
		r.sign("tests");
		r.git("checkout", "-q", "main");
		r.write("boundary-rules.json", "[4]\n");
		const main = r.commit("main moves");
		r.git("checkout", "-q", "pr");
		r.git("merge", "-q", "--no-edit", "main");
		const merge = r.head();
		r.sign("build");
		expect(r.check([], main).answers).toEqual([
			stuck("build_touched_exam", merge, {paths: ["boundary-rules.json"]}),
		]);
	});

	// Plant: ignore control characters in exam paths. Generate the file name around the CR.
	it("G14: a build commit adding a file whose name holds a carriage return", () => {
		fc.assert(
			fc.property(name, (name) => {
				const r = new Repo();
				const path = `next/packages/x/${name}\rb.ts`;
				r.write(path, "x\n");
				const c = r.commit();
				r.sign("build");
				expect(r.check().answers).toEqual([
					stuck("build_touched_exam", c, {paths: [path]}),
					ask(path),
				]);
			}),
			runs,
		);
	});
});

describe("broken_chain at pull request time (p86)", () => {
	// scenario: two diverged branches distinguish a three-dot diff from a two-dot diff.
	it("scenario: the branch is behind main, whose own exam change asks nothing (a three-dot diff)", () => {
		const r = new Repo();
		r.change("a.ts");
		r.sign("tests");
		r.change("b.ts");
		r.sign("build");
		const head = r.head();
		r.git("checkout", "-q", "main");
		r.write("boundary-rules.json", "[6]\n");
		const main = r.commit("main moves");
		expect(r.check([], main, head).answers).toEqual([stuck("broken_chain", head)]);
	});

	// scenario: event base, event head and newer main need separate real histories.
	it("scenario: the branch contains the event's base but not the newer main CI checked out", () => {
		const r = new Repo();
		r.change("a.ts");
		r.sign("tests");
		const head = r.head();
		r.git("checkout", "-q", "main");
		r.write("docs/other.md", "o\n");
		const main = r.commit("main moves after the event");
		expect(r.check([], r.base, head).answers).toEqual([DONE]);
		expect(r.check(["--main", main], r.base, head).answers).toEqual([stuck("broken_chain", head)]);
	});
});

describe("the run fails (p87), judging no commit", () => {
	// Plant: silently pass an invalid or absent trusted keys file.
	it.each([
		[
			"an ECDSA key",
			`${[keyLine("tests", "tests"), keyLine("build", "build"), keyLine("lead", "ecdsa")].join("\n")}\n`,
		],
		["a key under tests and build", `${GOOD_KEYS}${keyLine("build", "tests")}\n`],
		["an unknown principal", `${GOOD_KEYS}${keyLine("owner", "stranger")}\n`],
		["a missing namespace", `${GOOD_KEYS}build ${pub("stranger")}\n`],
		["no allowed_signers on the base", null],
	])("G20: %s", (_, keys) => {
		fc.assert(
			fc.property(fc.string(), (initial) => {
				const r = new Repo(keys, undefined, "sha1", initial);
				r.change("a.ts");
				const out = r.check();
				expect(out.code).toBe(2);
				expect(out.answers).toEqual([]);
				expect(out.err).toContain("allowed_signers");
			}),
			runs,
		);
	});
});

describe("person commits between step links (p86b)", () => {
	// scenario: alternate real signed commits isolate each mismatched part of one logged proof.
	it.each([
		"the wrong key",
		"another signature",
		"another to tree",
		"another from tree",
		"an unsigned commit",
		"a step key",
	] as const)("scenario: refuses a person link with %s", (plant) => {
		const r = new Repo(PERSON_KEYS);
		r.write("next/packages/x/src/a.ts", "a\n");
		const person = r.gitSigned();
		expect(verifyCommit(r, person)).toBe(0);
		const middle = personLink(r, person);
		expect(middle.from).not.toBe(middle.to);
		const signedCommit = (parent: string, tree: string, who: "person" | "tests" = "person") =>
			r
				.git(
					"-c",
					"gpg.format=ssh",
					"-c",
					`user.signingkey=${join(KEYS, who)}`,
					"commit-tree",
					"-S",
					"-p",
					parent,
					"-m",
					"planted signed commit",
					tree,
				)
				.trim();
		const {squash, rows} = squashed(r, [{note: middle, commit: person}]);
		const row = rows[0]!.attested[0]!;
		switch (plant) {
			case "the wrong key":
				row.key = fingerprint("tests");
				break;
			case "another signature":
				row.sig = personLink(r, signedCommit(r.base, middle.from)).sig;
				break;
			case "another to tree":
			case "another from tree": {
				const other =
					plant === "another to tree"
						? signedCommit(r.base, middle.from)
						: signedCommit(person, middle.to);
				expect(verifyCommit(r, other)).toBe(0);
				row.commit = other;
				row.sig = personLink(r, other).sig;
				break;
			}
			case "an unsigned commit":
				row.commit = r.git("commit-tree", "-p", r.base, "-m", "unsigned", middle.to).trim();
				break;
			case "a step key": {
				const other = signedCommit(r.base, middle.to, "tests");
				expect(verifyCommit(r, other, `fixture namespaces="git" ${pub("tests")}\n`)).toBe(0);
				row.commit = other;
				row.key = fingerprint("tests");
				row.sig = personLink(r, other, "tests").sig;
				break;
			}
		}
		log(r, rows);
		const out = r.run(["chain", "--squash", squash]);
		expect(out.answers).toEqual([stuck("broken_chain", squash)]);
		expect(out.code).toBe(1);
	});

	// Plant: ignore the logged signature mismatch. Generated contents vary the signed trees.
	it("G23: xgpgsig was read as gpgsig (95c3610a)", () => {
		fc.assert(
			fc.property(fc.string(), (initial) => {
				const r = new Repo(PERSON_KEYS, undefined, "sha1", initial);
				r.write("next/packages/x/src/a.ts", "a\n");
				const person = r.gitSigned();
				const payload = r
					.git("cat-file", "commit", person)
					.replace(/^gpgsig .*(?:\n .*)*\n/m, "")
					.replace("\n\n", "\nxgpgsig forged\n\n");
				const sig = sh(
					r.dir,
					"ssh-keygen",
					["-Y", "sign", "-n", "git", "-f", join(KEYS, "person")],
					payload,
				);
				const raw = payload.replace(
					"\n\n",
					`\ngpgsig ${sig.trimEnd().replaceAll("\n", "\n ")}\n\n`,
				);
				const c = sh(r.dir, "git", ["hash-object", "-t", "commit", "-w", "--stdin"], raw).trim();
				expect(verifyCommit(r, c)).toBe(0);
				const {squash, rows} = squashed(r, [
					{note: {...personLink(r, c), sig: "forged\n"}, commit: c},
				]);
				log(r, rows);
				const out = r.run(["chain", "--squash", squash]);
				expect(out.answers).toEqual([stuck("broken_chain", squash)]);
				expect(out.code).toBe(1);
			}),
			runs,
		);
	});

	// scenario: a native signed commit passes git but its logged chain reads an incomplete ancestor file.
	it("scenario: refuses a person link whose keys file is incomplete", () => {
		const keys = `${keyLine("tests", "tests")}\n${personLine("github:42")}\n`;
		const r = new Repo(keys);
		r.write("next/packages/x/src/a.ts", "a\n");
		const person = r.gitSigned();
		expect(verifyCommit(r, person, keys)).toBe(0);
		const {squash, rows} = squashed(r, [{note: personLink(r, person), commit: person}]);
		log(r, rows);
		const out = r.run(["chain", "--squash", squash]);
		expect(out.answers).toEqual([stuck("broken_chain", squash)]);
		expect(out.code).toBe(1);
	});

	// scenario: an independent single-branch clone must fetch a missing signed object.
	it("scenario: fetches a missing signed person commit before checking its logged link", () => {
		const r = new Repo(PERSON_KEYS);
		r.write("next/packages/x/src/a.ts", "a\n");
		const person = r.gitSigned();
		const {squash, rows} = squashed(r, [{note: personLink(r, person), commit: person}]);
		log(r, rows);
		const ci = join(TOP, `person-ci${count}`);
		sh(TOP, "git", ["clone", "-q", "--no-local", "--single-branch", "--branch", "main", r.dir, ci]);
		const missing = spawnSync("git", ["cat-file", "-e", `${person}^{commit}`], {cwd: ci, env: ENV});
		expect(missing.error).toBeUndefined();
		expect(missing.status).not.toBe(0);
		const out = r.run(["chain", "--squash", squash], ENV, ci);
		expect(out.answers, out.err).toEqual([DONE]);
		expect(out.code).toBe(0);
		expect(sh(ci, "git", ["cat-file", "-e", `${person}^{commit}`])).toBe("");
	});

	// scenario: three signed commits must connect through both squash and the later log.
	it.each(["file change", "empty commit"] as const)(
		"scenario: connects tests, a person's %s, then build, before and after squash",
		(change) => {
			const r = new Repo(PERSON_KEYS);
			const tests = r.change("a.ts");
			const first = r.sign("tests");
			if (change === "file change") r.write("next/packages/x/src/person.ts", "person\n");
			const person = r.gitSigned();
			expect(verifyCommit(r, person)).toBe(0);
			const middle = personLink(r, person);
			const build = r.change("b.ts");
			const last = r.sign("build");
			expect(first.to).toBe(middle.from);
			expect(middle.to).toBe(last.from);
			expect(middle.from === middle.to).toBe(change === "empty commit");
			const before = r.check();
			const {squash, rows} = squashed(r, [
				{note: first, commit: tests},
				{note: middle, commit: person},
				{note: last, commit: build},
			]);
			log(r, rows);
			const after = r.run(["chain", "--squash", squash]);
			expect(before.answers).toEqual([DONE]);
			expect(before.code).toBe(0);
			expect(after.answers, after.err).toEqual([DONE]);
			expect(after.code).toBe(0);
		},
	);

	// scenario: a real unsigned middle commit leaves a tree gap after squash.
	it("scenario: refuses an unsigned commit between step links, before and after squash", () => {
		const r = new Repo(PERSON_KEYS);
		const tests = r.change("a.ts");
		const first = r.sign("tests");
		const gap = r.change("unsigned.ts");
		const build = r.change("b.ts");
		const last = r.sign("build");
		expect(first.to).not.toBe(last.from);
		const before = r.check();
		expect(before.answers).toEqual([stuck("unsigned_commit", gap)]);
		expect(before.code).toBe(1);
		const {squash, rows} = squashed(r, [
			{note: first, commit: tests},
			{note: last, commit: build},
		]);
		log(r, rows);
		const out = r.run(["chain", "--squash", squash]);
		expect(out.answers).toEqual([stuck("broken_chain", squash)]);
		expect(out.code).toBe(1);
	});

	// scenario: native signed merge ancestry is checked before and after catching up.
	it("scenario: counts a person's signed merge of main and still requires the base in the head", () => {
		const r = new Repo(PERSON_KEYS);
		r.change("a.ts");
		r.sign("tests");
		const behind = r.head();
		r.git("checkout", "-q", "main");
		r.write("docs/other.md", "main moved\n");
		const main = r.commit("main moves");
		r.git("checkout", "-q", "pr");
		r.git(
			"-c",
			"gpg.format=ssh",
			"-c",
			`user.signingkey=${join(KEYS, "person")}`,
			"merge",
			"-q",
			"--gpg-sign",
			"--no-edit",
			"main",
		);
		expect(verifyCommit(r, r.head())).toBe(0);
		const stale = r.check([], main, behind);
		r.change("b.ts");
		r.sign("build");
		const merged = r.check([], main);
		expect(merged.answers).toEqual([DONE]);
		expect(merged.code).toBe(0);
		expect(stale.answers).toEqual([stuck("broken_chain", behind)]);
		expect(stale.code).toBe(1);
	});
});
