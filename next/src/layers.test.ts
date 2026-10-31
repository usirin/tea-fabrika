import {readdirSync, readFileSync} from "node:fs";
import {dirname, join, relative, resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {expect, it} from "vitest";

// Each layer imports only from below it, and `next/` imports nothing of today's code. A person can
// read the rule, and this test keeps it true.

const SRC = dirname(fileURLToPath(import.meta.url));

/** Lowest first. A folder may import its own files and the folders before it. */
const ORDER = ["transport", "data", "coordination", "app", "desktop", "programs", "window"];

/** What each folder may import, beyond itself. `brain.ts` wires them all, so it has no row. */
const allowed = (folder: string): readonly string[] => {
	if (folder === "data") return [];
	if (folder === "programs") return ["app"];
	return ORDER.slice(0, ORDER.indexOf(folder));
};

const filesIn = (dir: string): readonly string[] =>
	readdirSync(dir, {withFileTypes: true}).flatMap((entry) => {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) return filesIn(path);
		return /\.tsx?$/.test(entry.name) ? [path] : [];
	});

const importsIn = (file: string): readonly string[] =>
	[...readFileSync(file, "utf8").matchAll(/from "([^"]+)"/g)].flatMap((m) =>
		m[1] === undefined ? [] : [m[1]],
	);

const files = filesIn(SRC).filter((file) => !file.endsWith(".test.ts"));

it("finds the code it checks", () => {
	expect(files.length).toBeGreaterThan(15);
});

it.each(files.map((file) => relative(SRC, file)))("%s imports only from below it", (name) => {
	const folder = name.split("/")[0] ?? "";
	if (!ORDER.includes(folder)) return;
	for (const spec of importsIn(join(SRC, name))) {
		if (!spec.startsWith(".")) continue;
		const target = relative(SRC, resolve(dirname(join(SRC, name)), spec)).split("/")[0] ?? "";
		if (target === folder) continue;
		expect(allowed(folder), `${name} imports ${spec}`).toContain(target);
	}
});

it("imports nothing of today's code", () => {
	for (const file of filesIn(SRC).filter((f) => f !== fileURLToPath(import.meta.url))) {
		for (const spec of importsIn(file)) {
			expect(spec).not.toMatch(
				/^@kampus\/|^@tea-fabrika\/|packages\/|programs\/[a-z]+\/src|apps\//,
			);
		}
	}
});
