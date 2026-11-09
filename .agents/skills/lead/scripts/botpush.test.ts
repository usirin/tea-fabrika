// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "./botpush.mjs?raw";
import "./leakgrep.sh?raw";
import {spawnSync} from "node:child_process";
import {cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import fc from "fast-check";
import {describe, expect, it} from "vitest";

const options = {seed: 119120, numRuns: 10};
const word = fc.stringMatching(/^[a-z]{8,12}$/).map((s) => `private_${s}`);
const ranges = ["tip", "saved", "diverged"] as const;
const input = fc.record({word, leak: fc.boolean(), range: fc.constantFrom(...ranges)});

// Real Git and real caller. Only keychain, HTTP and network Git are replaced. The RSA key exists
// only in this child process's memory. No real key file, login or network request is touched.
const shim = `
import cp from 'node:child_process';
import {generateKeyPairSync} from 'node:crypto';
import {appendFileSync} from 'node:fs';
import {syncBuiltinESMExports} from 'node:module';
const real = cp.execFileSync;
cp.execFileSync = (cmd, args, options) => {
  if (cmd === 'security') return Buffer.from(generateKeyPairSync('rsa', {modulusLength: 2048, privateKeyEncoding: {type: 'pkcs8', format: 'pem'}, publicKeyEncoding: {type: 'spki', format: 'pem'}}).privateKey);
  if (cmd === 'git' && args.includes('ls-remote')) return Buffer.from('');
  if (cmd === 'git' && args.includes('push')) { appendFileSync(process.env.TEST_PUSH_LOG, 'push\\n'); return Buffer.from(''); }
  if (cmd === 'git' && args.includes('fetch')) throw new Error('unexpected network Git');
  return real(cmd, args, options);
};
globalThis.fetch = async (url) => ({ok: true, json: async () => String(url).endsWith('access_tokens') ? {token: 'made-up', expires_at: 'never'} : {id: 1}});
syncBuiltinESMExports();
`;

describe("T325 K6 botpush, today's tooling", () => {
	// Plant: omit the leakgrep call. Removed private text and the repo URL must still push.
	it("scans every submitted commit from the merge base at the requested source", () => {
		fc.assert(
			fc.property(input, ({word, leak, range}) => {
				const dir = mkdtempSync(join(tmpdir(), "push-"));
				try {
					const scripts = join(dir, ".agents/skills/lead/scripts");
					mkdirSync(scripts, {recursive: true});
					for (const file of ["botpush.mjs", "leakgrep.sh"])
						cpSync(join(import.meta.dirname, file), join(scripts, file));
					writeFileSync(join(dir, "shim.mjs"), shim);
					const words = join(tmpdir(), `words-${dir.split("/").at(-1)}`);
					writeFileSync(
						words,
						`${word}\n${"https://github.com/usirin/tea-fabrika".split("/").slice(-2).join("\n")}\n`,
					);
					try {
						const git = (...args: string[]) => {
							const out = spawnSync(
								"git",
								["-c", "user.name=Tests", "-c", "user.email=tests@example.invalid", ...args],
								{cwd: dir, encoding: "utf8"},
							);
							expect(out.status, out.stderr).toBe(0);
							return out.stdout.trim();
						};
						git("init", "-q");
						// A leaked case must add the word; a clean case must remove it.
						writeFileSync(join(dir, "subject.md"), `${leak ? "safe base" : word}\n`);
						git("add", "subject.md");
						git("commit", "-qm", "base");
						git("update-ref", "refs/remotes/origin/main", "HEAD");
						writeFileSync(
							join(dir, "subject.md"),
							`https://github.com/usirin/tea-fabrika/pull/532\n${leak ? word : "safe addition"}\n`,
						);
						git("add", "subject.md");
						git("commit", "-qm", "change");
						const source = git("rev-parse", "HEAD");
						if (range === "diverged") {
							const text = readFileSync(join(dir, "subject.md"), "utf8");
							git("checkout", "-qb", "upstream", "HEAD^");
							writeFileSync(join(dir, "subject.md"), text);
							writeFileSync(join(dir, "upstream.md"), "safe upstream\n");
							git("add", "subject.md", "upstream.md");
							git("commit", "-qm", "independent upstream change");
							git("update-ref", "refs/remotes/origin/main", "HEAD");
							git("checkout", "--detach", source);
						}
						writeFileSync(join(dir, "tip.md"), "safe followup\n");
						git("add", "tip.md");
						git("commit", "-qm", "safe followup");
						if (range === "saved") {
							writeFileSync(join(dir, "subject.md"), `${leak ? "safe after source" : word}\n`);
							git("add", "subject.md");
							git("commit", "-qm", "opposite result after source");
						}
						const sourceArgs = range === "saved" ? [source] : [];
						git("notes", "--ref=fabrika", "add", "-m", "throwaway");
						const pushed = join(dir, "pushed");
						writeFileSync(pushed, "");
						const out = spawnSync(
							process.execPath,
							[
								"--import",
								join(dir, "shim.mjs"),
								join(scripts, "botpush.mjs"),
								dir,
								"fabrikalfa/test",
								...sourceArgs,
							],
							{
								cwd: dir,
								encoding: "utf8",
								timeout: 10_000,
								env: {
									...process.env,
									GH_REPO: "example/repo",
									FABRIKA_LEAK_WORDS: words,
									TEST_PUSH_LOG: pushed,
									TYPESAFE_API_KEY: undefined,
								},
							},
						);
						expect(out.error).toBeUndefined();
						expect(
							{code: out.status, pushed: readFileSync(pushed, "utf8")},
							out.stdout + out.stderr,
						).toEqual({code: leak ? 1 : 0, pushed: leak ? "" : "push\n"});
						// A refusing shared checker must stop this caller even when its text is safe.
						writeFileSync(
							join(scripts, "leakgrep.sh"),
							"#!/bin/sh\necho 'leakgrep: planted refusal' >&2\nexit 1\n",
						);
						writeFileSync(pushed, "");
						const refused = spawnSync(
							process.execPath,
							[
								"--import",
								join(dir, "shim.mjs"),
								join(scripts, "botpush.mjs"),
								dir,
								"fabrikalfa/test",
								...sourceArgs,
							],
							{
								cwd: dir,
								encoding: "utf8",
								env: {
									...process.env,
									GH_REPO: "example/repo",
									FABRIKA_LEAK_WORDS: words,
									TEST_PUSH_LOG: pushed,
									TYPESAFE_API_KEY: undefined,
								},
							},
						);
						expect(refused.status).toBe(1);
						expect(readFileSync(pushed, "utf8")).toBe("");
					} finally {
						rmSync(words, {force: true});
					}
				} finally {
					rmSync(dir, {recursive: true, force: true});
				}
			}),
			{
				...options,
				// pinned: earlier commits, a saved source and diverged main must all be scanned.
				examples: [
					[{word: "private_aaaaaaaa", leak: true, range: "tip"}],
					[{word: "private_aaaaaaaa", leak: false, range: "tip"}],
					[{word: "private_aaaaaaaa", leak: true, range: "saved"}],
					[{word: "private_aaaaaaaa", leak: false, range: "saved"}],
					[{word: "private_aaaaaaaa", leak: true, range: "diverged"}],
					[{word: "private_aaaaaaaa", leak: false, range: "diverged"}],
				],
			},
		);
	});
});
