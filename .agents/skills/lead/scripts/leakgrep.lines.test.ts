import "./leakgrep.sh?raw";
import {spawnSync} from "node:child_process";
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import fc from "fast-check";
import {describe, expect, it} from "vitest";

// Ticket 518, today's tooling: the check reads a diff line the way git writes it, up to the
// newline. Every diff here is one git itself wrote, with the flags the bot's push reads its diff
// with. The private word is made up.
const script = process.env.TEST_LEAKGREP ?? join(import.meta.dirname, "leakgrep.sh");
const options = {seed: 518, numRuns: 12};
const word = "private_zzqxjv";

// The characters, other than the newline, that some line readers end a line at.
const marks = [
	["U+000B", "\v"],
	["U+000C", "\f"],
	["U+000D", "\r"],
	["U+001C", "\u001C"],
	["U+001D", "\u001D"],
	["U+001E", "\u001E"],
	["U+0085", "\u0085"],
	["U+2028", " "],
	["U+2029", " "],
] as const;

type Lab = {
	/** The diff git writes when one file's lines, each ended by a newline, become these. */
	diff: (lines: ReadonlyArray<string>, before?: ReadonlyArray<string>) => string;
	/** The line numbers the check names for a private word, in a diff or in a whole draft. */
	hits: (input: string, mode?: "diff" | "text") => ReadonlyArray<number>;
};

const lab = <A>(body: (lab: Lab) => A): A => {
	const dir = mkdtempSync(join(tmpdir(), "lg-lines-"));

	try {
		const repo = join(dir, "repo");
		const words = join(dir, "words");
		const draft = join(dir, "draft");
		mkdirSync(repo);
		writeFileSync(words, `${word}\n`);
		const git = (...args: string[]) => {
			const ran = spawnSync(
				"git",
				[
					"-c",
					"user.name=t",
					"-c",
					"user.email=t@example.invalid",
					"-c",
					"core.autocrlf=false",
					"-c",
					"core.safecrlf=false",
					...args,
				],
				{cwd: repo, encoding: "utf8"},
			);
			expect(ran.status, ran.stderr).toBe(0);
			return ran.stdout;
		};
		git("init", "-q");
		git("commit", "-q", "--allow-empty", "-m", "before");

		return body({
			diff: (lines, before) => {
				const write = (text: ReadonlyArray<string>) => {
					writeFileSync(join(repo, "a.txt"), text.map((line) => `${line}\n`).join(""));
					git("add", "-A");
				};

				if (before !== undefined) {
					write(before);
					git("commit", "-q", "-m", "before");
				}

				write(lines);
				return git("diff", "--cached", "--no-ext-diff", "--no-textconv", "--unified=0", "HEAD");
			},
			hits: (input, mode = "diff") => {
				if (mode === "text") {
					writeFileSync(draft, input);
				}

				const ran = spawnSync("sh", mode === "text" ? [script, "--text", draft] : [script], {
					cwd: repo,
					input: mode === "text" ? "" : input,
					encoding: "utf8",
					env: {...process.env, FABRIKA_LEAK_WORDS: words, TYPESAFE_API_KEY: undefined},
				});
				expect([0, 1], ran.stderr).toContain(ran.status);
				expect(ran.stdout + ran.stderr).not.toContain(word);
				return ran.stderr
					.split("\n")
					.map((line) => /^leakgrep: leak private_word at added line (\d+)$/.exec(line))
					.flatMap((match) => (match === null ? [] : [Number(match[1])]));
			},
		});
	} finally {
		rmSync(dir, {recursive: true, force: true});
	}
};

// Any text git reads as one line of a text file: every Unicode character but the newline and
// NUL (a NUL makes the file binary to git), with the marks above drawn far more often.
const char = fc.oneof(
	{weight: 3, arbitrary: fc.constantFrom(...marks.map(([, mark]) => mark))},
	{weight: 2, arbitrary: fc.string({unit: "binary", minLength: 1, maxLength: 1})},
	{weight: 1, arbitrary: fc.constantFrom(" ", "\t", "a", "+", "-", "@", ";")},
);

const part = fc
	.array(char, {maxLength: 6})
	.map((chars) => chars.join(""))
	.filter((text) => !/[\n\0]/.test(text) && !text.toLowerCase().includes("private"));

// A line that holds the word somewhere, or does not hold it at all.
const line = fc
	.tuple(part, fc.boolean(), part)
	.map(([before, holds, after]) => before + (holds ? word : "") + after);

const lines = fc.array(line, {minLength: 1, maxLength: 5});

// Git's diff of a new file: five header lines, the hunk header, then the added lines.
const FIRST = 7;

/** The lines of a text as git counts them: 1-based, each ending at a newline. */
const numbered = (text: string) => text.split("\n").map((line, n) => [n + 1, line] as const);

describe("T518 leakgrep reads a line up to the newline, today's tooling", () => {
	// Plants: cut lines with a reader that knows other line ends, or read the input with its line
	// ends translated.
	it("every added line of a diff is read whole, whatever characters it holds", () => {
		fc.assert(
			fc.property(lines, (file) => {
				lab(({diff, hits}) => {
					const written = diff(file);

					// Git wrote each line as one added line, so the diff is the one this law is about.
					for (const text of file) {
						expect(written).toContain(`\n+${text}\n`);
					}

					const expected = numbered(written)
						.filter(([, text]) => text.startsWith("+") && text.includes(word))
						.map(([n]) => n);
					expect(expected).toHaveLength(file.filter((text) => text.includes(word)).length);
					expect(hits(written)).toEqual(expected);
				});
			}),
			options,
		);
	});

	// The same reading for a whole draft: a hit names the line as a newline count gives it.
	it("every line of a draft is read whole, whatever characters it holds", () => {
		fc.assert(
			fc.property(lines, (file) => {
				lab(({hits}) => {
					const draft = file.map((text) => `${text}\n`).join("");
					const expected = numbered(draft)
						.filter(([, text]) => text.includes(word))
						.map(([n]) => n);
					expect(hits(draft, "text")).toEqual(expected);
				});
			}),
			options,
		);
	});

	// vector: one fixed line per character, with the word after it, at the start and at the end.
	for (const [name, mark] of marks) {
		it(`vector: a line holding ${name} is one line`, () => {
			lab(({diff, hits}) => {
				expect(hits(diff([`keep${mark}${word}`, "safe", `${mark}${word}`]))).toEqual([
					FIRST,
					FIRST + 2,
				]);
				expect(hits(diff([`${word}${mark}`, `keep${mark}safe`]))).toEqual([FIRST]);
				expect(hits(diff([`keep${mark}safe`, `safe${mark}${mark}keep`]))).toEqual([]);
			});
		});
	}

	// pinned: a file with CRLF line ends keeps its carriage return in the line, and the line is
	// still read. For the respaced-line rule the carriage return is the line's end, as it was.
	// Plant: compare the carriage return as text in that rule.
	it("pinned: a carriage return before the newline stays in the line", () => {
		lab(({diff, hits}) => {
			expect(hits(diff([`keep ${word}\r`, "safe\r"]))).toEqual([FIRST]);
			expect(hits(diff([`  keep  ${word}\r`], [`\tkeep ${word};\r`]))).toEqual([]);
			expect(hits(diff([`keep ${word}\rmore\r`], [`keep ${word}\r`]))).toHaveLength(1);
		});
	});
});
