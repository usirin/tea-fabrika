// Shared by full lint and the no-install CI path. Only repository .gitignore
// rules count; a developer's own global ignore list does not change CI coverage.
import {spawnSync} from "node:child_process";
import {fileURLToPath} from "node:url";

/** @param {string} [root] */
export const checkTracked = (root = process.cwd()) => {
	const result = spawnSync("git", ["ls-files", "-ci", "-z", "--exclude-per-directory=.gitignore"], {
		cwd: root,
		encoding: "utf8",
		maxBuffer: 2 ** 28,
	});
	return {
		ok: result.status === 0 && result.stdout === "",
		files: (result.stdout ?? "").split("\0").filter(Boolean),
	};
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const result = checkTracked();
	if (!result.ok)
		console.error(
			"gitignore: Git failed or .gitignore hides tracked files:",
			result.files.map((file) => JSON.stringify(file)).join(", "),
		);
	process.exitCode = result.ok ? 0 : 2;
}
