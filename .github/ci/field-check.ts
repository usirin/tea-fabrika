// Today's field records. Compare exact occurrences, never revalidate old rows. Since decision
// 0090 a new row is its own file, and the three old .jsonl files take no new line.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { readPaths, validSha } from "./changes.mjs";
import { checkRow, Finding, inFolder, type Log, logOf, rowName } from "./field-schema.ts";

const lines = (text: string): string[] =>
  text === "" ? [] : (text.endsWith("\n") ? text.slice(0, -1) : text).split("\n");

export const selectAdded = (base: string, head: string): { line: number; text: string }[] => {
  const counts = new Map<string, number>();

  for (const text of lines(base)) {
    counts.set(text, (counts.get(text) ?? 0) + 1);
  }

  return lines(head).flatMap((text, i) => {
    const count = counts.get(text) ?? 0;

    if (count === 0) {
      return [{ line: i + 1, text }];
    }

    counts.set(text, count - 1);
    return [];
  });
};

const parse = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
};

// GitHub annotation escaping applies to property values as well as message text.
const escape = (text: string) =>
  text
    .replaceAll("%", "%25")
    .replaceAll("\r", "%0D")
    .replaceAll("\n", "%0A")
    .replaceAll(":", "%3A")
    .replaceAll(",", "%2C");

const annotation = (finding: Finding) =>
  `::${finding._tag} file=${escape(finding.file)},line=${finding.line}::${escape(finding.field)}: ${escape(finding.reason)}`;

type Report = { findings: Finding[]; annotations: string[]; exitCode: 0 | 1; added: number };

const report = (findings: Finding[], added: number): Report => ({
  findings,
  annotations: findings.map(annotation),
  exitCode: findings.some((f) => f._tag === "error") ? 1 : 0,
  added,
});

/**
 * An old `.jsonl` file. The three logs are history (decision 0090): a line added to one fails, and
 * names the folder its row belongs in. An unknown direct `.jsonl` file keeps today's line checks.
 */
const checkLines = (file: string, base: string, head: string): Report => {
  const added = selectAdded(base, head);
  const log = logOf(file);
  const findings = added.flatMap(({ line, text }) => {
    if (log !== null) {
      return [
        Finding.cases.error.make({
          file,
          line,
          field: "row",
          reason: `this log is history: write the row as its own file, field/${log}/<date>-<slug>.json (decision 0090)`,
        }),
      ];
    }

    const value = parse(text);
    return value === undefined
      ? [Finding.cases.error.make({ file, line, field: "row", reason: "invalid JSON" })]
      : checkRow(file, line, value);
  });
  return report(findings, added.length);
};

/** The key that holds a row's own id, which must be its file name: none on a rating. */
const idKey = (log: Log | null, row: Record<string, unknown>) =>
  log === "runs" ? "run" : log === "notes" || row["_tag"] === "finding" ? "id" : null;

/**
 * One row file in a log's folder (decision 0090). An added file is one JSON object, checked by
 * the same rules as an added line, and its id is its file name. A row file is never edited or
 * deleted: a correction is a new row.
 */
const checkRowFile = (file: string, base: string, head: string): Report => {
  const error = (field: string, reason: string) => Finding.cases.error.make({ file, line: 1, field, reason });
  const name = rowName.exec(file)?.[1];
  const findings: Finding[] = [];

  if (name === undefined) {
    findings.push(
      error("file", "a row file is field/<log>/<YYYY-MM-DD>-<slug>.json, the slug lowercase and kebab-case"),
    );
  }

  if (base !== "") {
    findings.push(error("row", head === "" ? "a row file is never deleted" : "a row file is never edited"));
    return report(findings, 0);
  }

  const value = parse(head);

  if (value === undefined) {
    findings.push(error("row", "invalid JSON"));
    return report(findings, 1);
  }

  findings.push(...checkRow(file, 1, value));
  const row: Record<string, unknown> = typeof value === "object" && value !== null ? { ...value } : {};
  const key = idKey(logOf(file), row);

  if (name !== undefined && key !== null && row[key] !== name) {
    findings.push(error(key, "the row's id is its file name without .json"));
  }

  const day = row["date"];

  if (name !== undefined && typeof day === "string" && !name.startsWith(`${day}-`)) {
    findings.push(
      Finding.cases.warning.make({ file, line: 1, field: "date", reason: "differs from the file name's date" }),
    );
  }

  return report(findings, 1);
};

export const checkFile = (file: string, base: string, head: string): Report =>
  inFolder(file) ? checkRowFile(file, base, head) : checkLines(file, base, head);

/** The paths the field job reads: a direct `.jsonl` file, or anything in a log's folder. */
export const isFieldPath = (path: string) => /^field\/[^/]+\.jsonl$/.test(path) || inFolder(path);

type Runner = (args: string[]) => { status: number | null; stdout: string };
const git: Runner = (args) => spawnSync("git", args, { encoding: "utf8", maxBuffer: 2 ** 28 });

/**
 * A missing tree or unreadable blob is an error, never an empty successful delta.
 * A PR's rows start at the merge base, as changes.mjs reads its paths; a push uses its two trees.
 */
export const readFieldFiles = (base: string, head: string, event: string, run: Runner = git) => {
  if (!validSha(base) || !validSha(head)) {
    throw new Error("field: valid base and head SHAs are required");
  }

  const read = (args: string[]) => {
    const result = run(args);

    if (result.status !== 0) {
      throw new Error("field: Git could not read the requested history");
    }

    return result.stdout;
  };
  const from = event === "pull_request" ? read(["merge-base", base, head]).trim() : base;

  if (!validSha(from)) {
    throw new Error("field: the merge base could not be read");
  }

  const paths = readPaths(from, head, "push", run);

  if (paths === null) {
    throw new Error("field: changed paths could not be read");
  }

  const tree = (ref: string) => new Set(read(["ls-tree", "-r", "--name-only", "-z", ref, "--", "field/"]).split("\0"));
  const before = tree(from),
    after = tree(head);
  return paths.filter(isFieldPath).map((file) => ({
    file,
    base: before.has(file) ? read(["show", `${from}:${file}`]) : "",
    head: after.has(file) ? read(["show", `${head}:${file}`]) : "",
  }));
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const base = process.env["BASE"] ?? "";
    const head = process.env["HEAD"] ?? "";
    const event = process.env["EVENT"] ?? "";
    let total = 0;

    for (const input of readFieldFiles(base, head, event)) {
      const report = checkFile(input.file, input.base, input.head);
      total += report.added;

      for (const message of report.annotations) {
        console.log(message);
      }

      if (report.exitCode !== 0) {
        process.exitCode = report.exitCode;
      }
    }

    console.log(`field: ${total} added rows checked`);
  } catch {
    console.error("field: history or input could not be read; validation did not finish");
    process.exitCode = 2;
  }
}
