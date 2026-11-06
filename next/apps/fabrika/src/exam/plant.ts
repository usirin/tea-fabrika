// Lints planted files the way `pnpm lint` does, for the exam's rule tests. The files go into a
// fresh folder that holds the repo's own `.oxlintrc.json` and its plugin folder, at the paths they are
// given (`next/packages/tuval/src/window/use-model.ts`), so the rules' own edge paths and the config's
// `next/**` globs meet them as they would meet the real file. Nothing is written inside the repo.
import {spawnSync} from "node:child_process";
import {
	copyFileSync,
	mkdirSync,
	mkdtempSync,
	realpathSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import {tmpdir} from "node:os";
import {dirname, join} from "node:path";
import {Schema} from "effect";

const ROOT = join(import.meta.dirname, "..", "..", "..", "..", "..");

/** One fire: the rule's code, as oxlint prints it (`fabrika(no-of)`), and where. */
interface Fire {
	readonly code: string;
	readonly file: string;
	readonly line: number;
}

const Report = Schema.Struct({
	number_of_files: Schema.Number,
	diagnostics: Schema.Array(
		Schema.Struct({
			code: Schema.optional(Schema.String),
			filename: Schema.String,
			labels: Schema.optional(
				Schema.Array(Schema.Struct({span: Schema.Struct({line: Schema.Number})})),
			),
		}),
	),
});
const readReport = Schema.decodeUnknownSync(Schema.fromJsonString(Report));

/**
 * Lints the planted files, keyed by path from the top of the repo, and answers the lines one rule
 * (`fabrika(no-of)`) fires on in one of them, in order.
 */
export const plant = (
	files: Readonly<Record<string, string>>,
): ((code: string, file: string) => readonly number[]) => {
	const fires = lint(files);
	return (code, file) =>
		fires
			.filter((f) => f.code === code && f.file === file)
			.map((f) => f.line)
			.sort((a, b) => a - b);
};

const lint = (files: Readonly<Record<string, string>>): readonly Fire[] => {
	// The real path: on a Mac the temp folder is behind a link, and oxlint matches globs on the real one.
	const at = realpathSync(mkdtempSync(join(tmpdir(), "exam-")));
	try {
		copyFileSync(join(ROOT, ".oxlintrc.json"), join(at, ".oxlintrc.json"));
		symlinkSync(join(ROOT, "oxlint-plugins"), join(at, "oxlint-plugins"));
		for (const [path, text] of Object.entries(files)) {
			mkdirSync(dirname(join(at, path)), {recursive: true});
			writeFileSync(join(at, path), text);
		}
		const ran = spawnSync(
			join(ROOT, "node_modules", ".bin", "oxlint"),
			[
				`--config=${join(at, ".oxlintrc.json")}`,
				"--disable-nested-config",
				"--no-ignore",
				"--format=json",
				...Object.keys(files),
			],
			{cwd: at, encoding: "utf8"},
		);
		const report = readReport(ran.stdout);
		if (report.number_of_files !== Object.keys(files).length) {
			throw new Error(`oxlint read ${report.number_of_files} files: ${ran.stderr}`);
		}
		return report.diagnostics.map((d) => ({
			code: d.code ?? "",
			file: d.filename,
			line: d.labels?.[0]?.span.line ?? 0,
		}));
	} finally {
		rmSync(at, {recursive: true, force: true});
	}
};
