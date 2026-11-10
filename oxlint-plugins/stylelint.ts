// Today's CSS check always uses the root config and tracked files, ignoring nested settings.
import {spawnSync} from "node:child_process";
import {readFile} from "node:fs/promises";
import {devNull} from "node:os";
import {join, relative} from "node:path";
import stylelint from "stylelint";
import type {CssResult} from "./css-support.ts";

const ROOT = process.cwd();
const configFile = join(ROOT, "stylelint.config.ts");

const tracked = spawnSync("git", ["ls-files", "-z", "--", "apps", "packages", "programs", "next"], {
	cwd: ROOT,
	encoding: "utf8",
	maxBuffer: 2 ** 30,
});

if (tracked.status !== 0) {
	console.error(`stylelint could not list tracked CSS: ${tracked.stderr}`);
	process.exit(2);
}

const files = tracked.stdout.split("\0").filter((path) => path.endsWith(".css"));

if (files.length === 0) {
	console.error("stylelint: no tracked CSS files");
	process.exit(2);
}

try {
	// `code` avoids glob expansion; the empty ignore file prevents .stylelintignore taking effect.
	const config = await stylelint.resolveConfig(join(ROOT, files[0] ?? ""), {configFile});
	if (config === undefined) throw new Error("No stylelint config");
	const counts = new Map<string, {fires: number; known: Set<string>}>();
	for (const rule of Object.keys(config.rules ?? {})) {
		if (rule.startsWith("fabrika/")) counts.set(rule, {fires: 0, known: new Set()});
	}
	let blocks = 0;
	for (const file of files) {
		const report = await stylelint.lint({
			code: await readFile(join(ROOT, file), "utf8"),
			codeFilename: join(ROOT, file),
			configFile,
			ignorePath: devNull,
			ignoreDisables: false,
		});
		if (report.results.length !== 1) throw new Error(`No stylelint result for ${file}`);
		for (const result of report.results) {
			for (const warning of [
				...result.warnings,
				...result.parseErrors,
				...result.invalidOptionWarnings,
			]) {
				const line = "line" in warning ? warning.line : 1;
				const column = "column" in warning ? warning.column : 1;
				const rule = "rule" in warning ? warning.rule : "stylelint";
				console.error(`${file}:${line}:${column} ${rule} ${warning.text}`);
				blocks++;
			}
			const postcss: CssResult | undefined = result._postcssResult;
			for (const [rule, hits] of postcss?.fabrika ?? []) {
				const total = counts.get(rule);
				if (total === undefined) throw new Error(`Unconfigured CSS rule ${rule}`);
				total.fires += hits.fires;
				for (const entry of hits.known) total.known.add(entry);
			}
		}
		if (
			report.errored &&
			report.results.every(
				(result) =>
					result.warnings.length === 0 &&
					result.parseErrors.length === 0 &&
					result.invalidOptionWarnings.length === 0,
			)
		) {
			console.error(`${file}: stylelint failed without a diagnostic`);
			blocks++;
		}
	}
	for (const [rule, hits] of counts) {
		const setting = config.rules?.[rule];
		const known: unknown = Array.isArray(setting) ? setting[1]?.known : undefined;
		if (!Array.isArray(known)) throw new Error(`${rule} needs its known list`);
		for (const entry of known) {
			if (!hits.known.has(entry)) {
				console.error(`${rule}: stale known entry ${entry}`);
				blocks++;
			}
		}
		console.log(`${rule}: ${hits.fires} fires, ${hits.known.size} known entries`);
	}
	console.log(`stylelint: ${files.length} files, ${blocks} blocking`);
	process.exitCode = blocks === 0 ? 0 : 1;
} catch (error) {
	console.error(`stylelint did not finish in ${relative(ROOT, configFile)}: ${String(error)}`);
	process.exitCode = 2;
}
