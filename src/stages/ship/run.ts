// The ship machine, run alone on one pull request. It only reads.
//
//   node src/stages/ship/run.ts <pull request url> --own <account>[,<account>] [--reviewers <account>[,<account>]]
//
// It prints, as JSON: the facts read from GitHub, what the machine answers,
// and, when the gate says go, the enqueue it would send. It sends nothing.
// There is no flag that turns writing on.
//
// `--own` names the accounts the repo treats as its own: who may open a pull
// request this machine lands. `--reviewers` names the accounts whose review
// verdicts count; left out, they are the same accounts.
import { Effect } from "effect";
import { gitHubCodeHost, NOT_READ, prOf } from "../../code-host-github.ts";
import { look } from "./look.ts";

const [url, ...flags] = process.argv.slice(2);
/** The accounts after a flag, or none. */
function accounts(flag: string): readonly string[] {
  const at = flags.indexOf(flag);
  return at === -1 ? [] : (flags[at + 1] ?? "").split(",").filter((login) => login !== "");
}
const own = accounts("--own");
const reviewers = accounts("--reviewers");
if (url === undefined || prOf(url) === null || own.length === 0) {
  console.error("usage: node src/stages/ship/run.ts <pull request url> --own <account>[,<account>] [--reviewers <account>[,<account>]]");
  process.exit(1);
}

const host = gitHubCodeHost({ own, reviewers: reviewers.length === 0 ? own : reviewers });
const found = await Effect.runPromise(look(url).pipe(Effect.provide(host)));
const next =
  found.wouldSend !== null
    ? "would enqueue: not sent, this script only reads"
    : found.facts === null
      ? "nothing: the pull request could not be read"
      : "nothing: the machine stops here with this outcome";
console.log(JSON.stringify({ ...found, next, notRead: NOT_READ }, null, 2));
