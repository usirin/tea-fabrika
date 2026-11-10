import {spawnSync} from "node:child_process";
import {randomBytes} from "node:crypto";
import {mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {isAbsolute, join, matchesGlob, relative, resolve} from "node:path";
import type {Options} from "@anthropic-ai/claude-agent-sdk";
import {wrapCommandWithSandboxMacOS} from "@anthropic-ai/sandbox-runtime/dist/sandbox/macos-sandbox-utils.js";
import {afterEach, describe, expect, it} from "vitest";
import {flagsOf} from "../codex/adapter.ts";
import {harnessOf} from "./harness.ts";

// T237, today's version. Check the maker's permission settings even inside another OS sandbox.
// The native laws below also exercise reads, listings and searches when a sandbox can start.
// https://code.claude.com/docs/en/permissions#read-and-edit

const made: string[] = [];
// Each hidden file holds its own random bytes, so a leak of one cannot hide behind another file's
// text. Names may show (talk-where-you-work.md: hidden means unreadable by any tool); bytes never.
const SECRET = "T237-hidden-bytes-";
const secretOf = (path: string) => `${SECRET}${randomBytes(12).toString("hex")}:${path}\n`;
const TEXT = "ordinary text\n";

afterEach(() => {
	for (const folder of made.splice(0)) rmSync(folder, {recursive: true, force: true});
});

const fixture = () => {
	const root = realpathSync(mkdtempSync(join(tmpdir(), "harness-env-")));
	made.push(root);
	const folder = join(root, "repo");
	const home = join(root, "home");
	mkdirSync(home);
	mkdirSync(join(folder, "src", "deep"), {recursive: true});
	const hidden = [".env", ".env.local", "src/.env", "src/deep/.env.production"];
	const ordinary = ["README.md", "src/env.ts", ".environment", ".envrc", "src/deep/note.txt"];
	const secrets = hidden.map(secretOf);
	for (const [i, path] of hidden.entries()) writeFileSync(join(folder, path), secrets[i]!);
	for (const path of ordinary) writeFileSync(join(folder, path), TEXT);
	symlinkSync(join(folder, ".env"), join(folder, "alias.txt"));
	symlinkSync(join(folder, "src"), join(folder, "linked"));
	symlinkSync(join(folder, "README.md"), join(folder, "readme-link.txt"));
	return {
		folder,
		home,
		secrets,
		hidden: [
			...hidden,
			"alias.txt",
			"linked/.env",
			"linked/deep/.env.production",
			"src/../.env.local",
			"src/deep/../../.env",
		],
		ordinary: [...ordinary, "readme-link.txt", "src/../README.md"],
	};
};

// Evaluate the documented path patterns, not a second implementation of the harness. Check both
// spellings because makers resolve symlinks, while a rule may name the link itself or its target.
const covers = (folder: string, pattern: string, path: string) => {
	const full = resolve(folder, path);
	const real = realpathSync(full);
	const glob = pattern.startsWith("//") ? pattern.slice(1) : pattern;
	return [full, real].some((name) =>
		matchesGlob(isAbsolute(glob) ? name : relative(folder, name), glob.replace(/^\.\//, "")),
	);
};

const claude = (folder: string) => {
	const h = harnessOf("claude", folder, null);
	return (h.meta as {claudeCode: {options: Options}}).claudeCode.options;
};

describe("T237-1: hidden repo files in the harness", () => {
	it("denies Read, Glob and Grep access to root, nested and aliased env files", () => {
		const {folder, hidden, ordinary} = fixture();
		const options = claude(folder);
		const settings = options.settings;
		const rules = typeof settings === "object" ? (settings.permissions?.deny ?? []) : [];
		const reads = rules.flatMap((rule) => {
			const match = /^Read\((.*)\)$/.exec(rule);
			return match?.[1] === undefined ? [] : [match[1]];
		});
		for (const path of ordinary)
			expect(
				reads.some((rule) => covers(folder, rule, path)),
				path,
			).toBe(false);
		for (const path of hidden)
			expect(
				reads.some((rule) => covers(folder, rule, path)),
				path,
			).toBe(true);
	});

	it("keeps shell reads, listings and searches behind env denies, with ordinary files open", () => {
		const {folder, hidden, ordinary} = fixture();
		const options = claude(folder);
		const files = options.sandbox?.filesystem;
		expect(options.sandbox).toMatchObject({enabled: true, allowUnsandboxedCommands: false});
		for (const path of ordinary) {
			expect(files?.allowRead).toContain(folder);
			expect(
				(files?.denyRead ?? []).some((rule) => covers(folder, rule, path)),
				path,
			).toBe(false);
		}
		for (const path of hidden)
			expect(
				(files?.denyRead ?? []).some((rule) => covers(folder, rule, path)),
				path,
			).toBe(true);
	});

	it("denies env files in Codex's read-only repo despite the repo's read grant", () => {
		const {folder, home, hidden, ordinary} = fixture();
		const h = harnessOf({name: "codex", access: "read"}, folder, null, {
			HOME: home,
			PATH: "/usr/bin:/bin",
		});
		const config = JSON.parse(h.env.CODEX_CONFIG ?? "{}");
		const files = config.permissions.fenced.filesystem as Record<string, string>;
		const denied = Object.entries(files)
			.filter(([, rule]) => rule === "deny")
			.map(([path]) => path);
		expect(h.env.INITIAL_AGENT_MODE).toBe("read-only");
		expect(files[folder]).toBe("read");
		for (const path of ordinary)
			expect(
				denied.some((rule) => covers(folder, rule, path)),
				path,
			).toBe(false);
		for (const path of hidden)
			expect(
				denied.some((rule) => covers(folder, rule, path)),
				path,
			).toBe(true);
	});
});

// The tools below run with the harness's real filesystem settings, without starting a model.
// A nested Seatbelt sandbox is unavailable in an agent box. Keep that absence visible as skips;
// the permission-setting laws above still fail on the missing defaults there.
const seatbelt = spawnSync(
	"/usr/bin/sandbox-exec",
	["-p", "(version 1)(allow default)", "/usr/bin/true"],
	{
		encoding: "utf8",
	},
);

const nested = seatbelt.stderr?.includes("sandbox_apply: Operation not permitted") ?? false;
const noSeatbelt = process.platform !== "darwin" || seatbelt.error !== undefined || nested;
const word = (text: string) => `'${text.replaceAll("'", `'\\''`)}'`;

const leaked = (f: ReturnType<typeof fixture>, out: string) => [
	...f.secrets.filter((secret) => out.includes(secret.trim())),
	...(out.includes(SECRET) ? [SECRET] : []),
];

describe.skipIf(noSeatbelt)("T237-1: real reads, listings and searches", () => {
	for (const agent of ["claude", "codex"] as const) {
		const run = (f: ReturnType<typeof fixture>, line: string) => {
			if (agent === "codex") {
				const h = harnessOf({name: "codex", access: "read"}, f.folder, null, {
					HOME: f.home,
					PATH: process.env.PATH,
				});
				mkdirSync(h.env.CODEX_HOME!, {recursive: true});
				return spawnSync(
					"codex",
					[
						"sandbox",
						...flagsOf(JSON.parse(h.env.CODEX_CONFIG ?? "{}")),
						"--",
						"/bin/sh",
						"-c",
						line,
					],
					{cwd: f.folder, env: h.env, encoding: "utf8"},
				);
			}
			const files = claude(f.folder).sandbox!.filesystem!;
			const path = (p: string) => (isAbsolute(p) ? p : resolve(f.folder, p));
			const wrapped = wrapCommandWithSandboxMacOS({
				command: line,
				needsNetworkRestriction: false,
				readConfig: {
					denyOnly: (files.denyRead ?? []).map(path),
					allowWithinDeny: (files.allowRead ?? []).map(path),
				},
				writeConfig: {
					allowOnly: (files.allowWrite ?? []).map(path),
					denyWithinAllow: (files.denyWrite ?? []).map(path),
				},
				binShell: "/bin/sh",
			});
			return spawnSync("/bin/sh", ["-c", wrapped], {cwd: f.folder, encoding: "utf8"});
		};

		const ready = (f: ReturnType<typeof fixture>) => {
			const check = run(f, "/bin/cat README.md");
			expect(check.error, check.stderr).toBeUndefined();
			expect(check.status, check.stderr).toBe(0);
			expect(check.stdout).toBe(TEXT);
		};

		it(`${agent}: ordinary reads work, including symlinks and .. paths`, () => {
			const f = fixture();
			for (const path of f.ordinary) {
				const got = run(f, `/bin/cat ${word(path)}`);
				expect(got.status, got.stderr).toBe(0);
				expect(got.stdout, path).toBe(TEXT);
			}
		});

		it(`${agent}: no env bytes escape through direct, nested, symlink or .. reads`, () => {
			const f = fixture();
			ready(f);
			for (const path of f.hidden) {
				const got = run(f, `/bin/cat ${word(path)}`);
				expect(got.status, path).not.toBe(0);
				expect(leaked(f, got.stdout + got.stderr), path).toEqual([]);
			}
		});

		// A listing may show env names: macOS's sandbox cannot drop one name from a folder. So the
		// law opens every listed entry, and none of them may give back an env file's bytes.
		it(`${agent}: listings keep ordinary files, and no listed entry gives env bytes`, () => {
			const f = fixture();
			ready(f);
			const got = run(
				f,
				'for d in . src src/deep linked linked/deep src/..; do /bin/ls -a "$d"; ' +
					'for n in $(/bin/ls -a "$d"); do [ -f "$d/$n" ] && /bin/cat "$d/$n"; done; done; true',
			);
			for (const name of ["README.md", "env.ts", ".environment", ".envrc", "note.txt"])
				expect(got.stdout, name).toContain(name);
			expect(got.stdout).toContain(TEXT);
			expect(leaked(f, got.stdout + got.stderr)).toEqual([]);
		});

		it(`${agent}: find, even following symlinks, finds ordinary files and opens no env file`, () => {
			const f = fixture();
			ready(f);
			const got = run(f, "/usr/bin/find -L . -type f -print -exec /bin/cat {} ';'");
			for (const path of ["./README.md", "./src/env.ts", "./.envrc", "./src/deep/note.txt"])
				expect(got.stdout, path).toContain(path);
			expect(got.stdout).toContain("./linked/deep/note.txt");
			expect(got.stdout).toContain(TEXT);
			expect(leaked(f, got.stdout + got.stderr)).toEqual([]);
		});

		it(`${agent}: recursive content search returns ordinary matches and no env bytes`, () => {
			const f = fixture();
			ready(f);
			const got = run(f, "/usr/bin/grep -R -n -E 'hidden-[b]ytes|ordinary text' .");
			expect(got.stdout).toContain("./README.md:1:ordinary text");
			expect(got.stdout).toContain("./src/deep/note.txt:1:ordinary text");
			expect(leaked(f, got.stdout + got.stderr)).toEqual([]);
		});
	}
});
