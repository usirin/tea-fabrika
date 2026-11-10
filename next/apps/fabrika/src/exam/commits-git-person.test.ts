import * as fc from "fast-check";
import {describe, expect, it} from "vitest";
import {
	fingerprint,
	keyLine,
	stepKeys,
	GOOD_KEYS,
	personLine,
	PERSON_KEYS,
	Repo,
	DONE,
	runs,
	id,
	name,
	stuck,
	ask,
	verifies,
} from "./commits-git.test-support.ts";
import {signedText} from "./commits.ts";

describe("person keys (p87b)", () => {
	// Plant: reject every person line.
	it("G01: distinct generated person ids and signer order pass beside the step roles", () => {
		fc.assert(
			fc.property(
				fc.uniqueArray(id, {minLength: 2, maxLength: 2}),
				fc.boolean(),
				name,
				(ids, reverse, name) => {
					const lines = [personLine(ids[0]!), personLine(ids[1]!, "stranger")];
					const r = new Repo(`${GOOD_KEYS}${(reverse ? lines.reverse() : lines).join("\n")}\n`);
					r.change(`${name}.ts`);
					r.sign("tests");
					const out = r.check();
					expect(out.answers).toEqual([DONE]);
					expect(out.code).toBe(0);
				},
			),
			runs,
		);
	});

	// Plant: allow a person principal twice with different keys.
	it("G02: repeated generated ids, reused keys, empty ids and step namespaces stop before commits", () => {
		fc.assert(
			fc.property(id, name, (id, name) => {
				for (const people of [
					[personLine(id), personLine(id, "stranger")],
					[personLine(id, "tests")],
					[personLine(id), personLine(`${id}:other`)],
					[personLine("")],
					[keyLine(`person:${id}`, "person")],
				]) {
					const r = new Repo(`${GOOD_KEYS}${people.join("\n")}\n`);
					r.change(`${name}.ts`);
					r.sign("tests");
					const out = r.check();
					expect(out.code).toBe(2);
					expect(out.answers).toEqual([]);
					expect(out.err).toMatch(/allowed_signers: \S/);
				}
			}),
			runs,
		);
	});
});

describe("person exam changes (p84b)", () => {
	// Plant: omit exam_read. Generate the person's exam file name.
	it("G10: asks the owner without build_touched_exam for a person's exam commit", () => {
		fc.assert(
			fc.property(name, (name) => {
				const r = new Repo(PERSON_KEYS);
				const path = `next/packages/x/src/${name}.test.ts`;
				r.write("boundary-rules.json", "[1]\n");
				r.write(path, "t\n");
				r.gitSigned();
				const out = r.check();
				expect(out.answers).toEqual([ask("boundary-rules.json", path)]);
				expect(out.code).toBe(0);
			}),
			runs,
		);
	});
});

/** Whether a note's signature verifies under the real keys, as tests, by ssh-keygen alone. */
describe("unsigned_commit (p83)", () => {
	// Plant: accept unsigned commits. Generated initial contents vary the real trees.
	it("G11: no note at all", () => {
		fc.assert(
			fc.property(fc.string(), (initial) => {
				const r = new Repo(GOOD_KEYS, undefined, "sha1", initial);
				const c = r.change("a.ts");
				expect(r.check().answers).toEqual([stuck("unsigned_commit", c)]);
				expect(r.check().code).toBe(1);
			}),
			runs,
		);
	});

	// Plant: accept unsigned commits, including every invalid note in this table.
	it.each([
		["signed by stranger", (r: Repo) => r.sign("stranger")],
		[
			"the build key signs a note whose step says tests",
			(r: Repo) => r.sign("build", {step: "tests"}),
		],
		["signed with namespace fabrika-client", (r: Repo, ns: string) => r.sign("tests", {ns})],
		[
			"a good note, then its step edited by hand",
			(r: Repo) => {
				const note = r.sign("tests");
				r.setNote(r.head(), JSON.stringify({...note, step: "lead"}));
			},
		],
		["a note that is not JSON", (r: Repo) => r.setNote(r.head(), "step tests, trust me")],
	])("G19: %s", (_, plant) => {
		fc.assert(
			fc.property(fc.string(), (initial) => {
				const r = new Repo(GOOD_KEYS, undefined, "sha1", initial);
				const c = r.change("a.ts");
				plant(r, `fabrika-client:${initial}`);
				expect(r.check().answers).toEqual([stuck("unsigned_commit", c)]);
			}),
			runs,
		);
	});

	// scenario: real git rebase rewrites a signed commit and carries its note.
	it("scenario: a signed commit rebased with notes.rewriteRef: the note came along and verifies, its trees do not fit", () => {
		const r = new Repo();
		r.change("a.ts");
		const note = r.sign("tests");
		r.git("checkout", "-q", "main");
		r.write("docs/other.md", "o\n");
		const main = r.commit("main moves");
		r.git("checkout", "-q", "pr");
		r.git("-c", "notes.rewriteRef=refs/notes/fabrika", "rebase", "-q", "main");
		const rebased = r.head();
		const copied = JSON.parse(r.git("notes", "--ref=fabrika", "show", rebased));
		expect(copied).toEqual(note);
		expect(verifies(r, note, signedText(note))).toBe(true);
		expect(r.check([], main).answers).toEqual([stuck("unsigned_commit", rebased)]);
	});

	// Plant: ignore note fingerprint. Generated initial contents vary the real trees.
	it("G12: a good signature whose note names another key's fingerprint", () => {
		fc.assert(
			fc.property(fc.string(), (initial) => {
				const r = new Repo(GOOD_KEYS, undefined, "sha1", initial);
				const c = r.change("a.ts");
				const note = r.sign("tests");
				r.setNote(c, JSON.stringify({...note, key: fingerprint("stranger")}));
				expect(r.check().answers).toEqual([stuck("unsigned_commit", c)]);
			}),
			runs,
		);
	});

	// scenario: two branches and a key-removal merge distinguish event base from trusted main.
	it("scenario: a key the event's base held and the checked-out main has dropped", () => {
		const extra = stepKeys("stranger");
		const r = new Repo(extra);
		r.git("checkout", "-q", "main");
		r.write("allowed_signers", GOOD_KEYS);
		const main = r.commit("drop the stranger");
		r.git("checkout", "-q", "pr");
		r.git("merge", "-q", "--no-ff", "--no-edit", "main");
		r.sign("lead");
		const c = r.change("a.ts");
		r.sign("stranger");
		expect(r.check(["--main", main]).answers).toEqual([stuck("unsigned_commit", c)]);
		// Read at the event's base, the stranger still counts, and main's own commit is in the range.
		expect(r.check().answers).toEqual([stuck("unsigned_commit", main), ask("allowed_signers")]);
	});

	// scenario: two independently signed git notes establish the PR ticket before its mismatch.
	it("scenario: a good link for ticket 230 on a commit in ticket 229's pull request", () => {
		const r = new Repo();
		r.change("a.ts");
		r.sign("tests");
		const c = r.change("b.ts");
		r.sign("build", {ticket: "230"});
		expect(r.check().answers).toEqual([stuck("unsigned_commit", c)]);
	});

	// scenario: two signed commits distinguish the PR key file from its trusted ancestor.
	it("scenario: a key added only in the pull request's own allowed_signers, signing a commit in it", () => {
		const r = new Repo();
		r.write("allowed_signers", stepKeys("stranger"));
		r.commit();
		r.sign("tests");
		const c = r.change("a.ts");
		r.sign("stranger");
		expect(r.check().answers).toEqual([stuck("unsigned_commit", c), ask("allowed_signers")]);
	});
});
