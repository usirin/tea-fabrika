// `pnpm lint:dead`: code-graph's dead exports (0006), less those in today's frozen version (0525).
// The same findings `code-graph --ci` fails on: a dead export, one only tests call, and an unused
// export. No ledger is read or written (0524). Frozen code stays in the graph, so a live export
// that only frozen code uses still counts as used, which is true while that code runs.
import { spawnSync } from "node:child_process";
import { delimiter, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Exit, Schema } from "effect";
import { isFrozen } from "./frozen.mjs";

const ROOT = join(import.meta.dirname, "..");

const Finding = Schema.Struct({
  file: Schema.String,
  id: Schema.String,
  category: Schema.optionalKey(Schema.String),
});

/** What `code-graph --unreachable --json` prints, the two parts that hold findings. */
export const Report = Schema.Struct({
  unreachable: Schema.Array(Finding),
  unusedExports: Schema.Array(Finding),
});

/** The findings that block, every one in a live file, and how many frozen files' findings were left out. */
export const judge = (report: typeof Report.Type) => {
  const all = [...report.unreachable, ...report.unusedExports];
  return { blocks: all.filter((f) => !isFrozen(f.file)), frozen: all.filter((f) => isFrozen(f.file)).length };
};

const decode = Schema.decodeUnknownExit(Schema.fromJsonString(Report));

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  // The repo's own code-graph comes after PATH, so `pnpm lint:dead` and a plain `node` run find it.
  const ran = spawnSync("code-graph", [".", "--unreachable", "--json", "--node-kinds", "node-kinds.json"], {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 2 ** 30,
    env: { ...process.env, PATH: [process.env["PATH"], join(ROOT, "node_modules", ".bin")].join(delimiter) },
  });
  const report = ran.status === 0 ? decode(ran.stdout ?? "") : undefined;

  if (report === undefined || Exit.isFailure(report)) {
    // A run that did not finish, or JSON this cannot read, never reads as clean.
    console.error(`dead: code-graph did not report: status ${ran.status}\n${ran.stderr ?? ""}`);
    process.exit(2);
  }

  const { blocks, frozen } = judge(report.value);

  for (const finding of blocks) {
    console.log(`${finding.id} ${finding.category ?? "unused-export"}`);
  }

  console.log(`dead: ${blocks.length} blocking, ${frozen} in frozen files left out (0525)`);
  process.exit(blocks.length === 0 ? 0 : 1);
}
