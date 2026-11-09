import {spawnSync} from "node:child_process";
import {mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {dirname, join} from "node:path";
import fc from "fast-check";
import {describe, expect, it} from "vitest";

// Today's tooling, [secrets]. This is redact.sh's file interface: answer and JSONL event paths.
// Exact dropped values are in the parent's fake env. Nothing reads a real config or key file.
const script = join(import.meta.dirname, "redact.sh");
const word = fc.stringMatching(/^[a-z][a-z0-9]{3,12}$/);
const options = {seed: 321, numRuns: 8, endOnFailure: true};
const unicode = (text: string) =>
	[...text].map((c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`).join("");
const decode = (text: string) => {
	let value = text
		.replace(/\\u([0-9a-f]{4})/gi, (_, hex) => String.fromCharCode(Number.parseInt(hex, 16)))
		.replaceAll("\\n", "\n");
	for (let i = 0; i < 3; i++) {
		try {
			value = decodeURIComponent(value);
		} catch {
			break;
		}
	}
	return value;
};
const run = (
	answer: string,
	events: string,
	secrets: Record<string, string>,
	check: (result: {
		code: number | null;
		text: string;
		answer: string;
		events: string;
		again: () => {code: number | null; answer: string; events: string};
	}) => void,
) => {
	const dir = mkdtempSync(join(tmpdir(), "red321-"));
	try {
		const home = join(dir, "home");
		mkdirSync(home);
		const a = join(dir, "answer.txt"),
			e = join(dir, "events.jsonl");
		writeFileSync(a, answer);
		writeFileSync(e, events);
		const env = {
			HOME: home,
			PATH: `${dirname(process.execPath)}:/usr/bin:/bin`,
			TMPDIR: dir,
			...secrets,
		};
		const invoke = () => {
			const got = spawnSync("sh", [script, a, e], {encoding: "utf8", env, timeout: 5_000});
			expect(got.error).toBeUndefined();
			expect(got.signal).toBeNull();
			return {
				code: got.status,
				text: got.stdout + got.stderr,
				answer: readFileSync(a, "utf8"),
				events: readFileSync(e, "utf8"),
			};
		};
		const first = invoke();
		check({...first, again: invoke});
	} finally {
		rmSync(dir, {recursive: true, force: true});
	}
};
const tokens = (value: string) => [
	`npm_${value.repeat(40).slice(0, 36)}`,
	`ghp_${value.repeat(40).slice(0, 36)}`,
	`gho_${value.repeat(40).slice(0, 36)}`,
	`github_pat_${value.repeat(30).slice(0, 22)}_${value.repeat(60).slice(0, 59)}`,
	`sk-${value.repeat(50).slice(0, 48)}`,
	`-----BEGIN PRIVATE KEY-----\n${Buffer.from(value.repeat(10)).toString("base64")}\n-----END PRIVATE KEY-----`,
];

describe("T321 K19 redaction, today's tooling", () => {
	// Plants: skip the event log or one token shape, print a matched value instead of a count.
	it("K19 [secrets] every token shape is removed from both files with only a count printed", () => {
		fc.assert(
			fc.property(word, fc.boolean(), (value, reverse) => {
				const secrets = tokens(value);
				const ordered = reverse ? secrets.toReversed() : secrets;
				run(
					`safe answer\n${ordered.join("\n")}\nsafe tail\n`,
					`${ordered
						.map((secret) => JSON.stringify({type: "item.completed", text: secret}))
						.join("\n")}\n`,
					{},
					(got) => {
						expect(got.code, "redact.sh must implement the planned file redaction").toBe(0);
						for (const output of [got.answer, got.events, got.text])
							for (const secret of secrets) {
								expect(decode(output).includes(secret)).toBe(false);
							}
						for (const output of [got.answer, got.events]) expect(output).toContain("[redacted]");
						expect(got.answer).toContain("safe answer");
						expect(got.answer).toContain("safe tail");
						expect(got.text.trim()).toMatch(/^[^\d\n]*\d+[^\d\n]*$/);
					},
				);
			}),
			options,
		);
	});

	// Plants: match env names case-sensitively, redact only raw strings, or ignore encoded URLs.
	it("K19 [secrets] exact dropped values disappear through JSON escapes and URL encodings", () => {
		fc.assert(
			fc.property(
				fc.record({
					value: word,
					name: fc.constantFrom(
						"TOKEN",
						"secret",
						"Api_Key",
						"db_PASSWORD",
						"proxy_AUTH",
						"npm_config_auth",
					),
					encoding: fc.constantFrom("raw", "unicode", "url", "double-url"),
					reverse: fc.boolean(),
				}),
				({value, name, encoding, reverse}) => {
					const secret = `fake/${value}+pass?=end`;
					const encoded =
						encoding === "url"
							? encodeURIComponent(secret)
							: encoding === "double-url"
								? encodeURIComponent(encodeURIComponent(secret))
								: secret;
					const json =
						encoding === "unicode"
							? `{"text":"${unicode(secret)}"}`
							: JSON.stringify({text: encoded});
					const entries = [
						json,
						JSON.stringify({
							type: "turn.completed",
							usage: {input_tokens: 10, cached_input_tokens: 0, output_tokens: 2},
						}),
					];
					if (reverse) entries.reverse();
					run(`safe\n${encoded}\n`, `${entries.join("\n")}\n`, {[name]: secret}, (got) => {
						expect(got.code, "redact.sh must redact exact dropped values").toBe(0);
						for (const output of [got.answer, got.events, got.text])
							expect(decode(output).includes(secret)).toBe(false);
						for (const line of got.events.trim().split("\n"))
							expect(() => JSON.parse(line)).not.toThrow();
						const again = got.again();
						expect(again.code).toBe(0);
						expect(again.answer).toBe(got.answer);
						expect(again.events).toBe(got.events);
					});
				},
			),
			{...options, numRuns: 12},
		);
	});

	// Plant: lose multiline PEM blocks, or only scrub the file written first.
	it("K19 [secrets] output order and partial failed-run logs do not leave multiline secrets", () => {
		fc.assert(
			fc.property(word, fc.constantFrom("answer", "events", "both"), (value, where) => {
				const pem = tokens(value).at(-1)!;
				const exact = `pass-${value}\nsecond-line`;
				const answer = where === "events" ? "safe\n" : `${pem}\n${exact}\n`;
				const events =
					where === "answer"
						? ""
						: `${JSON.stringify({type: "error", message: `${pem}\n${exact}`})}\n`;
				run(answer, events, {PLANTED_SECRET: exact}, (got) => {
					expect(got.code, "redact.sh must handle partial failed-run output").toBe(0);
					for (const output of [got.answer, got.events, got.text]) {
						expect(decode(output).includes(pem)).toBe(false);
						expect(decode(output).includes(exact)).toBe(false);
					}
					if (where === "answer") expect(got.events).toBe("");
					if (where === "events") expect(got.answer).toBe("safe\n");
				});
			}),
			options,
		);
	});

	// Plant: redact harmless words, change plain bytes, or rewrite usage records.
	it("K19 plain text, UTF-8, final newlines and usage remain byte-for-byte unchanged", () => {
		fc.assert(
			fc.property(word, fc.constantFrom("", "\n", "\r\n"), (value, ending) => {
				const answer = `safe ${value} 猫 café${ending}`;
				const events =
					JSON.stringify({
						type: "turn.completed",
						usage: {input_tokens: 10, cached_input_tokens: 0, output_tokens: 2},
						text: value,
					}) + ending;
				run(answer, events, {PLANTED_SECRET: "absent-madeup-secret"}, (got) => {
					expect(got.code, "redact.sh must preserve safe bytes").toBe(0);
					expect(got.answer).toBe(answer);
					expect(got.events).toBe(events);
				});
			}),
			options,
		);
	});
});
