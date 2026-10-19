import {spawn} from "node:child_process";
import {existsSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {fileURLToPath} from "node:url";
import {describe, expect, it} from "vitest";

// The owner's desk in tsh, as the owner meets it: the real launcher (bin/tsh)
// started in a project folder whose tsh.toml names the packs, its lines given
// with -c. One tsh is one session: the asks and the answers live as long as
// it does. The desk's markdown pages are read back from disk after it ends.

const TSH = fileURLToPath(new URL("../../../bin/tsh", import.meta.url));
const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const DESK = "@tea-fabrika/owner-desk";

/** A project folder with the workspace's packages installed in it, and its tsh.toml. */
const project = (toml: string) => {
	const folder = mkdtempSync(join(tmpdir(), "tsh-desk-"));
	symlinkSync(join(ROOT, "node_modules"), join(folder, "node_modules"));
	writeFileSync(join(folder, "tsh.toml"), toml);
	return {folder, home: mkdtempSync(join(tmpdir(), "tsh-desk-home-"))};
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

const PLANS = ["393", "490", "504", "579"].map((n) => `plan:kamp-us/demlik#${n}@1`);
const CHANGED = "plan:kamp-us/demlik#565@2";
const STUCK = "stuck:kamp-us/demlik#367/t1/1";
const RULINGS = ["68", "163", "182", "640"].map((n) => `ruling:kamp-us/demlik#${n}`);
const DEMO = [...PLANS, CHANGED, STUCK, ...RULINGS];

describe("the owner's desk in tsh", () => {
	it("desk-demo, three answers of three kinds, two bad replies, desk again: the inbox and the pages on disk show exactly what is left", async () => {
		const at = project(`packs = ["${DESK}"]\n`);
		const [approved, plan490] = PLANS;
		const [ruled, ruling163] = RULINGS;
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
		expect(run.out).toContain(`Pages: ${join(pages, "inbox.md")}`);
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
	}, 60_000);

	it("a real desk with nothing waiting: its pages go where the pack's settings say, from the config's folder", async () => {
		const at = project(`packs = ["${DESK}"]\n\n[pack."${DESK}"]\ndir = "pages"\n`);
		const run = await tsh(at, ["desk"]);
		expect(run.out).toContain("Nothing waits on the owner.");
		expect(run.out).not.toContain("demo");
		expect(run.out).toContain(`Pages: ${join(at.folder, "pages", "inbox.md")}`);
		expect(run.status).toBe(0);
		expect(existsSync(join(at.folder, "pages", "inbox.md"))).toBe(true);
		expect(pageIds(join(at.folder, "pages"))).toEqual([]);
	}, 60_000);

	it("with no pack that reads replies, the demo still lists its asks and answer says why it cannot", async () => {
		const at = project("");
		const run = await tsh(at, ["desk-demo", `answer --ask ${STUCK} --reply /remove`]);
		expect(inboxesIn(run.out)).toEqual([DEMO]);
		expect(run.out).toContain("No pack in tsh.toml shows pages.");
		expect(run.err).toContain("no pack in tsh.toml reads typed replies");
		expect(run.status).toBe(1);
	}, 60_000);
});
