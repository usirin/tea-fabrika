// Today's field records. Compare exact occurrences, never revalidate old rows.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { readPaths, validSha } from "./changes.mjs";
import { checkRow, Finding } from "./field-schema.ts";

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

export const checkFile = (file: string, base: string, head: string) => {
  const added = selectAdded(base, head);
  const counts = new Map<string, number>();
  const id = file === "field/notes.jsonl" ? "id" : "run";

  for (const text of lines(head)) {
    const value = parse(text);

    if (typeof value === "object" && value !== null && id in value) {
      const key: unknown = Reflect.get(value, id);

      if (typeof key === "string") {
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
    }
  }

  const findings = added.flatMap(({ line, text }) => {
    const value = parse(text);
    const found =
      value === undefined
        ? [Finding.cases.error.make({ file, line, field: "row", reason: "invalid JSON" })]
        : checkRow(file, line, value);

    if (typeof value === "object" && value !== null && id in value) {
      const key: unknown = Reflect.get(value, id);

      if (typeof key === "string" && (counts.get(key) ?? 0) > 1) {
        found.push(Finding.cases.warning.make({ file, line, field: id, reason: "repeated record id" }));
      }
    }

    return found;
  });
  return {
    findings,
    annotations: findings.map(annotation),
    exitCode: findings.some((f) => f._tag === "error") ? 1 : 0,
    added: added.length,
  };
};

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
  return paths
    .filter((path) => /^field\/[^/]+\.jsonl$/.test(path))
    .map((file) => ({
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
