// The commit check's planted cases end to end (Tier 1, P32; laws p83 to p87 and p89). Each case is a
// fresh temp repo: git with no global or system config, a `main` with one commit holding
// `allowed_signers` and the real `exam-paths.json`, and a branch `pr` off it. Five throwaway Ed25519
// keys (tests, build, lead, stranger, person) are made once by real `ssh-keygen` in the temp folder and go
// with it; nothing here prints one. The program runs as CI runs it, `node commits.ts ...`.
import {spawnSync} from "node:child_process";
import {mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {dirname, join} from "node:path";
import * as fc from "fast-check";
import {afterAll, describe, expect, it} from "vitest";
import {type Role, signedText} from "./commits.ts";

const ROOT = join(import.meta.dirname, "..", "..", "..", "..", "..");
const PROGRAM = join(import.meta.dirname, "commits.ts");
const EXAM_LIST = readFileSync(join(ROOT, "exam-paths.json"), "utf8");
const TOP = realpathSync(mkdtempSync(join(tmpdir(), "commits-")));
afterAll(() => rmSync(TOP, {recursive: true, force: true}));

const ENV: NodeJS.ProcessEnv = {
	...process.env,
	GIT_CONFIG_GLOBAL: "/dev/null",
	GIT_CONFIG_NOSYSTEM: "1",
	GIT_AUTHOR_NAME: "step",
	GIT_AUTHOR_EMAIL: "step@fabrika.test",
	GIT_COMMITTER_NAME: "step",
	GIT_COMMITTER_EMAIL: "step@fabrika.test",
};

delete ENV.GITHUB_STEP_SUMMARY;
delete ENV.GITHUB_ACTIONS;

const sh = (cwd: string, cmd: string, args: string[], input?: string, env = ENV) => {
	const ran = spawnSync(cmd, args, {cwd, env, input, encoding: "utf8"});

	if (ran.status !== 0) {
		throw new Error(`${cmd} ${args.join(" ")}: ${ran.stderr}`);
	}

	return ran.stdout;
};

const KEYS = join(TOP, "keys");
mkdirSync(KEYS, {mode: 0o700});
type Who = Role | "stranger";

for (const who of ["tests", "build", "lead", "stranger", "person"]) {
	sh(KEYS, "ssh-keygen", ["-q", "-t", "ed25519", "-N", "", "-C", who, "-f", join(KEYS, who)]);
}

sh(KEYS, "ssh-keygen", ["-q", "-t", "ecdsa", "-N", "", "-C", "ecdsa", "-f", join(KEYS, "ecdsa")]);

const pub = (who: string) =>
	readFileSync(join(KEYS, `${who}.pub`), "utf8")
		.split(" ")
		.slice(0, 2)
		.join(" ");

/** A key's fingerprint, as `ssh-keygen -l` prints it and a note's `key` holds it. */
const fingerprint = (who: string) =>
	sh(KEYS, "ssh-keygen", ["-l", "-f", join(KEYS, `${who}.pub`)]).split(" ")[1]!;

const keyLine = (role: string, who: string) => `${role} namespaces="fabrika-step" ${pub(who)}`;

const stepKeys = (build = "build") =>
	`${[keyLine("tests", "tests"), keyLine("build", build), keyLine("lead", "lead")].join("\n")}\n`;

const GOOD_KEYS = stepKeys();
const personLine = (id: string, who = "person") => `person:${id} namespaces="git" ${pub(who)}`;
const PERSON_KEYS = `${GOOD_KEYS}${personLine("github:42")}\n`;

let count = 0;

/** A planted repo: `main` with one commit, and the branch `pr` checked out off it. */
class Repo {
	readonly dir: string;
	readonly base: string;

	constructor(
		keys: string | null = GOOD_KEYS,
		at?: string,
		format: "sha1" | "sha256" = "sha1",
		initial = "x\n",
	) {
		count += 1;
		this.dir = at ?? join(TOP, `r${count}`);
		mkdirSync(this.dir);
		this.git("init", "-q", "-b", "main", `--object-format=${format}`);

		if (keys !== null) {
			this.write("allowed_signers", keys);
		}

		this.write("exam-paths.json", EXAM_LIST);
		this.write("README.md", initial);
		this.write("boundary-rules.json", "[]\n");
		this.write("fixtures/next/v.txt", "v\n");
		this.base = this.commit("main");
		this.git("checkout", "-q", "-b", "pr");
	}

	git(...args: string[]) {
		return sh(this.dir, "git", args);
	}

	write(path: string, text: string) {
		mkdirSync(dirname(join(this.dir, path)), {recursive: true});
		writeFileSync(join(this.dir, path), text);
	}

	commit(message = "c") {
		this.git("add", "-A");
		this.git("commit", "-q", "--allow-empty", "-m", message);
		return this.head();
	}

	gitSigned(who: Who | "person" = "person", message = "person") {
		this.git("add", "-A");
		this.git(
			"-c",
			"gpg.format=ssh",
			"-c",
			`user.signingkey=${join(KEYS, who)}`,
			"commit",
			"-q",
			"--gpg-sign",
			"--allow-empty",
			"-m",
			message,
		);
		return this.head();
	}

	head(rev = "HEAD") {
		return this.git("rev-parse", rev).trim();
	}

	/** Commits one file under `next/`, the usual product change. */
	change(name: string) {
		this.write(`next/packages/x/src/${name}`, `${name}\n`);
		return this.commit(name);
	}

	/** Signs a link for a commit the way a step would, with any part planted another way. */
	sign(
		who: Who,
		opts: {step?: Role; ticket?: string; version?: number; ns?: string; sha?: string} = {},
	) {
		const sha = opts.sha ?? this.head();
		const link = {
			step: opts.step ?? (who === "stranger" ? "build" : who),
			ticket: opts.ticket ?? "229",
			version: opts.version ?? 1,
			from: this.head(`${sha}^1^{tree}`),
			to: this.head(`${sha}^{tree}`),
		};
		const args = ["-Y", "sign", "-n", opts.ns ?? "fabrika-step", "-f", join(KEYS, who)];
		const sig = sh(this.dir, "ssh-keygen", args, signedText(link));
		const note = {_tag: "attested", ...link, key: fingerprint(who), sig};
		this.setNote(sha, JSON.stringify(note));
		return note;
	}

	setNote(sha: string, text: string) {
		sh(this.dir, "git", ["notes", "--ref=fabrika", "add", "-f", "-F", "-", sha], text);
	}

	/** `pnpm commits sign`, as a step runs it. */
	signWith(step: Role, ticket = "229") {
		return this.run(["sign", "--step", step, "--ticket", ticket, "--key", join(KEYS, step)]);
	}

	run(args: string[], env = ENV, cwd = this.dir) {
		const ran = spawnSync("node", [PROGRAM, ...args], {cwd, env, encoding: "utf8"});
		const answers = ran.stdout
			.split("\n")
			.filter((l) => l.startsWith("{"))
			.map((l) => JSON.parse(l) as Record<string, unknown>);
		return {code: ran.status, answers, out: ran.stdout, err: ran.stderr};
	}

	check(more: string[] = [], base = this.base, head = "HEAD") {
		return this.run(["check", "--base", base, "--head", head, ...more]);
	}
}

const DONE = {_tag: "done"};
const runs = {seed: 119120, numRuns: 5};
const id = fc.stringMatching(/^[A-Za-z0-9._:-]{1,20}$/);
const name = fc.stringMatching(/^[a-z][a-z0-9_-]{0,12}$/);

const stuck = (reason: string, sha: string, more: object = {}) => ({
	_tag: "stuck",
	reason,
	sha,
	...more,
});

const ask = (...paths: string[]) => ({_tag: "ask", who: "owner", for: "exam_read", paths});

const verifyCommit = (r: Repo, sha: string, keys = PERSON_KEYS) => {
	const allowed = join(TOP, "git-allowed-signers");
	writeFileSync(allowed, keys);
	return spawnSync("git", ["-c", `gpg.ssh.allowedSignersFile=${allowed}`, "verify-commit", sha], {
		cwd: r.dir,
		env: ENV,
		encoding: "utf8",
	}).status;
};

/** Git accepts PGP here, so the exam must still prove that the real header is SSH. */
const acceptPgp = (r: Repo) => {
	const verifier = join(TOP, "pgp-verifier");
	writeFileSync(
		verifier,
		[
			"#!/bin/sh",
			"cat >/dev/null",
			"cat <<'STATUS'",
			"[GNUPG:] NEWSIG",
			"[GNUPG:] GOODSIG 1111111111111111 Fixture",
			"[GNUPG:] VALIDSIG 1111111111111111111111111111111111111111 2026-11-08 1794168000 0 4 0 1 10 00 1111111111111111111111111111111111111111",
			"[GNUPG:] TRUST_FULLY",
			"STATUS",
			// Keep the logged key check from hiding a header parsing bug after the squash.
			`echo 'fixture key ${fingerprint("person")}' >&2`,
			"",
		].join("\n"),
		{mode: 0o700},
	);
	r.git("config", "gpg.program", verifier);
};

const personLink = (r: Repo, sha: string, who = "person") => {
	const signature = /^gpgsig(?:-sha256)? (.*(?:\n .*)*)/m.exec(r.git("cat-file", "commit", sha));
	expect(signature).not.toBeNull();
	return {
		_tag: "attested",
		step: "person",
		ticket: "229",
		version: 1,
		from: r.head(`${sha}^1^{tree}`),
		to: r.head(`${sha}^{tree}`),
		key: fingerprint(who),
		sig: `${signature![1]!.replaceAll("\n ", "\n")}\n`,
	};
};

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
const verifies = (repo: Repo, note: {sig: string; step: Role}, text: string) => {
	writeFileSync(join(repo.dir, ".allowed"), GOOD_KEYS);
	writeFileSync(join(repo.dir, ".sig"), note.sig);
	const args = [
		"-Y",
		"verify",
		"-f",
		".allowed",
		"-I",
		note.step,
		"-n",
		"fabrika-step",
		"-s",
		".sig",
	];
	return spawnSync("ssh-keygen", args, {cwd: repo.dir, input: text}).status === 0;
};

describe("done", () => {
	// scenario: two real signing commands and their printed notes must agree with git.
	it("scenario: a tests commit then a build commit off the list, each signed by its role with `sign`", () => {
		const r = new Repo();
		r.change("a.ts");
		const signed = r.signWith("tests");
		expect(signed.code).toBe(0);
		expect(signed.answers[0]).toMatchObject({_tag: "attested", step: "tests", version: 1});
		r.change("b.ts");
		expect(r.signWith("build").code).toBe(0);
		const out = r.check();
		expect(out.answers).toEqual([DONE]);
		expect(out.code).toBe(0);
		expect(out.err).toContain("ticket 229");
	});

	// scenario: real merge ancestry and its three-dot diff are the behavior.
	it("scenario: a lead commit that merges main in, then a build commit: main's exam change asks nothing", () => {
		const r = new Repo();
		r.change("a.ts");
		r.sign("tests");
		r.git("checkout", "-q", "main");
		r.write("boundary-rules.json", "[1]\n");
		const main = r.commit("main moves");
		r.git("checkout", "-q", "pr");
		r.git("merge", "-q", "--no-edit", "main");
		r.sign("lead");
		r.change("b.ts");
		r.sign("build");
		expect(r.check([], main).answers).toEqual([DONE]);
	});

	// scenario: three signing commands share a real notes ref and its version counter.
	it("scenario: tests v1, a build commit, then tests v2 after the mutation step, all in the chain", () => {
		const r = new Repo();
		r.change("a.test.ts");
		r.signWith("tests");
		r.change("b.ts");
		r.signWith("build");
		r.change("c.test.ts");
		const again = r.signWith("tests");
		expect(again.answers[0]).toMatchObject({step: "tests", version: 2});
		expect(r.check().answers).toEqual([
			ask("next/packages/x/src/a.test.ts", "next/packages/x/src/c.test.ts"),
		]);
	});

	// scenario: a separate git commit and forged signed note must stay outside the branch.
	it("scenario: a note on a commit outside the pull request claims tests version 99 with a bad signature", () => {
		const r = new Repo();
		r.change("a.ts");
		r.sign("tests");
		r.change("b.ts");
		r.sign("build");
		const outside = r.git("commit-tree", "-p", r.base, "-m", "x", r.head("HEAD^{tree}")).trim();
		const forged = r.sign("tests", {sha: outside, version: 99});
		r.setNote(outside, JSON.stringify({...forged, sig: forged.sig.replace("A", "B")}));
		expect(r.check().answers).toEqual([DONE]);
	});
});

describe("ask exam_read (p85)", () => {
	// scenario: two real signed commits distinguish step file changes from the PR diff.
	it("scenario: a tests commit adding a next/ test and changing boundary-rules.json, then a clean build", () => {
		const r = new Repo();
		r.write("next/packages/x/src/a.test.ts", "t\n");
		r.write("boundary-rules.json", "[2]\n");
		r.commit();
		r.sign("tests");
		r.change("a.ts");
		r.sign("build");
		const out = r.check();
		expect(out.answers).toEqual([ask("boundary-rules.json", "next/packages/x/src/a.test.ts")]);
		expect(out.code).toBe(0);
	});

	// Plant: omit annotation escaping. Generate the name before the workflow command.
	it("G22: workflow command in a filename reached printed output (P32 hole 2)", () => {
		fc.assert(
			fc.property(name, (prefix) => {
				const r = new Repo();
				const name = `${prefix}\n::add-mask::next/apps/fabrika/src/exam/commits.ts`;
				r.write(name, "x\n");
				r.commit();
				r.sign("tests");
				const summary = join(r.dir, ".summary");
				const out = r.run(["check", "--base", r.base, "--head", "HEAD"], {
					...ENV,
					GITHUB_STEP_SUMMARY: summary,
				});
				expect(out.answers).toEqual([ask(name)]);
				const lines = out.out.split("\n");
				expect(lines.some((l) => l.startsWith("::add-mask::"))).toBe(false);
				expect(lines).toContain(
					`::warning title=commits::ask owner exam_read ${prefix}%0A::add-mask::next/apps/fabrika/src/exam/commits.ts`,
				);
				const written = readFileSync(summary, "utf8");
				expect(written).toContain(JSON.stringify(name));
				expect(written.split("\n").some((l) => l.startsWith("::"))).toBe(false);
				expect(out.err.split("\n").some((l) => l.startsWith("::"))).toBe(false);
			}),
			runs,
		);
	});
});

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

describe("the scope rule", () => {
	// Plant: judge every path. Generate the docs file name outside the exam.
	it("G15: done, not in scope: only docs/ and field/ changed, its commits unsigned", () => {
		fc.assert(
			fc.property(name, (name) => {
				const r = new Repo();
				r.write(`docs/${name}.md`, "d\n");
				r.commit();
				r.write("field/notes.jsonl", "{}\n");
				r.commit();
				const out = r.check();
				expect(out.answers).toEqual([DONE]);
				expect(out.code).toBe(0);
				expect(out.err).toContain("not in scope");
			}),
			runs,
		);
	});

	// scenario: a three-commit history must be judged in full once its last file enters scope.
	it("scenario: judged: the same plus one file under next/, every commit unsigned_commit", () => {
		const r = new Repo();
		r.write("docs/x.md", "d\n");
		const c1 = r.commit();
		r.write("field/notes.jsonl", "{}\n");
		const c2 = r.commit();
		const c3 = r.change("a.ts");
		expect(r.check().answers).toEqual([
			stuck("unsigned_commit", c1),
			stuck("unsigned_commit", c2),
			stuck("unsigned_commit", c3),
		]);
	});

	// Plant: skip exam-only changes. Generated initial contents vary the real trees.
	it("G16: judged when only an exam path changed, read from the base's list", () => {
		fc.assert(
			fc.property(fc.string(), (initial) => {
				const r = new Repo(GOOD_KEYS, undefined, "sha1", initial);
				r.write("boundary-rules.json", "[5]\n");
				const c = r.commit();
				expect(r.check().answers).toEqual([
					stuck("unsigned_commit", c),
					ask("boundary-rules.json"),
				]);
			}),
			runs,
		);
	});
});

describe("judged at the event's head (hole 3)", () => {
	// scenario: real revision selection must stop at the saved event commit.
	it("scenario: the branch gets one more unsigned commit after the event; the event's head is judged", () => {
		const r = new Repo();
		r.change("a.ts");
		r.sign("tests");
		r.change("b.ts");
		r.sign("build");
		const event = r.head();
		r.change("late.ts");
		expect(r.check([], r.base, event).answers).toEqual([DONE]);
	});

	// scenario: a bare remote, a later push and an independent CI clone exercise fetching.
	it("scenario: with --fetch, CI's own clone of main fetches the event's shas and notes, and nothing newer", () => {
		const origin = join(TOP, `origin${count}.git`);
		sh(TOP, "git", ["init", "-q", "--bare", "-b", "main", origin]);
		const r = new Repo();
		r.git("remote", "add", "origin", origin);
		r.git("push", "-q", "origin", "main");
		r.change("a.ts");
		r.signWith("tests");
		r.change("b.ts");
		r.signWith("build");
		const pushed = r.run(["push"]);
		expect(pushed.code).toBe(0);
		expect(r.git("ls-remote", "origin")).toContain("refs/notes/fabrika");
		const event = r.head();
		r.change("late.ts");
		r.git("push", "-q", "origin", "pr");
		const ci = join(TOP, `ci${count}`);
		sh(TOP, "git", ["clone", "-q", "--branch", "main", origin, ci]);
		const args = [
			"check",
			"--fetch",
			"--pr",
			"7",
			"--base",
			r.base,
			"--head",
			event,
			"--main",
			r.base,
		];
		const out = r.run(args, ENV, ci);
		expect(out.answers).toEqual([DONE]);
		expect(out.err).toContain("2 commits");
		const bad = r.run(["check", "--fetch", "--pr", "7", "--base", r.base, "--head", "pr"], ENV, ci);
		expect(bad.code).toBe(2);
		expect(bad.answers).toEqual([]);
		const noMain = r.run(args.slice(0, -2), ENV, ci);
		expect(noMain.code).toBe(2);
		expect(noMain.err).toContain("--main");
	});
});

describe("sign", () => {
	// Plant: skip sign verification. Generated initial contents vary the real trees.
	it("G17: refuses a key that does not verify as its step, and adds no note", () => {
		fc.assert(
			fc.property(fc.string(), (initial) => {
				const r = new Repo(GOOD_KEYS, undefined, "sha1", initial);
				r.change("a.ts");
				const out = r.run([
					"sign",
					"--step",
					"tests",
					"--ticket",
					"229",
					"--key",
					join(KEYS, "build"),
				]);
				expect(out.code).toBe(2);
				expect(r.git("notes", "--ref=fabrika", "list")).toBe("");
			}),
			runs,
		);
	});

	// scenario: two real signing commands and persisted notes establish per-ticket versions.
	it("scenario: counts its versions per step and ticket, and the printed link is what the note holds", () => {
		const r = new Repo();
		r.change("a.ts");
		r.signWith("tests", "300");
		r.change("b.ts");
		const first = r.signWith("tests", "229");
		expect(first.answers[0]).toMatchObject({version: 1, ticket: "229", commit: r.head()});
		const note = JSON.parse(r.git("notes", "--ref=fabrika", "show", "HEAD"));
		const {commit: _, ...printed} = first.answers[0]!;
		expect(note).toEqual(printed);
		expect(note.key).toMatch(/^SHA256:/);
	});
});

/** A squash on main of the branch, and its links logged in field/runs.jsonl in a later commit. */
const squashed = (r: Repo, notes: Array<{note: object; commit: string}>, moveMain = false) => {
	r.git("checkout", "-q", "main");

	if (moveMain) {
		r.write("docs/other.md", "o\n");
		r.commit("main moves");
	}

	r.git("merge", "--squash", "-q", "pr");
	const squash = r.commit("squash");
	const rows = notes.map(
		({note, commit}, i): {date: string; run: string; attested: Array<Record<string, unknown>>} => ({
			date: "2026-11-07",
			run: `r${i}`,
			attested: [
				{
					...note,
					by: "agent:planted",
					arrivedAt: "2026-11-07T10:00:00-08:00",
					parent: null,
					traceId: `trace-step-${i}`,
					commit,
					pr: "usirin/tea-fabrika#1",
					base: r.base,
					squash,
					keys: r.base,
				},
			],
		}),
	);
	return {squash, rows};
};

const log = (r: Repo, rows: object[]) => {
	r.write("field/runs.jsonl", `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`);
	return r.commit("log");
};

/** A branch with a tests commit and a build commit, each signed. */
const twoSteps = (r: Repo) => {
	const c1 = r.change("a.ts");
	const n1 = r.sign("tests");
	const c2 = r.change("b.ts");
	const n2 = r.sign("build");
	return [
		{note: n1, commit: c1},
		{note: n2, commit: c2},
	];
};

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

			if (change === "file change") {
				r.write("next/packages/x/src/person.ts", "person\n");
			}

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

describe("chain after the merge (p86 and p89)", () => {
	// d4: in a real repo, whichever logged link carries cause (with or without parent), or lacks
	// parent or traceId, chain stops on that row's line and answers nothing. The same log without
	// the change answers done. One repo for this property, and few runs, since each spawns git and
	// node; commits.test.ts's decoder laws cover the input space at 100 runs. Plants: drop
	// onExcessProperty; make parent or traceId optional; read cause as the old name for parent.
	it("d4: any logged link with cause, or without parent or traceId, stops the chain on its line", () => {
		const r = new Repo();
		const {squash, rows} = squashed(r, twoSteps(r));
		log(r, rows);
		expect(r.run(["chain", "--squash", squash])).toMatchObject({code: 0, answers: [DONE]});
		// A cause of null or a string is what an old link held, so it comes up often.
		const cause = fc.oneof(fc.constant(null), fc.string(), fc.jsonValue());
		const change = fc.oneof(
			cause.map((cause) => ({_tag: "cause" as const, cause, keepParent: true})),
			cause.map((cause) => ({_tag: "cause" as const, cause, keepParent: false})),
			fc.constantFrom(
				{_tag: "drop" as const, field: "parent"},
				{_tag: "drop" as const, field: "traceId"},
			),
		);
		fc.assert(
			fc.property(fc.nat(rows.length - 1), change, (at, how) => {
				const bad = structuredClone(rows);
				const link: Record<string, unknown> = bad[at]!.attested[0]!;

				if (how._tag === "cause") {
					if (!how.keepParent) {
						delete link.parent;
					}

					link.cause = how.cause;
				} else {
					delete link[how.field];
				}

				log(r, bad);
				const out = r.run(["chain", "--squash", squash]);
				expect(out.code).toBe(2);
				expect(out.answers).toEqual([]);
				expect(out.err).toContain(`field/runs.jsonl line ${at + 1}: a link that does not read`);
			}),
			{seed: 119120, endOnFailure: true, numRuns: 8},
		);
	});

	// scenario: signed commits, squash and later log commits require a fixed real git history.
	it("scenario: done: a squash whose links run from its base's tree to its tree, one through a lead merge", () => {
		const r = new Repo();
		const c1 = r.change("a.ts");
		const n1 = r.sign("tests");
		r.git("checkout", "-q", "main");
		r.write("docs/other.md", "o\n");
		r.commit("main moves");
		r.git("checkout", "-q", "pr");
		r.git("merge", "-q", "--no-edit", "main");
		const c2 = r.head();
		const n2 = r.sign("lead");
		const c3 = r.change("b.ts");
		const n3 = r.sign("build");
		const {squash, rows} = squashed(r, [
			{note: n1, commit: c1},
			{note: n2, commit: c2},
			{note: n3, commit: c3},
		]);
		log(r, rows);
		const out = r.run(["chain", "--squash", squash]);
		expect(out.answers).toEqual([DONE]);
		expect(out.code).toBe(0);
	});

	// scenario: signed commits, squash and later log commits require a fixed real git history.
	it("scenario: broken_chain: field/ links with a gap between two links", () => {
		const r = new Repo();
		const steps = twoSteps(r);
		const {squash, rows} = squashed(r, steps);
		log(r, [rows[1]!]);
		expect(r.run(["chain", "--squash", squash]).answers).toEqual([stuck("broken_chain", squash)]);
	});

	// scenario: signed commits, squash and later log commits require a fixed real git history.
	it("scenario: broken_chain: a link whose sig was made over another to", () => {
		const r = new Repo();
		const steps = twoSteps(r);
		const {squash, rows} = squashed(r, steps);
		const other = r.sign("build", {sha: steps[0]!.commit});
		const bad = rows[1]!.attested[0]!;
		rows[1]!.attested[0] = {...bad, sig: other.sig};
		log(r, rows);
		expect(r.run(["chain", "--squash", squash]).answers).toEqual([stuck("broken_chain", squash)]);
	});

	// scenario: signed commits, squash and later log commits require a fixed real git history.
	it("scenario: broken_chain: the last link's to is the head's tree, but the squash took a main that moved", () => {
		const r = new Repo();
		const {squash, rows} = squashed(r, twoSteps(r), true);
		log(r, rows);
		expect(r.run(["chain", "--squash", squash]).answers).toEqual([stuck("broken_chain", squash)]);
	});

	// scenario: signed commits, squash and later log commits require a fixed real git history.
	it("scenario: broken_chain: a link signed by a key that allowed_signers did not hold at the row's keys commit", () => {
		const r = new Repo();
		const c1 = r.change("a.ts");
		const n1 = r.sign("tests");
		const c2 = r.change("b.ts");
		const n2 = r.sign("stranger");
		r.git("checkout", "-q", "-b", "rotate", r.base);
		r.write("allowed_signers", stepKeys("stranger"));
		const rotated = r.commit("rotate");
		r.git("checkout", "-q", "pr");
		const {squash, rows} = squashed(r, [
			{note: n1, commit: c1},
			{note: n2, commit: c2},
		]);
		log(r, rows);
		expect(r.run(["chain", "--squash", squash]).answers).toEqual([stuck("broken_chain", squash)]);
		// A keys commit on a side branch, never on main: it holds the key, and still counts for nothing.
		rows[1]!.attested[0] = {...rows[1]!.attested[0]!, keys: rotated};
		log(r, rows);
		expect(r.run(["chain", "--squash", squash]).answers).toEqual([stuck("broken_chain", squash)]);
	});

	// scenario: signed commits, squash and later log commits require a fixed real git history.
	it("scenario: done: a key main added before the squash counts, at a keys commit on main", () => {
		const r = new Repo();
		r.git("checkout", "-q", "main");
		r.write("allowed_signers", stepKeys("stranger"));
		const rotated = r.commit("rotate");
		r.git("checkout", "-q", "pr");
		r.git("merge", "-q", "--no-ff", "--no-edit", "main");
		const c1 = r.head();
		const n1 = r.sign("lead");
		const c2 = r.change("b.ts");
		const n2 = r.sign("stranger");
		const {squash, rows} = squashed(r, [
			{note: n1, commit: c1},
			{note: n2, commit: c2},
		]);
		rows[1]!.attested[0] = {...rows[1]!.attested[0]!, keys: rotated};
		log(r, rows);
		expect(r.run(["chain", "--squash", squash]).answers).toEqual([DONE]);
	});

	// scenario: signed commits, squash and later log commits require a fixed real git history.
	it("scenario: broken_chain: a log pull request that adds its own keys commit and points its rows at it", () => {
		const r = new Repo();
		const c1 = r.change("a.ts");
		const n1 = r.sign("tests");
		const c2 = r.change("b.ts");
		const n2 = r.sign("stranger");
		const {squash, rows} = squashed(r, [
			{note: n1, commit: c1},
			{note: n2, commit: c2},
		]);
		const main = r.head();
		r.git("checkout", "-q", "-b", "log", main);
		r.write("allowed_signers", stepKeys("stranger"));
		const forged = r.commit("my own keys");
		rows[1]!.attested[0] = {...rows[1]!.attested[0]!, keys: forged};
		log(r, rows);
		const out = r.run(["chain", "--base", main, "--head", "HEAD"]);
		expect(out.answers).toEqual([stuck("broken_chain", squash)]);
		expect(out.code).toBe(1);
	});

	// scenario: signed commits, squash and later log commits require a fixed real git history.
	it("scenario: broken_chain: a log pull request naming a squash that is not on main", () => {
		const r = new Repo();
		const steps = twoSteps(r);
		r.git("checkout", "-q", "-b", "elsewhere", r.base);
		r.git("merge", "--squash", "-q", "pr");
		const fake = r.commit("a squash off main");
		const {rows} = squashed(r, steps);
		const main = r.head();
		r.git("checkout", "-q", "-b", "log", main);
		const moved = rows.map((row) => ({
			...row,
			attested: row.attested.map((l) => ({...l, squash: fake})),
		}));
		log(r, moved);
		expect(r.run(["chain", "--base", main, "--head", "HEAD"]).answers).toEqual([
			stuck("broken_chain", fake),
		]);
	});

	// scenario: signed commits, squash and later log commits require a fixed real git history.
	it("scenario: broken_chain: a link whose base has the base's tree but is not on main", () => {
		const r = new Repo();
		const steps = twoSteps(r);
		const {squash, rows} = squashed(r, steps);
		const twin = r
			.git("commit-tree", "-p", r.base, "-m", "twin", r.head(`${r.base}^{tree}`))
			.trim();
		const moved = rows.map((row) => ({
			...row,
			attested: row.attested.map((l) => ({...l, base: twin})),
		}));
		log(r, moved);
		expect(r.run(["chain", "--squash", squash]).answers).toEqual([stuck("broken_chain", squash)]);
	});

	// scenario: signed commits, squash and later log commits require a fixed real git history.
	it("scenario: broken_chain: a log row whose attested key is written with an escape is read all the same", () => {
		const r = new Repo();
		const steps = twoSteps(r);
		const {squash, rows} = squashed(r, steps);
		const main = r.head();
		const line = JSON.stringify(rows[1]!).replaceAll('"attested"', '"\\u0061ttested"');
		r.write("field/runs.jsonl", `${line}\n`);
		r.commit("log");
		const out = r.run(["chain", "--base", main, "--head", "HEAD"]);
		expect(out.answers).toEqual([stuck("broken_chain", squash)]);
		expect(out.code).toBe(1);
	});

	// scenario: signed commits, squash and later log commits require a fixed real git history.
	it("scenario: stale_link: field/ rows hold a tests link for the ticket newer than any the squash's chain uses", () => {
		const r = new Repo();
		const steps = twoSteps(r);
		r.git("checkout", "-q", "-b", "redo", r.base);
		const c = r.change("z.ts");
		const newer = r.sign("tests", {version: 2});
		r.git("checkout", "-q", "pr");
		const {squash, rows} = squashed(r, steps);
		const extra = {
			...rows[0]!,
			attested: [{...rows[0]!.attested[0]!, ...newer, commit: c, squash: c}],
		};
		log(r, [...rows, extra]);
		expect(r.run(["chain", "--squash", squash]).answers).toEqual([
			stuck("stale_link", squash, {step: "tests"}),
		]);
	});

	// scenario: signed commits, squash and later log commits require a fixed real git history.
	it("scenario: blocks a log pull request for the squashes its new rows name, and passes a good one", () => {
		const r = new Repo();
		const steps = twoSteps(r);
		const {squash, rows} = squashed(r, steps);
		const before = r.head();
		log(r, [rows[1]!]);
		const bad = r.run(["chain", "--base", before, "--head", "HEAD"]);
		expect(bad.answers).toEqual([stuck("broken_chain", squash)]);
		expect(bad.code).toBe(1);
		log(r, rows);
		const good = r.run(["chain", "--base", before, "--head", "HEAD"]);
		expect(good.answers).toEqual([DONE]);
		expect(good.code).toBe(0);
	});
});
