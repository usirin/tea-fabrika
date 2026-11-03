import {execFileSync, spawn} from "node:child_process";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {fileURLToPath} from "node:url";
import {describe, expect, it} from "vitest";
import {JSONC_MOVED, SETTINGS_MOVED} from "../settings.ts";

// The owner's desk in tsh, as the owner meets it: the real launcher (bin/tsh)
// started in a project folder whose .fabrika/fabrika.toml names the packs, its lines
// given with -c. One tsh is one session: the asks and the answers live as long
// as it does. The desk's markdown pages are read back from disk after it ends.

const TSH = fileURLToPath(new URL("../../../../bin/tsh", import.meta.url));
const ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
const DESK = "@tea-fabrika/owner-desk";
/** For the target repository's own commits: no hook, no signing, no config of the machine's. */
const GIT_ENV = {
	PATH: process.env.PATH ?? "",
	GIT_CONFIG_GLOBAL: "/dev/null",
	GIT_CONFIG_NOSYSTEM: "1",
	GIT_AUTHOR_NAME: "owner",
	GIT_AUTHOR_EMAIL: "owner@example.com",
	GIT_COMMITTER_NAME: "owner",
	GIT_COMMITTER_EMAIL: "owner@example.com",
};

/** Write a repository's settings where they belong, in `folder`. */
const putSettings = (folder: string, text: string) => {
	mkdirSync(join(folder, ".fabrika"), {recursive: true});
	writeFileSync(join(folder, ".fabrika", "fabrika.toml"), text);
};

/** A project folder with the workspace's packages installed in it, its .fabrika/fabrika.toml, and a tsh.toml when given. */
const project = (fabrika: string, tsh?: string) => {
	// Its real path: tsh reads the config from the folder it runs in, symlinks resolved. Short names,
	// so a path tsh prints fits its line.
	const folder = realpathSync(mkdtempSync(join(tmpdir(), "d-")));
	symlinkSync(join(ROOT, "node_modules"), join(folder, "node_modules"));
	putSettings(folder, fabrika);
	if (tsh !== undefined) writeFileSync(join(folder, "tsh.toml"), tsh);
	return {folder, home: realpathSync(mkdtempSync(join(tmpdir(), "h-")))};
};

/** Run `lines` in one tsh in `folder`, on `home`: what it printed, and its exit status. */
const tsh = (at: {folder: string; home: string}, lines: readonly string[]) =>
	new Promise<{out: string; err: string; status: number | null}>((resolve) => {
		const child = spawn(TSH, ["-c", lines.join("\n")], {
			cwd: at.folder,
			env: {...process.env, TSH_HOME: at.home, TSH_TRACE: ""},
			stdio: ["ignore", "pipe", "pipe"],
		});
		let out = "";
		let err = "";
		child.stdout.on("data", (chunk) => {
			out += String(chunk);
		});
		child.stderr.on("data", (chunk) => {
			err += String(chunk);
		});
		child.on("exit", (status) => resolve({out, err, status}));
	});

/** The ids of each inbox tsh printed, in order, top to bottom. */
const inboxesIn = (out: string): string[][] => {
	const inboxes: string[][] = [];
	let now: string[] | null = null;
	for (const line of out.split("\n")) {
		if (/wait(s)? on the owner|^Nothing waits on the owner/.test(line)) {
			now = [];
			inboxes.push(now);
			continue;
		}
		const row = /^ {2}(plan|stuck|ruling|check) +(\S+)/.exec(line);
		if (row !== null && now !== null && !row[2]?.startsWith("/")) now.push(row[2] ?? "");
		else if (!line.startsWith("  ")) now = null;
	}
	return inboxes;
};

/** The ids the inbox page on disk lists, top to bottom. */
const pageIds = (dir: string) =>
	readFileSync(join(dir, "inbox.md"), "utf8")
		.split("\n")
		.filter((line) => /^\d+\. /.test(line))
		.map((line) => /\(`([^`]+)`/.exec(line)?.[1] ?? "");

/** The desk's page for one ask, as the markdown view names its file. */
const pageOf = (dir: string, id: string) =>
	readFileSync(join(dir, "asks", `${id.replace(/[^A-Za-z0-9]+/g, "-")}.md`), "utf8");

const plan = (n: number) => `plan:kamp-us/demlik#${n}@1`;
const ruling = (n: number) => `ruling:kamp-us/demlik#${n}`;
const CHANGED = "plan:kamp-us/demlik#565@2";
const STUCK = "stuck:kamp-us/demlik#367/t1/1";
const DEMO = [
	...[393, 490, 504, 579].map(plan),
	CHANGED,
	STUCK,
	...[68, 163, 182, 640].map(ruling),
];

