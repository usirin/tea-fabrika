// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "./mutbox.ts?raw";
import "./mutbox-entry.sh?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "./mutbox.Dockerfile?raw";
import "../../mutation/scripts/run.sh?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "../../mutation/scripts/sample.ts?raw";
import "./keepruns.sh?raw";
import "./env.sh?raw";
import "./fieldrow.py?raw";
import "./box.sh?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "./gc.ts?raw";
import "./redact.sh?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "./botpush.mjs?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "./lane.ts?raw";
import "./leakgrep.sh?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "./drive.ts?raw";
import "./clauderow.py?raw";
import "./runplan.sh?raw";
import "../../plan/scripts/plancheck.sh?raw";
import "../../step-commit/scripts/exam.py?raw";
import "../../step-commit/scripts/stepcommit.sh?raw";
import {spawnSync} from "node:child_process";
import {
	existsSync,
	lstatSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import {tmpdir} from "node:os";
import {join, relative} from "node:path";
import fc from "fast-check";
import {describe, expect, it} from "vitest";

// Today's tooling. keepruns.sh runs for real on a temp MAIN and a temp folder.
const script = join(import.meta.dirname, "keepruns.sh");

/** Every file under a folder, as its relative path and content. */
const filesIn = (root: string): Record<string, string> => {
	const out: Record<string, string> = {};
	const visit = (dir: string) => {
		for (const name of readdirSync(dir)) {
			const path = join(dir, name);

			if (lstatSync(path).isDirectory()) {
				visit(path);
			} else {
				out[relative(root, path)] = readFileSync(path, "utf8");
			}
		}
	};

	if (existsSync(root)) {
		visit(root);
	}

	return out;
};

const write = (root: string, files: Record<string, string>) => {
	for (const [path, text] of Object.entries(files)) {
		mkdirSync(join(root, path, ".."), {recursive: true});
		writeFileSync(join(root, path), text);
	}
};

const tree = fc.dictionary(
	fc
		.array(fc.stringMatching(/^[a-z]{1,6}$/), {minLength: 1, maxLength: 3})
		.map((parts) => `${parts.join("/")}.json`),
	fc.stringMatching(/^[a-z0-9 ]{0,12}$/),
	{maxKeys: 5},
);

const withHome = (body: (main: string, dir: string) => void) => {
	const root = mkdtempSync(join(tmpdir(), "keepruns-"));

	try {
		const main = join(root, "main");
		mkdirSync(main);
		body(main, root);
	} finally {
		rmSync(root, {recursive: true, force: true});
	}
};

const run = (main: string, folder: string) => {
	const r = spawnSync("sh", [script, folder], {
		encoding: "utf8",
		env: {
			...process.env,
			MAIN: main,
			BOXES: join(main, "..", "boxes"),
			REMOTE: "unused",
			GH_REPO: "fixture/repo",
			FABRIKA_COAUTHOR: "Fixture <fixture@example.test>",
		},
		timeout: 15_000,
	});
	return {code: r.status, out: r.stdout.trim(), err: r.stderr.trim()};
};

describe("keepruns.sh, today's tooling", () => {
	// Plants: drop the move (the folder's runs/ is lost with it), overwrite a taken name, or move
	// into MAIN's runs/ without the folder's name. Field note 2026-11-09: a removed worktree took
	// experiment 244's raw answers with it.
	it("moves every file of a folder's runs/ into MAIN's runs/<name>/ and never overwrites one there", () => {
		fc.assert(
			fc.property(
				fc.stringMatching(/^[a-z][a-z0-9-]{0,10}( x)?$/),
				tree,
				fc.array(tree, {maxLength: 2}),
				(name, runs, taken) =>
					withHome((main, root) => {
						const folder = join(root, name);
						mkdirSync(folder);
						write(join(folder, "runs"), runs);
						// Names already taken under MAIN's runs/: <name>, then <name>-1.
						const before = taken.map((files, i) => {
							const at = join(main, "runs", i === 0 ? name : `${name}-${i}`);
							mkdirSync(at, {recursive: true});
							write(at, files);
							return [at, filesIn(at)] as const;
						});
						const got = run(main, folder);
						expect(got.code, got.err).toBe(0);

						for (const [at, files] of before) {
							expect(filesIn(at)).toEqual(files);
						}

						if (Object.keys(runs).length === 0) {
							expect(got.out).toBe("");
							return;
						}

						const dest = join(main, "runs", taken.length === 0 ? name : `${name}-${taken.length}`);
						expect(got.out).toBe(`kept runs of ${name} at runs/${dest.split("/").at(-1)}`);
						expect(filesIn(dest)).toEqual(runs);
						expect(existsSync(join(folder, "runs"))).toBe(false);
					}),
			),
			{seed: 119120, numRuns: 40},
		);
	});

	it("scenario: a folder with no runs/ is left alone, and a runs/ symlink or MAIN itself fails", () => {
		// scenario: the three exits the callers read; a failure keeps the folder.
		withHome((main, root) => {
			const plain = join(root, "plain");
			mkdirSync(plain);
			expect(run(main, plain)).toEqual({code: 0, out: "", err: ""});
			expect(existsSync(join(main, "runs"))).toBe(false);
			const linked = join(root, "linked");
			mkdirSync(join(root, "elsewhere"));
			writeFileSync(join(root, "elsewhere", "a.json"), "a");
			mkdirSync(linked);
			symlinkSync(join(root, "elsewhere"), join(linked, "runs"));
			expect(run(main, linked).code).toBe(1);
			expect(readFileSync(join(root, "elsewhere", "a.json"), "utf8")).toBe("a");
			write(join(main, "runs"), {"own.json": "own"});
			expect(run(main, main).code).toBe(1);
			expect(filesIn(join(main, "runs"))).toEqual({"own.json": "own"});
		});
	});
});
