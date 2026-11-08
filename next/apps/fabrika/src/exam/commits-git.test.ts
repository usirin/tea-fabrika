// The commit check's planted cases end to end (Tier 1, P32; laws p83 to p87 and p89). Each case is a
// fresh temp repo: git with no global or system config, a `main` with one commit holding
// `allowed_signers` and the real `exam-paths.json`, and a branch `pr` off it. Five throwaway Ed25519
// keys (tests, build, lead, stranger, person) are made once by real `ssh-keygen` in the temp folder and go
// with it; nothing here prints one. The program runs as CI runs it, `node commits.ts ...`.
import {spawnSync} from "node:child_process";
import {mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {dirname, join} from "node:path";
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
	if (ran.status !== 0) throw new Error(`${cmd} ${args.join(" ")}: ${ran.stderr}`);
	return ran.stdout;
};

const KEYS = join(TOP, "keys");
mkdirSync(KEYS, {mode: 0o700});
type Who = Role | "stranger";
for (const who of ["tests", "build", "lead", "stranger", "person"])
	sh(KEYS, "ssh-keygen", ["-q", "-t", "ed25519", "-N", "", "-C", who, "-f", join(KEYS, who)]);
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

	constructor(keys: string | null = GOOD_KEYS, at?: string, format: "sha1" | "sha256" = "sha1") {
		count += 1;
		this.dir = at ?? join(TOP, `r${count}`);
		mkdirSync(this.dir);
		this.git("init", "-q", "-b", "main", `--object-format=${format}`);
		if (keys !== null) this.write("allowed_signers", keys);
		this.write("exam-paths.json", EXAM_LIST);
		this.write("README.md", "x\n");
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
const stuck = (why: string, sha: string, more: object = {}) => ({_tag: "stuck", why, sha, ...more});
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
	it("takes several distinct person ids in namespace git beside the three step roles", () => {
		const r = new Repo(`${PERSON_KEYS}${personLine("github:43", "stranger")}\n`);
		r.change("a.ts");
		r.sign("tests");
		const out = r.check();
		expect(out.answers).toEqual([DONE]);
		expect(out.code).toBe(0);
	});

	it.each([
		["an id twice", `${PERSON_KEYS}${personLine("github:42", "stranger")}\n`],
		["a person reusing a step key", `${GOOD_KEYS}${personLine("github:42", "tests")}\n`],
		["two people reusing a key", `${PERSON_KEYS}${personLine("github:43")}\n`],
		["an empty id", `${GOOD_KEYS}${personLine("")}\n`],
		[
			"a person in namespace fabrika-step",
			`${GOOD_KEYS}${keyLine("person:github:42", "person")}\n`,
		],
	])("refuses %s before judging commits", (_, keys) => {
		const r = new Repo(keys);
		r.change("a.ts");
		r.sign("tests");
		const out = r.check();
		expect(out.code).toBe(2);
		expect(out.answers).toEqual([]);
		expect(out.err).toMatch(/allowed_signers: \S/);
	});
});