describe("the owner's desk in tsh", () => {
	it("desk-demo, three answers of three kinds, two bad replies, desk again: the inbox and the pages on disk show exactly what is left", async () => {
		const at = project(`packs = ["${DESK}"]\n`);
		const [approved, plan490] = [plan(393), plan(490)];
		const [ruled, ruling163] = [ruling(68), ruling(163)];
		const run = await tsh(at, [
			"desk-demo",
			`answer --ask ${approved} --reply /approve`,
			`answer --ask ${STUCK} --reply "keep-going 3"`,
			`answer --ask ${ruled} --reply "/rule one-off build (b): reject when no Subs are active."`,
			`answer --ask ${plan490} --reply maybe`,
			`answer --ask ${ruling163} --reply /approve`,
			"desk",
		]);
		const left = DEMO.filter((id) => ![approved, STUCK, ruled].includes(id));

		// The demo's ten, then after each answer taken one fewer; the two refused print no inbox.
		const inboxes = inboxesIn(run.out);
		expect(inboxes).toEqual([
			DEMO,
			DEMO.filter((id) => id !== approved),
			DEMO.filter((id) => id !== approved && id !== STUCK),
			left,
			left,
		]);
		expect(run.out).toContain("Taken: plan:kamp-us/demlik#393@1");
		expect(run.out).toContain("demo");

		// A reply the desk cannot read, and one the core does not take: each refused, naming what fits.
		expect(run.err).toMatch(/"maybe" is not a reply.*\/approve.*\/change.*\/no/);
		expect(run.err).toMatch(/a ruling ask takes rule, not approve.*\/rule lasting\|one-off/);
		expect(run.status).toBe(0);

		// The pages, from disk, under the demo's own folder in the tsh home.
		const pages = join(at.home, "desk-demo", "owner-desk");
		expect(run.out).toContain(`Pages: ${pages}\n`);
		expect(pageIds(pages)).toEqual(left);
		expect(pageOf(pages, approved)).toContain("Answered: approved.");
		expect(pageOf(pages, STUCK)).toContain("Answered: keep going, 3 rounds.");
		expect(pageOf(pages, ruled)).toContain(
			"Answered: a one-off call, and it must be built: (b): reject when no Subs are active.",
		);
		// "maybe" changed nothing: 490 still waits, and its page carries no refusal.
		expect(pageOf(pages, plan490)).not.toContain("not taken");
		expect(pageOf(pages, plan490)).toContain("## Answer with one of");
		// The core's refusal shows on the ask's own page.
		expect(pageOf(pages, ruling163)).toContain("Your last answer was not taken");
	});

	it("a real desk with nothing waiting: its pages go where the pack's settings say, from the repository's root", async () => {
		const at = project(`packs = ["${DESK}"]\n\n[pack."${DESK}"]\ndir = "pages"\n`);
		const run = await tsh(at, ["desk"]);
		expect(run.out).toContain("Nothing waits on the owner.");
		expect(run.out).not.toContain("demo");
		expect(run.out).toContain(`Pages: ${join(at.folder, "pages")}\n`);
		expect(run.status).toBe(0);
		expect(existsSync(join(at.folder, "pages", "inbox.md"))).toBe(true);
		expect(existsSync(join(at.folder, ".fabrika", "pages"))).toBe(false);
		expect(pageIds(join(at.folder, "pages"))).toEqual([]);
	});

	it("with no pack that reads replies, the demo still lists its asks and answer says why it cannot", async () => {
		const at = project("");
		const run = await tsh(at, ["desk-demo", `answer --ask ${STUCK} --reply /remove`]);
		expect(inboxesIn(run.out)).toEqual([DEMO]);
		expect(run.out).toContain("No pack in fabrika.toml shows pages.");
		expect(run.err).toContain("no pack in fabrika.toml reads typed replies");
		expect(run.status).toBe(1);
	});

	it("started deep in the repository, the desk takes its packs from the root's .fabrika/fabrika.toml, and reads their paths from the root", async () => {
		const at = project(`packs = ["${DESK}"]\n\n[pack."${DESK}"]\ndir = "pages"\n`);
		mkdirSync(join(at.folder, ".git"));
		const deep = join(at.folder, "packages", "app");
		mkdirSync(deep, {recursive: true});
		const run = await tsh({folder: deep, home: at.home}, ["desk"]);
		// Once on CI tsh printed nothing here, its ledger not started, and what it said was lost: say it.
		expect(run.out, run.err).toContain(`Pages: ${join(at.folder, "pages")}\n`);
		expect(run.status).toBe(0);
		expect(existsSync(join(at.folder, "pages", "inbox.md"))).toBe(true);
	});

	it("tsh.toml names a target repository: its fabrika.toml is read as committed on its default branch, the start folder's is not, and the first line says which", async () => {
		// The start folder's own file would stop tsh if it were read.
		const at = project(`packs = "${DESK}"\n`);
		const git = (cwd: string, args: readonly string[]) =>
			execFileSync("git", args, {cwd, env: GIT_ENV, encoding: "utf8"}).trim();
		const bare = join(at.home, "origin.git");
		const owner = join(at.home, "owner");
		const clone = join(at.home, "clone");
		git(at.home, ["init", "-q", "--bare", "-b", "main", bare]);
		git(at.home, ["init", "-q", "-b", "main", owner]);
		putSettings(owner, `packs = ["${DESK}"]\n\n[pack."${DESK}"]\ndir = "pages"\n`);
		git(owner, ["add", "-A"]);
		git(owner, ["commit", "-q", "--no-verify", "-m", "settings"]);
		git(owner, ["push", "-q", "--no-verify", bare, "main:main"]);
		const commit = git(owner, ["rev-parse", "HEAD"]);
		git(at.home, ["clone", "-q", "--no-checkout", bare, clone]);
		writeFileSync(join(at.folder, "tsh.toml"), `clone = "${clone}"\n`);

		const run = await tsh(at, ["desk"]);
		expect(run.err.split("\n")[0]).toBe(
			`.fabrika/fabrika.toml: ${clone}@main (${commit.slice(0, 7)})`,
		);
		// It ended 1 once, with two whole suites side by side, and what tsh said was lost: say it.
		expect(run.status, run.err).toBe(0);
		// The pack is found, and its paths read, from the folder tsh starts in: never from the clone.
		expect(run.out).toContain(`Pages: ${join(at.folder, "pages")}\n`);
		expect(existsSync(join(clone, "pages"))).toBe(false);
	});

	it("no target repository: the first line names the start folder's file", async () => {
		const run = await tsh(project(""), ["programs"]);
		expect(run.err.split("\n")[0]).toMatch(
			/^\.fabrika\/fabrika\.toml: \/.+\/\.fabrika\/fabrika\.toml$/,
		);
		expect(run.status).toBe(0);
	});

	it("a .fabrika.jsonc in the start folder does not stop tsh, and the run says it is not read", async () => {
		const at = project("");
		writeFileSync(join(at.folder, ".fabrika.jsonc"), "{}\n");
		const run = await tsh(at, ["programs"]);
		expect(run.err).toContain(
			".fabrika.jsonc at main is not read: review rules are [review] in .fabrika/fabrika.toml",
		);
		expect(run.status).toBe(0);
	});

	it("a .fabrika.jsonc with no .fabrika/fabrika.toml stops tsh and says to move it", async () => {
		const at = project("");
		rmSync(join(at.folder, ".fabrika"), {recursive: true});
		writeFileSync(join(at.folder, ".fabrika.jsonc"), "{}\n");
		const run = await tsh(at, ["programs"]);
		expect(run.status, run.err).toBe(2);
		expect(run.err).toContain(JSONC_MOVED);
		expect(run.out).toBe("");
	});

	it("no .fabrika.jsonc: the run lists the review kinds and says where they are read", async () => {
		const run = await tsh(project('[review]\ngoverned = [".github/"]\n'), ["programs"]);
		expect(run.err).toContain("governed [.github/] and ui [] (from fabrika.toml)");
		expect(run.err).not.toContain(".fabrika.jsonc");
		expect(run.status).toBe(0);
	});

	it.each<[string, boolean]>([
		["with none in the folder", false],
		["beside the new one", true],
	])("a fabrika.toml left at the root %s stops tsh and says to move it", async (_, keep) => {
		const at = project("");
		if (!keep) rmSync(join(at.folder, ".fabrika"), {recursive: true});
		writeFileSync(join(at.folder, "fabrika.toml"), "");
		const run = await tsh(at, ["programs"]);
		expect(run.err).toContain(SETTINGS_MOVED);
		expect(run.out).toBe("");
		expect(run.status).toBe(2);
	});

	it.each([
		[
			"a tsh.toml that still lists packs",
			"",
			`packs = ["${DESK}"]\n`,
			"add-on packs moved to .fabrika/fabrika.toml",
		],
		[
			"a fabrika.toml with a value that does not fit",
			`packs = "${DESK}"\n`,
			undefined,
			".fabrika/fabrika.toml: packs: ",
		],
		[
			"a fabrika.toml with an unknown table",
			"[failure]\nfloor = 0.9\n",
			undefined,
			"failure: no such key or table",
		],
	])("%s stops tsh before anything runs, and says why", async (_, fabrika, tshToml, says) => {
		const run = await tsh(project(fabrika, tshToml), ["programs"]);
		expect(run.err).toContain(says);
		expect(run.out).toBe("");
		expect(run.status).toBe(2);
	});
});
