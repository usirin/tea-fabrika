// `pnpm lint:versions`: no ranged npm version, in any package.json or pnpm-workspace.yaml git tracks
// (docs/direction/pin-exact-versions.md). It lists what passes, so a range, a tag, a `git:` or a
// `file:` all fail without being named here.
//
//   node oxlint-plugins/exact-versions.ts            # this repo
//   node oxlint-plugins/exact-versions.ts <folder>   # another git tree, as the test does
//
// Exit 0 when clean, 1 on a version it refuses, 2 when it could not read something.
import {spawnSync} from "node:child_process";
import {readFileSync} from "node:fs";
import {basename, join} from "node:path";
import {parse} from "yaml";

/** `catalog:` holds its version in pnpm-workspace.yaml, which is checked too. `workspace:*` is the
 * sibling in this repo, written as its exact version in a pack. `workspace:^` would be a range. */
const POINTERS = new Set(["catalog:", "workspace:*"]);
const EXACT = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$/;

const FIELDS = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"];
// A package.json can name a version in these too, and pnpm reads `pnpm.overrides` there as well.
const OVERRIDES = ["overrides", "resolutions"];

const passes = (version: unknown): boolean =>
	typeof version === "string" && (POINTERS.has(version) || EXACT.test(version));

const isMap = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

/** One line per name in `map` whose version does not pass. */
const refused = (file: string, field: string, map: unknown): readonly string[] =>
	isMap(map)
		? Object.entries(map)
				.filter(([, version]) => !passes(version))
				.map(([name, version]) => `${file}: ${field}: ${name}: ${JSON.stringify(version)}`)
		: [];

const inPackage = (file: string, text: string): readonly string[] => {
	const manifest: unknown = JSON.parse(text);
	if (!isMap(manifest)) throw new Error("not an object");
	const {pnpm} = manifest;
	return [
		...[...FIELDS, ...OVERRIDES].flatMap((field) => refused(file, field, manifest[field])),
		...(isMap(pnpm) ? refused(file, "pnpm.overrides", pnpm["overrides"]) : []),
	];
};

const inWorkspace = (file: string, text: string): readonly string[] => {
	const workspace: unknown = parse(text);
	if (!isMap(workspace)) return [];
	const {catalog, catalogs, overrides} = workspace;
	return [
		...refused(file, "catalog", catalog),
		...(isMap(catalogs)
			? Object.entries(catalogs).flatMap(([name, map]) => refused(file, `catalogs.${name}`, map))
			: []),
		...refused(file, "overrides", overrides),
	];
};

const READERS: Readonly<Record<string, (file: string, text: string) => readonly string[]>> = {
	"package.json": inPackage,
	"pnpm-workspace.yaml": inWorkspace,
};

const root = process.argv[2] ?? join(import.meta.dirname, "..");
const tracked = spawnSync(
	"git",
	["ls-files", "-z", "--", ...Object.keys(READERS).flatMap((name) => [name, `**/${name}`])],
	{
		cwd: root,
		encoding: "utf8",
		maxBuffer: 2 ** 30,
	},
);
const files = tracked.stdout.split("\0").filter((file) => file !== "");
// No file read must never read as clean.
if (tracked.status !== 0 || files.length === 0) {
	console.error(`exact-versions: git found no files to check.\n${tracked.stderr}`);
	process.exit(2);
}

const check = (file: string): readonly string[] => {
	const read = READERS[basename(file)];
	if (read === undefined) throw new Error("no reader");
	return read(file, readFileSync(join(root, file), "utf8"));
};

/** What one file refuses, or the line saying it could not be read. */
const attempt = (file: string): {readonly lines: readonly string[]; readonly broken: boolean} => {
	try {
		return {lines: check(file), broken: false};
	} catch (error) {
		return {lines: [`${file}: could not read: ${String(error)}`], broken: true};
	}
};

const results = files.map(attempt);
const lines = results.flatMap((result) => result.lines);
for (const line of lines) console.error(line);
if (results.some((result) => result.broken)) process.exit(2);
if (lines.length > 0) {
	console.error(
		`exact-versions: ${lines.length} not exact. Write the version itself, or \`catalog:\` with the exact version in the catalog. See docs/direction/pin-exact-versions.md.`,
	);
	process.exit(1);
}
console.log(`exact-versions: ${files.length} files, every version exact`);