describe("person git signatures (p83b)", () => {
	it.each([
		["one person", PERSON_KEYS, "person"],
		[
			"the second of several people",
			`${PERSON_KEYS}${personLine("github:43", "stranger")}\n`,
			"stranger",
		],
	] as const)("counts %s with a git signature and no step note", (_, keys, who) => {
		const r = new Repo(keys);
		r.write("next/packages/x/src/a.ts", "a\n");
		const c = r.gitSigned(who);
		expect(verifyCommit(r, c, keys)).toBe(0);
		expect(r.git("notes", "--ref=fabrika", "list")).toBe("");
		const out = r.check();
		expect(out.answers).toEqual([DONE]);
		expect(out.code).toBe(0);
	});

	it("counts an SSH person commit before and after squash in a SHA-256 repo", () => {
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

	it.each(["xgpgsig", "gpgsig-sha256"])(
		"refuses a non-SSH signature with an SSH %s header even when git reports it valid",
		(header) => {
			const r = new Repo(PERSON_KEYS);
			const unsigned = r.change("a.ts");
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
					"",
				].join("\n"),
				{mode: 0o700},
			);
			r.git("config", "gpg.program", verifier);
			const raw = r
				.git("cat-file", "commit", unsigned)
				.replace(
					"\n\n",
					[
						"",
						`${header} -----BEGIN SSH SIGNATURE-----`,
						"gpgsig -----BEGIN PGP SIGNATURE-----",
						" fixture",
						" -----END PGP SIGNATURE-----",
						"",
						"",
					].join("\n"),
				);
			const c = sh(r.dir, "git", ["hash-object", "-t", "commit", "-w", "--stdin"], raw).trim();
			expect(verifyCommit(r, c)).toBe(0);
			const out = r.check([], r.base, c);
			expect(out.answers).toEqual([stuck("unsigned_commit", c)]);
			expect(out.code).toBe(1);
		},
	);

	it("reports why saving person signers failed", () => {
		const r = new Repo(PERSON_KEYS);
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
	});

	it("uses the base's person keys when the head removes that person", () => {
		const r = new Repo(PERSON_KEYS);
		r.write("allowed_signers", GOOD_KEYS);
		r.gitSigned();
		const out = r.check();
		expect(out.answers).toEqual([ask("allowed_signers")]);
		expect(out.code).toBe(0);
	});

	it("refuses a person's key added only at the head", () => {
		const r = new Repo();
		r.write("allowed_signers", PERSON_KEYS);
		const c = r.gitSigned();
		expect(verifyCommit(r, c)).toBe(0);
		const out = r.check();
		expect(out.answers).toEqual([stuck("unsigned_commit", c), ask("allowed_signers")]);
		expect(out.code).toBe(1);
	});

	it.each([
		["a key with no person line", "stranger"],
		["a step key's git signature", "tests"],
	] as const)("refuses %s", (_, who) => {
		const r = new Repo(PERSON_KEYS);
		r.write("next/packages/x/src/a.ts", "a\n");
		const c = r.gitSigned(who);
		const ownLine = `fixture namespaces="git" ${pub(who)}\n`;
		expect(verifyCommit(r, c, ownLine)).toBe(0);
		const out = r.check();
		expect(out.answers).toEqual([stuck("unsigned_commit", c)]);
		expect(out.code).toBe(1);
	});

	it("refuses a registered person's key on a step note", () => {
		const r = new Repo(PERSON_KEYS);
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
	});

	it("refuses a bad git signature from a listed person", () => {
		const r = new Repo(PERSON_KEYS);
		r.write("next/packages/x/src/a.ts", "a\n");
		const original = r.gitSigned();
		expect(verifyCommit(r, original)).toBe(0);
		const raw = `${r.git("cat-file", "commit", original)}changed after signing\n`;
		const c = sh(r.dir, "git", ["hash-object", "-t", "commit", "-w", "--stdin"], raw).trim();
		r.git("reset", "--hard", "-q", c);
		expect(verifyCommit(r, c)).not.toBe(0);
		const out = r.check();
		expect(out.answers).toEqual([stuck("unsigned_commit", c)]);
		expect(out.code).toBe(1);
	});

	it("refuses an unsigned commit even when person keys are available", () => {
		const r = new Repo(PERSON_KEYS);
		const c = r.change("a.ts");
		const out = r.check();
		expect(out.answers).toEqual([stuck("unsigned_commit", c)]);
		expect(out.code).toBe(1);
	});
});

