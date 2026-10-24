// Experiment 137's probe. Claude Code's own Bash tool runs it inside the box:
//
//   node probe.mjs <sha-256 of the key> <the host's key file> <another local port>
//
// It is handed the fake key's SHA-256, never the key. It looks where 128's probe looked (its own
// environment, /proc/self/environ, the host's key file by its path, files under its temp folder,
// home, settings folder and working folder), tries to reach hosts other than the relay, and asks
// the relay for what it should refuse. It prints one line, `PROBE {...}`: booleans, counts and
// HTTP statuses. Never a key, and never a file's text.
//
// Plain JavaScript with no imports beyond Node's own, so it runs in any box that has node.

import {execFileSync} from "node:child_process";
import {createHash} from "node:crypto";
import {existsSync, readdirSync, readFileSync, statSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";

const [hash, keyFile, otherPort] = process.argv.slice(2);
const KEY = /fake-key-[0-9a-f]{32}/g;
const sha = (text) => createHash("sha256").update(text).digest("hex");
/** Does `text` hold the key? Each match is compared by its hash. */
const holds = (text) => (text.match(KEY) ?? []).some((found) => sha(found) === hash);

const readOr = (path) => {
	try {
		return readFileSync(path, "utf8");
	} catch {
		return null;
	}
};

/** Files under `root`, at most `depth` folders down and `max` in all, each under 1 MB. */
const walk = (root, depth, max) => {
	const found = [];
	const go = (dir, left) => {
		if (found.length >= max) return;
		let names;
		try {
			names = readdirSync(dir);
		} catch {
			return;
		}
		for (const name of names) {
			if (found.length >= max) return;
			const path = join(dir, name);
			try {
				const s = statSync(path);
				if (s.isDirectory() && left > 0) go(path, left - 1);
				else if (s.isFile() && s.size < 1_000_000) found.push(path);
			} catch {
				// Not ours to read: the box said no.
			}
		}
	};
	go(root, depth);
	return found;
};

// By its full path: in srt, a PATH folder under the denied home folder makes Node's own PATH
// search stop with EPERM before it gets to curl.
const CURL = existsSync("/usr/bin/curl") ? "/usr/bin/curl" : "curl";

/** One curl call: its HTTP status, or "failed". curl takes the box's proxy settings, if any. */
const curl = (url, extra = []) => {
	try {
		const out = execFileSync(CURL, ["-sS", "-m", "8", "-w", "\n%{http_code}", ...extra, url], {
			encoding: "utf8",
			stdio: ["ignore", "pipe", "ignore"],
		});
		const cut = out.lastIndexOf("\n");
		return {status: out.slice(cut + 1).trim(), body: out.slice(0, cut)};
	} catch {
		return {status: "failed", body: ""};
	}
};

/** One request straight from Node, which takes no proxy settings: its HTTP status, or "failed". */
const direct = (url) =>
	fetch(url, {signal: AbortSignal.timeout(5_000)}).then(
		(r) => String(r.status),
		() => "failed",
	);

const home = process.env.HOME ?? "";
const config = process.env.CLAUDE_CONFIG_DIR ?? (home === "" ? "" : join(home, ".claude"));
const roots = [
	[tmpdir(), 3, 500],
	[home, 2, 500],
	[config, 3, 500],
	[process.cwd(), 2, 200],
].filter(([root]) => root !== "" && root !== "/");
const files = [...new Set(roots.flatMap(([root, depth, max]) => walk(root, depth, max)))];
const configFiles = files.filter((f) => config !== "" && f.startsWith(config));
const proc = readOr("/proc/self/environ");
const key = readOr(keyFile);

// The relay's answers. The probe sends no credential of its own: the relay adds one anyway.
const base = process.env.ANTHROPIC_BASE_URL ?? "";
const json = ["-H", "content-type: application/json", "-H", "anthropic-version: 2023-06-01"];
const ask = (model, maxTokens) =>
	JSON.stringify({model, max_tokens: maxTokens, messages: [{role: "user", content: "hi"}]});
const relay = {
	models: curl(`${base}/v1/models`),
	complete: curl(`${base}/v1/complete`, [...json, "--data", ask("claude-haiku-4-5", 5)]),
	otherModel: curl(`${base}/v1/messages`, [...json, "--data", ask("claude-opus-4-1", 5)]),
	bigMaxTokens: curl(`${base}/v1/messages`, [...json, "--data", ask("claude-haiku-4-5", 100_000)]),
	allowed: curl(`${base}/v1/messages`, [...json, "--data", ask("claude-haiku-4-5", 5)]),
};

const report = {
	env: holds(Object.values(process.env).join("\n")),
	procEnv: proc !== null && holds(proc.replaceAll("\0", "\n")),
	keyFileRead: key !== null,
	keyFileHit: key !== null && holds(key),
	scanned: files.length,
	configScanned: configFiles.length,
	fileHits: files.filter((f) => holds(readOr(f) ?? "")).length,
	/** Which credential names the box's own environment has set. Names only. */
	credentialNames: ["ANTHROPIC_API_KEY", "CLAUDE_CODE_OAUTH_TOKEN", "ANTHROPIC_AUTH_TOKEN"].filter(
		(n) => process.env[n] !== undefined,
	),
	direct: {
		anthropic: await direct("https://api.anthropic.com/v1/messages"),
		example: await direct("https://example.com"),
	},
	curl: {
		anthropic: curl("https://api.anthropic.com/v1/messages").status,
		example: curl("https://example.com").status,
		otherLocalPort: curl(`http://127.0.0.1:${otherPort}/v1/messages`).status,
	},
	relay: Object.fromEntries(Object.entries(relay).map(([k, v]) => [k, v.status])),
	relayEchoedKey: Object.values(relay).some((v) => holds(v.body)),
};
console.log(`PROBE ${JSON.stringify(report)}`);
