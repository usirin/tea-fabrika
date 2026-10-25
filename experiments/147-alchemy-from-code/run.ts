// Experiment 147: Alchemy's `deploy` called from code, in one long-lived Node process, no CLI.
//
//   (cd experiments/147-alchemy-from-code && pnpm install --ignore-workspace)   # once
//   (cd experiments/146-alchemy-everywhere && pnpm install --ignore-workspace)  # host.ts lives there
//   env -u TYPESAFE_API_KEY nice -n 15 node experiments/147-alchemy-from-code/run.ts host
//   ... run.ts host-up, then run.ts host-down       # does a host outlive the process that deployed it?
//   ... run.ts dev                                  # the ledger server in workerd, no account at all
//   CLOUDFLARE_API_TOKEN=... CLOUDFLARE_ACCOUNT_ID=... run.ts live   # the same stack on Cloudflare
//   ... run.ts cli-live                             # the same stack through Alchemy's CLI
//   ... run.ts clean                                # list and delete anything named tf-exp-147-
//
// This file only sets the stage, then loads `parts.ts`, which holds the parts. Every run works in
// a fresh temp folder (`EXP_WORK`, or a new one under the OS temp folder): Alchemy's state goes to
// `<work>/.alchemy/`, and `ALCHEMY_HOME` and `FABRIKA_HOME` point inside it. The folder must be
// the working folder before Alchemy loads, because Alchemy reads the working folder once, at
// import (`initialCwd` in its src/Util/Node.ts); so Alchemy is loaded here with `import()`, after
// the `chdir`. `DO_NOT_TRACK=1` is set too, though nothing on this path loads Alchemy's telemetry
// (see the write-up).
import {mkdirSync, mkdtempSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
// First, so it sees every connection Alchemy opens.
import "./net-watch.ts";

const work = process.env.EXP_WORK ?? mkdtempSync(join(tmpdir(), "tf-exp-147-"));
mkdirSync(work, {recursive: true});
process.chdir(work);
process.env.EXP_WORK_DIR = work;
process.env.ALCHEMY_HOME = join(work, "alchemy-home");
process.env.FABRIKA_HOME = join(work, "fabrika-home");
process.env.DO_NOT_TRACK = "1";
delete process.env.TYPESAFE_API_KEY;

// Cold start: the module load a CLI run pays every time, paid here once.
const t = performance.now();
await Promise.all([import("alchemy"), import("@alchemy.run/cloudflare")]);
process.env.EXP_IMPORT_ALCHEMY_MS = String(Math.round(performance.now() - t));
await import("./parts.ts");