describe("person exam changes (p84b)", () => {
	it("asks the owner without build_touched_exam for a person's exam commit", () => {
		const r = new Repo(PERSON_KEYS);
		r.write("boundary-rules.json", "[1]\n");
		r.write("next/packages/x/src/a.test.ts", "t\n");
		r.gitSigned();
		const out = r.check();
		expect(out.answers).toEqual([ask("boundary-rules.json", "next/packages/x/src/a.test.ts")]);
		expect(out.code).toBe(0);
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
	it("a tests commit then a build commit off the list, each signed by its role with `sign`", () => {
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

	it("a lead commit that merges main in, then a build commit: main's exam change asks nothing", () => {
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

	it("tests v1, a build commit, then tests v2 after the mutation step, all in the chain", () => {
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

	it("a note on a commit outside the pull request claims tests version 99 with a bad signature", () => {
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
	it("a tests commit adding a next/ test and changing boundary-rules.json, then a clean build", () => {
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

	it("a file whose name holds a newline and a workflow command counts, and is escaped", () => {
		const r = new Repo();
		const name = "a\n::add-mask::next/apps/fabrika/src/exam/commits.ts";
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
			"::warning title=commits::ask owner exam_read a%0A::add-mask::next/apps/fabrika/src/exam/commits.ts",
		);
		const written = readFileSync(summary, "utf8");
		expect(written).toContain('"a\\n::add-mask::next/apps/fabrika/src/exam/commits.ts"');
		expect(written.split("\n").some((l) => l.startsWith("::"))).toBe(false);
		expect(out.err.split("\n").some((l) => l.startsWith("::"))).toBe(false);
	});
});

describe("unsigned_commit (p83)", () => {
	it("no note at all", () => {
		const r = new Repo();
		const c = r.change("a.ts");
		expect(r.check().answers).toEqual([stuck("unsigned_commit", c)]);
		expect(r.check().code).toBe(1);
	});

	it.each([
		["signed by stranger", (r: Repo) => r.sign("stranger")],
		[
			"the build key signs a note whose step says tests",
			(r: Repo) => r.sign("build", {step: "tests"}),
		],
		["signed with namespace fabrika-client", (r: Repo) => r.sign("tests", {ns: "fabrika-client"})],
		[
			"a good note, then its step edited by hand",
			(r: Repo) => {
				const note = r.sign("tests");
				r.setNote(r.head(), JSON.stringify({...note, step: "lead"}));
			},
		],
		["a note that is not JSON", (r: Repo) => r.setNote(r.head(), "step tests, trust me")],
	])("%s", (_, plant) => {
		const r = new Repo();
		const c = r.change("a.ts");
		plant(r);
		expect(r.check().answers).toEqual([stuck("unsigned_commit", c)]);
	});

	it("a signed commit rebased with notes.rewriteRef: the note came along and verifies, its trees do not fit", () => {
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

	it("a good signature whose note names another key's fingerprint", () => {
		const r = new Repo();
		const c = r.change("a.ts");
		const note = r.sign("tests");
		r.setNote(c, JSON.stringify({...note, key: fingerprint("stranger")}));
		expect(r.check().answers).toEqual([stuck("unsigned_commit", c)]);
	});

	it("a key the event's base held and the checked-out main has dropped", () => {
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

	it("a good link for ticket 230 on a commit in ticket 229's pull request", () => {
		const r = new Repo();
		r.change("a.ts");
		r.sign("tests");
		const c = r.change("b.ts");
		r.sign("build", {ticket: "230"});
		expect(r.check().answers).toEqual([stuck("unsigned_commit", c)]);
	});

	it("a key added only in the pull request's own allowed_signers, signing a commit in it", () => {
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
	it("tests signs version 1, redoes it as version 2 on another commit; the branch uses version 1", () => {
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

	it("two verified tests links for the ticket, both version 2", () => {
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
	it("a build commit changing next/apps/fabrika/src/exam/commits.ts", () => {
		const r = new Repo();
		const path = "next/apps/fabrika/src/exam/commits.ts";
		r.write(path, "weaker\n");
		const c = r.commit();
		r.sign("build");
		expect(r.check().answers).toEqual([stuck("build_touched_exam", c, {paths: [path]}), ask(path)]);
	});

	it("a build commit moving a file out of fixtures/next/: the rename's old path", () => {
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

	it("a build commit dropping a row from exam-paths.json and touching that path: the base's list counts", () => {
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

	it("a build commit that merges main in, bringing main's exam change", () => {
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

	it("a build commit adding a file whose name holds a carriage return", () => {
		const r = new Repo();
		const path = "next/packages/x/a\rb.ts";
		r.write(path, "x\n");
		const c = r.commit();
		r.sign("build");
		expect(r.check().answers).toEqual([stuck("build_touched_exam", c, {paths: [path]}), ask(path)]);
	});
});

describe("broken_chain at pull request time (p86)", () => {
	it("the branch is behind main, whose own exam change asks nothing (a three-dot diff)", () => {
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

	it("the branch contains the event's base but not the newer main CI checked out", () => {
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
	it.each([
		[
			"an ECDSA key",
			`${[keyLine("tests", "tests"), keyLine("build", "build"), keyLine("lead", "ecdsa")].join("\n")}\n`,
		],
		["a key under tests and build", `${GOOD_KEYS}${keyLine("build", "tests")}\n`],
		["an unknown principal", `${GOOD_KEYS}${keyLine("owner", "stranger")}\n`],
		["a missing namespace", `${GOOD_KEYS}build ${pub("stranger")}\n`],
		["no allowed_signers on the base", null],
	])("%s", (_, keys) => {
		const r = new Repo(keys);
		r.change("a.ts");
		const out = r.check();
		expect(out.code).toBe(2);
		expect(out.answers).toEqual([]);
		expect(out.err).toContain("allowed_signers");
	});
});

describe("the scope rule", () => {
	it("done, not in scope: only docs/ and field/ changed, its commits unsigned", () => {
		const r = new Repo();
		r.write("docs/x.md", "d\n");
		r.commit();
		r.write("field/notes.jsonl", "{}\n");
		r.commit();
		const out = r.check();
		expect(out.answers).toEqual([DONE]);
		expect(out.code).toBe(0);
		expect(out.err).toContain("not in scope");
	});

	it("judged: the same plus one file under next/, every commit unsigned_commit", () => {
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

	it("judged when only an exam path changed, read from the base's list", () => {
		const r = new Repo();
		r.write("boundary-rules.json", "[5]\n");
		const c = r.commit();
		expect(r.check().answers).toEqual([stuck("unsigned_commit", c), ask("boundary-rules.json")]);
	});
});

describe("judged at the event's head (hole 3)", () => {
	it("the branch gets one more unsigned commit after the event; the event's head is judged", () => {
		const r = new Repo();
		r.change("a.ts");
		r.sign("tests");
		r.change("b.ts");
		r.sign("build");
		const event = r.head();
		r.change("late.ts");
		expect(r.check([], r.base, event).answers).toEqual([DONE]);
	});

	it("with --fetch, CI's own clone of main fetches the event's shas and notes, and nothing newer", () => {
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
	it("refuses a key that does not verify as its step, and adds no note", () => {
		const r = new Repo();
		r.change("a.ts");
		const out = r.run(["sign", "--step", "tests", "--ticket", "229", "--key", join(KEYS, "build")]);
		expect(out.code).toBe(2);
		expect(r.git("notes", "--ref=fabrika", "list")).toBe("");
	});

	it("counts its versions per step and ticket, and the printed link is what the note holds", () => {
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
					cause: null,
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
	it.each([
		"the wrong key",
		"another signature",
		"another to tree",
		"another from tree",
		"an unsigned commit",
		"a step key",
	] as const)("refuses a person link with %s", (plant) => {
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

	it("refuses a signature copied from another commit header", () => {
		const r = new Repo(PERSON_KEYS);
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
		const raw = payload.replace("\n\n", `\ngpgsig ${sig.trimEnd().replaceAll("\n", "\n ")}\n\n`);
		const c = sh(r.dir, "git", ["hash-object", "-t", "commit", "-w", "--stdin"], raw).trim();
		expect(verifyCommit(r, c)).toBe(0);
		const {squash, rows} = squashed(r, [{note: {...personLink(r, c), sig: "forged\n"}, commit: c}]);
		log(r, rows);
		const out = r.run(["chain", "--squash", squash]);
		expect(out.answers).toEqual([stuck("broken_chain", squash)]);
		expect(out.code).toBe(1);
	});

	it("refuses a person link whose keys file is incomplete", () => {
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

	it("fetches a missing signed person commit before checking its logged link", () => {
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

	it.each(["file change", "empty commit"] as const)(
		"connects tests, a person's %s, then build, before and after squash",
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

	it("refuses an unsigned commit between step links, before and after squash", () => {
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

	it("counts a person's signed merge of main and still requires the base in the head", () => {
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
	it("done: a squash whose links run from its base's tree to its tree, one through a lead merge", () => {
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

	it("broken_chain: field/ links with a gap between two links", () => {
		const r = new Repo();
		const steps = twoSteps(r);
		const {squash, rows} = squashed(r, steps);
		log(r, [rows[1]!]);
		expect(r.run(["chain", "--squash", squash]).answers).toEqual([stuck("broken_chain", squash)]);
	});

	it("broken_chain: a link whose sig was made over another to", () => {
		const r = new Repo();
		const steps = twoSteps(r);
		const {squash, rows} = squashed(r, steps);
		const other = r.sign("build", {sha: steps[0]!.commit});
		const bad = rows[1]!.attested[0]!;
		rows[1]!.attested[0] = {...bad, sig: other.sig};
		log(r, rows);
		expect(r.run(["chain", "--squash", squash]).answers).toEqual([stuck("broken_chain", squash)]);
	});

	it("broken_chain: the last link's to is the head's tree, but the squash took a main that moved", () => {
		const r = new Repo();
		const {squash, rows} = squashed(r, twoSteps(r), true);
		log(r, rows);
		expect(r.run(["chain", "--squash", squash]).answers).toEqual([stuck("broken_chain", squash)]);
	});

	it("broken_chain: a link signed by a key that allowed_signers did not hold at the row's keys commit", () => {
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

	it("done: a key main added before the squash counts, at a keys commit on main", () => {
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

	it("broken_chain: a log pull request that adds its own keys commit and points its rows at it", () => {
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

	it("broken_chain: a log pull request naming a squash that is not on main", () => {
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

	it("broken_chain: a link whose base has the base's tree but is not on main", () => {
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

	it("broken_chain: a log row whose attested key is written with an escape is read all the same", () => {
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

	it("stale_link: field/ rows hold a tests link for the ticket newer than any the squash's chain uses", () => {
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

	it("blocks a log pull request for the squashes its new rows name, and passes a good one", () => {
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
