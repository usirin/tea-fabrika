import "./leakgrep.sh?raw";
import {spawnSync} from "node:child_process";
import {mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import fc from "fast-check";
import {describe, expect, it} from "vitest";

// Ticket 500, today's tooling (owner, 2026-11-09): an added line is old text when the same diff
// removes, from the same file, a line equal to it once each run of spaces and tabs is one space,
// the ends are trimmed and one last ; or , is dropped. Every diff here is one git itself wrote,
// with the flags the bot's push reads its diff with, unless a law says it is written by hand.
const script = process.env.TEST_LEAKGREP ?? join(import.meta.dirname, "leakgrep.sh");
const options = {seed: 500, numRuns: 8};

// A made-up private word, and one made-up line of each kind the check knows.
const word = "private_zzqxjv";

const leaks = [
	word,
	"/" + "home/someone/work",
	String.fromCodePoint(0x2014),
	`npm_${"a".repeat(36)}`,
];

type Files = Readonly<Record<string, ReadonlyArray<string>>>;

const lab = <A>(
	body: (lab: {
		diff: (before: Files, after: Files, ...flags: string[]) => string;
		hits: (diff: string, list?: string) => number;
	}) => A,
): A => {
	const dir = mkdtempSync(join(tmpdir(), "lg-respaced-"));

	try {
		const repo = join(dir, "repo");
		const words = join(dir, "words");
		mkdirSync(repo);
		writeFileSync(words, `${word}\n`);
		const git = (...args: string[]) => {
			const ran = spawnSync(
				"git",
				["-c", "user.name=t", "-c", "user.email=t@example.invalid", ...args],
				{
					cwd: repo,
					encoding: "utf8",
				},
			);
			expect(ran.status, ran.stderr).toBe(0);
			return ran.stdout;
		};
		git("init", "-q");

		const write = (files: Files) => {
			for (const name of readdirSync(repo)) {
				if (name !== ".git") {
					rmSync(join(repo, name));
				}
			}

			for (const [name, lines] of Object.entries(files)) {
				writeFileSync(join(repo, name), lines.map((line) => `${line}\n`).join(""));
			}

			git("add", "-A");
		};

		return body({
			diff: (before, after, ...flags) => {
				write(before);
				git("commit", "-q", "--allow-empty", "-m", "before");
				write(after);
				return git(
					"diff",
					"--cached",
					"--no-ext-diff",
					"--no-textconv",
					"--unified=0",
					...flags,
					"HEAD",
				);
			},
			// How many hits the check printed. It never prints the text it matched.
			hits: (diff, list = words) => {
				const ran = spawnSync("sh", [script], {
					cwd: repo,
					input: diff,
					encoding: "utf8",
					env: {...process.env, FABRIKA_LEAK_WORDS: list, TYPESAFE_API_KEY: undefined},
				});
				const count = ran.stderr
					.split("\n")
					.filter((line) => line.startsWith("leakgrep: leak ")).length;
				expect(ran.status, ran.stderr).toBe(count === 0 ? 0 : 1);
				expect(ran.stdout.trim()).toBe(count === 0 ? "leakgrep: added text clean" : "");

				for (const leak of leaks) {
					expect(ran.stdout + ran.stderr).not.toContain(leak);
				}

				return count;
			},
		});
	} finally {
		rmSync(dir, {recursive: true, force: true});
	}
};

// A line is words with one space between them, most often with a flagged word among them.
const plain = fc.stringMatching(/^[a-z]{1,8}$/);
const words = fc.array(fc.oneof(plain, fc.constantFrom(...leaks)), {minLength: 1, maxLength: 5});
const end = fc.constantFrom("", ";", ",");
const line = fc.tuple(words, end).map(([tokens, last]) => tokens.join(" ") + last);

// The same words with other spacing: every gap, both ends, and the one last ; or ,.
const gap = fc.constantFrom(" ", "  ", "\t", " \t ");
const edge = fc.constantFrom("", " ", "\t", "    ");

const respaced = (text: string) =>
	fc
		.tuple(fc.array(gap, {minLength: 5, maxLength: 5}), edge, edge, end)
		.map(([gaps, lead, tail, last]) => {
			const tokens = text.replace(/[;,]$/, "").split(" ");
			return (
				lead + tokens.map((token, n) => (n === 0 ? "" : gaps[n]) + token).join("") + last + tail
			);
		});

const file = fc
	.array(line, {minLength: 1, maxLength: 4})
	.chain((before) => fc.tuple(fc.constant(before), fc.tuple(...before.map(respaced))));

describe("T500 leakgrep reads a respaced line as old text, today's tooling", () => {
	// Plants: compare lines as they are (every sweep line is new again), or trim one end only.
	it("a diff that only respaces lines gives the same hits as an empty diff", () => {
		fc.assert(
			fc.property(file, file, ([beforeA, afterA], [beforeB, afterB]) => {
				lab(({diff, hits}) => {
					const respace = diff(
						{"a.txt": beforeA, "b.txt": beforeB},
						{"a.txt": afterA, "b.txt": afterB},
					);
					expect(hits(respace)).toBe(hits(""));
				});
			}),
			options,
		);
	});

	// A new word is one the removed line did not hold, wherever it lands in the added line.
	// Plants: compare only the first word, or drop every ; and , before comparing.
	it("any truly new word in an added line is still scanned", () => {
		fc.assert(
			fc.property(
				file,
				fc.nat(),
				fc.nat(),
				fc.constantFrom(...leaks),
				fc.constantFrom(" ", "; ", ", "),
				([before, after], at, where, leak, joint) => {
					lab(({diff, hits}) => {
						const n = at % before.length;
						const tokens = (after[n] as string).trim().split(/[ \t]+/);
						const spot = where % (tokens.length + 1);
						// The new word may bring a ; or , of its own.
						const changed = [
							...tokens.slice(0, spot),
							leak + joint.trim(),
							...tokens.slice(spot),
						].join(" ");
						const edited = after.map((text, i) => (i === n ? changed : text));
						expect(hits(diff({"a.txt": before}, {"a.txt": edited}))).toBeGreaterThan(0);
					});
				},
			),
			options,
		);
	});

	// Plant: let one removed line clear every added copy of it.
	it("one removed line clears one added line, counted as a multiset", () => {
		fc.assert(
			fc.property(
				fc.constantFrom(...leaks),
				fc.integer({min: 1, max: 3}),
				fc.integer({min: 1, max: 4}),
				(leak, removed, added) => {
					lab(({diff, hits}) => {
						const before = Array.from({length: removed}, () => `\tkeep ${leak};`);
						const after = Array.from({length: added}, () => `  keep  ${leak}`);
						expect(hits(diff({"a.txt": before}, {"a.txt": after}))).toBe(
							Math.max(0, added - removed),
						);
					});
				},
			),
			options,
		);
	});

	const old = `\tkeep ${word};`;
	const now = `  keep  ${word}`;

	// pinned: the same text removed from one file and added to another is new text there.
	// Plant: key removed lines by text alone.
	it("pinned: a line removed from another file clears nothing", () => {
		lab(({diff, hits}) => {
			expect(
				hits(
					diff({"a.txt": [old], "b.txt": ["safe"]}, {"a.txt": ["safe"], "b.txt": ["safe", now]}),
				),
			).toBe(1);
		});
	});

	// scenario: git pairs a renamed file as one file, and then drops its unchanged lines from the diff
	// already. With rename detection off the new path is a new file, and all of it is new text.
	it("scenario: a renamed file is one file when git says so, and a new file when it does not", () => {
		lab(({diff, hits}) => {
			const rest = Array.from({length: 20}, (_, n) => `line ${n}`);
			const before = {"a.txt": [...rest, old]};
			const after = {"b.txt": [...rest, now]};
			const renamed = diff(before, after, "-M");
			expect(renamed).toContain("rename from a.txt");
			expect(hits(renamed)).toBe(0);
			expect(hits(diff(before, after, "--no-renames"))).toBe(1);
		});
	});

	// scenario: a flagged line that only moves inside its file is removed and added as it was. It is old text.
	it("scenario: a flagged line that moved inside its file is cleared", () => {
		lab(({diff, hits}) => {
			const rest = Array.from({length: 6}, (_, n) => `line ${n}`);
			const moved = diff({"a.txt": [old, ...rest]}, {"a.txt": [...rest, old]});
			expect(moved).toContain(`+${old}`);
			expect(hits(moved)).toBe(0);
		});
	});

	// pinned: only one ; or , at the very end is ignored. Runs of spaces become one space and are never
	// deleted, so two words never join into a new one, and `{x}` to `{ x }` is still new text.
	// Plants: strip every trailing ; and , or delete whitespace instead of collapsing it.
	for (const [name, before, after] of [
		["a ; in the middle", `${word}; keep`, `${word} keep`],
		["a , in the middle", `keep ${word}`, `keep, ${word}`],
		["two at the end", `keep ${word}`, `keep ${word};;`],
		["two words joined", `npm_ ${"a".repeat(36)}`, `npm_${"a".repeat(36)}`],
		["one word split", `keep${word}`, `keep ${word}`],
		["spaces put inside braces", `{${word}}`, `{ ${word} }`],
		["a space that is not a space or tab", `keep ${word}`, `keep ${word}`],
	] as const) {
		it(`pinned: ${name} is new text`, () => {
			lab(({diff, hits}) => {
				expect(hits(diff({"a.txt": [before]}, {"a.txt": [after]}))).toBe(1);
			});
		});
	}

	// pinned: a removed line clears only the kinds of hit it had itself. This repo's URL passes alone
	// and is a private word once a , follows it, so the clean old line does not clear the new hit.
	// Plant: clear every kind once the texts are equal.
	it("pinned: a removed line with no hit clears no hit", () => {
		lab(({diff, hits}) => {
			const url = "https://github.com/usirin/tea-fabrika";
			const dir = mkdtempSync(join(tmpdir(), "lg-url-"));

			try {
				const names = join(dir, "words");
				writeFileSync(names, url.split("/").slice(-2).join("\n"));
				expect(hits(diff({"a.txt": [`see ${url}`]}, {"a.txt": [`see  ${url},`]}), names)).toBe(1);
				expect(hits(diff({"a.txt": [`see ${url}`]}, {"a.txt": [`  see ${url}`]}), names)).toBe(0);
			} finally {
				rmSync(dir, {recursive: true, force: true});
			}
		});
	});

	// pinned: a removal counts only in a hunk under git's own `diff --git` header. A diff written by
	// hand, one with no file header, a merge's combined diff and a whole draft clear nothing.
	// Plant: count every line that starts with - as removed.
	for (const [name, input] of [
		["no header", `-${old}\n+${now}\n`],
		["a plain diff -u header", `--- a/a.txt\n+++ b/a.txt\n@@ -1 +1 @@\n-${old}\n+${now}\n`],
		["no hunk header", `diff --git a/a.txt b/a.txt\n--- a/a.txt\n+++ b/a.txt\n-${old}\n+${now}\n`],
		[
			"a combined diff",
			`diff --cc a.txt\n--- a/a.txt\n+++ b/a.txt\n@@@ -1,1 -1,1 +1,1 @@@\n- ${old}\n +${old}\n++${now}\n`,
		],
	] as const) {
		it(`pinned: a diff with ${name} clears nothing`, () => {
			lab(({hits}) => {
				expect(hits(input)).toBeGreaterThan(0);
			});
		});
	}

	// pinned: two diffs of one file, as two commits print them, are two diffs. A line the first one
	// removes does not clear a line the second one adds.
	it("pinned: a removal in one commit's diff clears nothing in the next one's", () => {
		lab(({diff, hits}) => {
			const first = diff({"a.txt": [old, "keep"]}, {"a.txt": ["keep"]});
			const second = diff({"a.txt": ["keep"]}, {"a.txt": ["keep", now]});
			expect(hits(first)).toBe(0);
			expect(hits(first + second)).toBe(1);
		});
	});

	// scenario: nothing added means nothing to check, and a binary file adds no lines.
	it("scenario: an empty diff, only removals and a binary file are clean, and a hit beside them stays", () => {
		lab(({diff, hits}) => {
			const bytes = String.fromCodePoint(0, 1, 2);
			expect(hits("")).toBe(0);
			expect(hits(diff({"a.txt": [old, "keep"]}, {"a.txt": ["keep"]}))).toBe(0);
			const binary = diff({"a.bin": [bytes]}, {"a.bin": [bytes + bytes]});
			expect(binary).toContain("Binary files");
			expect(hits(binary)).toBe(0);
			const beside = diff(
				{"a.bin": [bytes], "a.txt": ["keep"]},
				{"a.bin": [bytes + bytes], "a.txt": ["keep", now]},
			);
			expect(hits(beside)).toBe(1);
		});
	});
});
