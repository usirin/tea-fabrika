import {posix} from "node:path";

/**
 * Today's tooling. Match script basenames even in comments and shell strings.
 * @param {ReadonlyMap<string, string>} tree repo paths under skill scripts folders
 * @returns {{test: string, path: string, via: string}[]}
 */
export const scriptReads = (tree) => {
	const scripts = [...tree.keys()].filter((path) => !path.endsWith(".test.ts"));
	const names = scripts.map((path) => ({
		path,
		word: new RegExp(
			`(?<![\\w.-])${posix.basename(path).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\w.-])`,
		),
	}));
	const missing = [];
	for (const [test, text] of tree) {
		if (!test.endsWith(".test.ts")) continue;
		const declared = new Set(
			[...text.matchAll(/\bimport\s+(?:[^;]*?\sfrom\s*)?["']([^"']+)["']/g)].map((m) =>
				posix.normalize(posix.join(posix.dirname(test), (m[1] ?? "").replace(/\?raw$/, ""))),
			),
		);
		const seen = new Set([test]);
		const queue = [test];
		for (const via of queue) {
			const source = tree.get(via) ?? "";
			for (const {path, word} of names) {
				if (seen.has(path) || !word.test(source)) continue;
				seen.add(path);
				queue.push(path);
				if (!declared.has(path)) missing.push({test, path, via});
			}
		}
	}
	return missing;
};
