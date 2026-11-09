// Push a worktree's branch and step notes as fabrikalfa[bot], in one atomic push. It merges the
// remote's notes in first, and fails when the worktree has no step notes.
// The app key is read from the keychain into memory only; the token is never printed or written.
// usage: node botpush.mjs <worktree> <branch> [src=HEAD]   (branch "-" pushes only the step notes)
// FABRIKA_APP_ID names the GitHub App; GH_REPO (owner/name) defaults to the worktree's origin.
import {execFileSync} from "node:child_process";
import {createSign} from "node:crypto";
import {fileURLToPath} from "node:url";

const [dir, branch, src = "HEAD"] = process.argv.slice(2);
if (!dir || !(branch === "-" || branch?.startsWith("fabrikalfa/")))
	throw new Error("usage: botpush.mjs <worktree> fabrikalfa/<name>");
// Check only committed additions, before reading credentials or making any network request.
try {
	const diff = execFileSync("git", [
		"-C",
		dir,
		"diff",
		"--no-ext-diff",
		"--no-textconv",
		"--unified=0",
		`origin/main...${src}`,
	]);
	execFileSync("sh", [fileURLToPath(new URL("./leakgrep.sh", import.meta.url))], {
		cwd: dir,
		input: diff,
		stdio: ["pipe", "inherit", "inherit"],
	});
} catch {
	process.exit(1);
}
const APP = process.env.FABRIKA_APP_ID ?? "5640348";
const REPO =
	process.env.GH_REPO ??
	execFileSync("git", ["-C", dir, "remote", "get-url", "origin"])
		.toString()
		.trim()
		.replace(/^(https:\/\/github\.com\/|git@github\.com:)/, "")
		.replace(/\.git$/, "");

// The step notes must exist: a branch pushed without them fails the commits check.
try {
	execFileSync("git", ["-C", dir, "rev-parse", "--verify", "-q", "refs/notes/fabrika"]);
} catch {
	throw new Error("botpush: no refs/notes/fabrika here; sign the commits before pushing");
}

const b64 = (s) => Buffer.from(s).toString("base64url");
const raw = execFileSync("security", [
	"find-generic-password",
	"-s",
	"fabrika-github-app-key",
	"-a",
	"fabrika",
	"-w",
])
	.toString()
	.trim();
const pem = raw.includes("BEGIN") ? raw : Buffer.from(raw, "base64").toString();
const now = Math.floor(Date.now() / 1000);
const body = `${b64(JSON.stringify({alg: "RS256", typ: "JWT"}))}.${b64(JSON.stringify({iat: now - 60, exp: now + 540, iss: APP}))}`;
const jwt = `${body}.${createSign("RSA-SHA256").update(body).sign(pem, "base64url")}`;

const api = async (path, init = {}, auth = `Bearer ${jwt}`) => {
	const r = await fetch(`https://api.github.com${path}`, {
		...init,
		headers: {
			Authorization: auth,
			Accept: "application/vnd.github+json",
			"X-GitHub-Api-Version": "2022-11-28",
		},
	});
	if (!r.ok) throw new Error(`${path}: ${r.status}`);
	return r.json();
};
const inst = await api(`/repos/${REPO}/installation`);
const tok = await api(`/app/installations/${inst.id}/access_tokens`, {
	method: "POST",
	body: JSON.stringify({
		repositories: [REPO.split("/")[1]],
		permissions: {contents: "write", workflows: "write"},
	}),
});
const header = `AUTHORIZATION: basic ${Buffer.from(`x-access-token:${tok.token}`).toString("base64")}`;
// No global or system git config, so no credential helper answers before the bot's token.
const env = {
	...process.env,
	GIT_CONFIG_GLOBAL: "/dev/null",
	GIT_CONFIG_NOSYSTEM: "1",
	GIT_TERMINAL_PROMPT: "0",
};
const git = (...a) =>
	execFileSync("git", ["-c", `http.https://github.com/.extraheader=${header}`, ...a], {
		cwd: dir,
		env,
		stdio: ["ignore", "pipe", "pipe"],
	}).toString();
const url = `https://github.com/${REPO}.git`;
// One atomic push: the notes and the branch land together or not at all, so CI finds the signatures.
const refs = ["refs/notes/fabrika:refs/notes/fabrika"];
if (branch !== "-") refs.push(`${src}:refs/heads/${branch}`);
try {
	// Take the remote's notes first and merge them in, as the signer's own push does, so the push is
	// a fast-forward. A conflict (two notes on one commit) stops here, before anything is pushed.
	if (git("ls-remote", url, "refs/notes/fabrika").trim()) {
		git("fetch", "--no-tags", "-q", url, "+refs/notes/fabrika:refs/notes/fabrika-origin");
		git(
			"-c",
			"user.name=fabrikalfa[bot]",
			"-c",
			"user.email=353269643+fabrikalfa[bot]@users.noreply.github.com",
			"notes",
			"--ref=fabrika",
			"merge",
			"-q",
			"refs/notes/fabrika-origin",
		);
	}
	git("push", "--atomic", url, ...refs);
	console.log(
		`pushed ${branch} as fabrikalfa[bot]; installation ${inst.id}; token expires ${tok.expires_at}`,
	);
} catch (e) {
	console.log(
		`push refused: ${String(e.stderr ?? e.message)
			.replaceAll(tok.token, "***")
			.split("\n")
			.filter((l) => /GH0|refused|rejected|error|conflict/i.test(l))
			.join(" | ")}`,
	);
	process.exitCode = 1;
}
