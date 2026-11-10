import {spawnSync} from "node:child_process";
import {writeFileSync} from "node:fs";
import {join} from "node:path";
import * as fc from "fast-check";
import {describe, expect, it} from "vitest";
import {
	TOP,
	ENV,
	sh,
	KEYS,
	pub,
	fingerprint,
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
	verifyCommit,
	acceptPgp,
	personLink,
	squashed,
	log,
} from "./commits-git.test-support.ts";
import {signedText} from "./commits.ts";

describe("person git signatures (p83b)", () => {
	// Plant: accept person commits only when they have a step note.
	it("G03: any listed person can sign generated file contents without a step note", () => {
		fc.assert(
			fc.property(
				fc.uniqueArray(id, {minLength: 2, maxLength: 2}),
				name,
				fc.string(),
				(ids, name, content) => {
					for (const multiple of [false, true]) {
						const keys = `${GOOD_KEYS}${personLine(ids[0]!)}\n${multiple ? `${personLine(ids[1]!, "stranger")}\n` : ""}`;
						const r = new Repo(keys);
						r.write(`next/packages/x/src/${name}.ts`, content);
						const c = r.gitSigned(multiple ? "stranger" : "person");
						expect(verifyCommit(r, c, keys)).toBe(0);
						expect(r.git("notes", "--ref=fabrika", "list")).toBe("");
						const out = r.check();
						expect(out.answers).toEqual([DONE]);
						expect(out.code).toBe(0);
					}
				},
			),
			runs,
		);
	});

	// pinned: 95c3610a found this exact Git SHA-256 header regression.
	it("pinned: Git gpgsig-sha256 rejected before and after squash (95c3610a)", () => {
		const r = new Repo(PERSON_KEYS, undefined, "sha256");
		r.write("next/packages/x/src/a.ts", "a\n");
		const c = r.gitSigned();
		expect(verifyCommit(r, c)).toBe(0);
		const before = r.check();
		const {squash, rows} = squashed(r, [{note: personLink(r, c), commit: c}]);
		log(r, rows);
		const after = r.run(["chain", "--squash", squash]);
		expect({before: before.answers, after: after.answers}).toEqual({before: [DONE], after: [DONE]});
		expect(before.code).toBe(0);
		expect(after.code).toBe(0);
	});

	// Plant: accept a dummy SSH header beside a verified PGP signature.
	it("G04: generated header layouts cannot make a verified PGP commit an SSH person commit", () => {
		fc.assert(
			fc.property(name, fc.boolean(), (name, before) => {
				const r = new Repo(PERSON_KEYS);
				const unsigned = r.change("a.ts");
				acceptPgp(r);
				const decoys = ["xgpgsig", "gpgsig-sha256", `x-${name}`].map(
					(header) => `${header} -----BEGIN SSH SIGNATURE-----`,
				);
				const pgp = [
					"gpgsig -----BEGIN PGP SIGNATURE-----",
					" fixture",
					" -----END PGP SIGNATURE-----",
				];
				const raw = r
					.git("cat-file", "commit", unsigned)
					.replace(
						"\n\n",
						["", ...(before ? [...decoys, ...pgp] : [...pgp, ...decoys]), "", ""].join("\n"),
					);
				const c = sh(r.dir, "git", ["hash-object", "-t", "commit", "-w", "--stdin"], raw).trim();
				expect(verifyCommit(r, c)).toBe(0);
				const out = r.check([], r.base, c);
				expect(out.answers).toEqual([stuck("unsigned_commit", c)]);
				expect(out.code).toBe(1);
			}),
			runs,
		);
	});

	// Plant: use multiline RegExp anchors instead of Git's LF-only header lines.
	it.each(["\r", "\u2028", "\u2029"])(
		"G23: a fake SSH header after %j inside an extra header never counts before or after squash",
		(lineBreak) => {
			fc.assert(
				fc.property(
					name,
					fc.stringMatching(/^[^\n\0]{0,24}$/),
					fc.boolean(),
					fc.constantFrom("sha1", "sha256"),
					(name, value, before, format) => {
						const r = new Repo(PERSON_KEYS, undefined, format);
						const unsigned = r.change("a.ts");
						acceptPgp(r);
						const header = format === "sha256" ? "gpgsig-sha256" : "gpgsig";
						const sig = "-----BEGIN SSH SIGNATURE-----\n";
						const decoy = `x-${name} ${value}${lineBreak}${header} ${sig.trimEnd()}`;
						const pgp = [
							`${header} -----BEGIN PGP SIGNATURE-----`,
							" fixture",
							" -----END PGP SIGNATURE-----",
						].join("\n");
						const raw = r
							.git("cat-file", "commit", unsigned)
							.replace("\n\n", () => `\n${(before ? [decoy, pgp] : [pgp, decoy]).join("\n")}\n\n`);
						const c = sh(
							r.dir,
							"git",
							["hash-object", "-t", "commit", "-w", "--stdin"],
							raw,
						).trim();
						expect(verifyCommit(r, c)).toBe(0);
						r.git("update-ref", "refs/heads/pr", c);
						const checked = r.check();
						const note = {
							_tag: "attested",
							step: "person",
							ticket: "251",
							version: 1,
							from: r.head(`${r.base}^{tree}`),
							to: r.head(`${c}^{tree}`),
							key: fingerprint("person"),
							sig,
						};
						const {squash, rows} = squashed(r, [{note, commit: c}]);
						log(r, rows);
						const chained = r.run(["chain", "--squash", squash]);
						expect({before: checked.answers, after: chained.answers}).toEqual({
							before: [stuck("unsigned_commit", c)],
							after: [stuck("broken_chain", squash)],
						});
						expect(checked.code).toBe(1);
						expect(chained.code).toBe(1);
					},
				),
				runs,
			);
		},
	);

	// Plant: erase the signer write failure reason. Generated contents vary the signed trees.
	it("G21: person signers disk failure lost its reason (95c3610a)", () => {
		fc.assert(
			fc.property(fc.string(), (initial) => {
				const r = new Repo(PERSON_KEYS, undefined, "sha1", initial);
				r.write("next/packages/x/src/a.ts", "a\n");
				r.gitSigned();
				const preload = join(TOP, "no-person-writes.mjs");
				writeFileSync(
					preload,
					`
	import fs from "node:fs";
	import {syncBuiltinESMExports} from "node:module";
	const write = fs.writeFile;
	fs.writeFile = (path, data, options, done) => {
	  if (Buffer.from(data).toString("utf8").includes("person:"))
	    return done(Object.assign(new Error("fixture disk full"), {code: "ENOSPC"}));
	  return write(path, data, options, done);
	};
	syncBuiltinESMExports();
	`,
				);
				const out = r.run(["check", "--base", r.base, "--head", "HEAD"], {
					...ENV,
					NODE_OPTIONS: `${ENV.NODE_OPTIONS ?? ""} --import=${preload}`.trim(),
				});
				expect(out.code).toBe(2);
				expect(out.answers).toEqual([]);
				expect(out.err).toMatch(/commits: the run failed: \S/);
			}),
			runs,
		);
	});

	// Plant: read person keys from head. Generated initial contents vary the real trees.
	it("G05: uses the base's person keys when the head removes that person", () => {
		fc.assert(
			fc.property(fc.string(), (initial) => {
				const r = new Repo(PERSON_KEYS, undefined, "sha1", initial);
				r.write("allowed_signers", GOOD_KEYS);
				r.gitSigned();
				const out = r.check();
				expect(out.answers).toEqual([ask("allowed_signers")]);
				expect(out.code).toBe(0);
			}),
			runs,
		);
	});

	// Plant: read person keys from head. Generated initial contents vary the real trees.
	it("G06: refuses a person's key added only at the head", () => {
		fc.assert(
			fc.property(fc.string(), (initial) => {
				const r = new Repo(GOOD_KEYS, undefined, "sha1", initial);
				r.write("allowed_signers", PERSON_KEYS);
				const c = r.gitSigned();
				expect(verifyCommit(r, c)).toBe(0);
				const out = r.check();
				expect(out.answers).toEqual([stuck("unsigned_commit", c), ask("allowed_signers")]);
				expect(out.code).toBe(1);
			}),
			runs,
		);
	});

	// Plant: ignore git verify-commit's exit, accepting either unlisted or step keys.
	it.each([
		["a key with no person line", "stranger"],
		["a step key's git signature", "tests"],
	] as const)("G18: refuses %s", (_, who) => {
		fc.assert(
			fc.property(fc.string(), (initial) => {
				const r = new Repo(PERSON_KEYS, undefined, "sha1", initial);
				r.write("next/packages/x/src/a.ts", "a\n");
				const c = r.gitSigned(who);
				const ownLine = `fixture namespaces="git" ${pub(who)}\n`;
				expect(verifyCommit(r, c, ownLine)).toBe(0);
				const out = r.check();
				expect(out.answers).toEqual([stuck("unsigned_commit", c)]);
				expect(out.code).toBe(1);
			}),
			runs,
		);
	});

	// Plant: skip note principal verification. Generated initial contents vary the real trees.
	it("G07: refuses a registered person's key on a step note", () => {
		fc.assert(
			fc.property(fc.string(), (initial) => {
				const r = new Repo(PERSON_KEYS, undefined, "sha1", initial);
				const c = r.change("a.ts");
				const note = r.sign("tests");
				const sig = sh(
					r.dir,
					"ssh-keygen",
					["-Y", "sign", "-n", "fabrika-step", "-f", join(KEYS, "person")],
					signedText(note),
				);
				const allowed = join(TOP, "person-step-signers");
				const signature = join(TOP, "person-step-signature");
				writeFileSync(allowed, `fixture namespaces="fabrika-step" ${pub("person")}\n`);
				writeFileSync(signature, sig);
				const verified = spawnSync(
					"ssh-keygen",
					["-Y", "verify", "-f", allowed, "-I", "fixture", "-n", "fabrika-step", "-s", signature],
					{cwd: r.dir, env: ENV, input: signedText(note)},
				);
				expect(verified.status).toBe(0);
				r.setNote(c, JSON.stringify({...note, key: fingerprint("person"), sig}));
				const out = r.check();
				expect(out.answers).toEqual([stuck("unsigned_commit", c)]);
				expect(out.code).toBe(1);
			}),
			runs,
		);
	});

	// Plant: ignore git verify-commit exit. Generated initial contents vary the real trees.
	it("G08: refuses a bad git signature from a listed person", () => {
		fc.assert(
			fc.property(fc.string(), (initial) => {
				const r = new Repo(PERSON_KEYS, undefined, "sha1", initial);
				r.write("next/packages/x/src/a.ts", "a\n");
				const original = r.gitSigned();
				expect(verifyCommit(r, original)).toBe(0);
				const raw = `${r.git("cat-file", "commit", original)}changed after signing\n`;
				const c = sh(r.dir, "git", ["hash-object", "-t", "commit", "-w", "--stdin"], raw).trim();
				r.git("update-ref", "HEAD", c);
				expect(verifyCommit(r, c)).not.toBe(0);
				const out = r.check();
				expect(out.answers).toEqual([stuck("unsigned_commit", c)]);
				expect(out.code).toBe(1);
			}),
			runs,
		);
	});

	// Plant: trust every person signature. Generated initial contents vary the real trees.
	it("G09: refuses an unsigned commit even when person keys are available", () => {
		fc.assert(
			fc.property(fc.string(), (initial) => {
				const r = new Repo(PERSON_KEYS, undefined, "sha1", initial);
				const c = r.change("a.ts");
				const out = r.check();
				expect(out.answers).toEqual([stuck("unsigned_commit", c)]);
				expect(out.code).toBe(1);
			}),
			runs,
		);
	});
});
