// The ship machine, run alone on one pull request. It only reads.
//
//   node src/stages/ship/run.ts <pull request url> --own <account>[,<account>]
//
// It prints, as JSON: the facts read from GitHub, what the machine answers,
// and, when the gate says go, the enqueue it would send. It sends nothing.
// There is no flag that turns writing on.
//
// `--own` names the accounts the repo treats as its own: who may open a pull
// request this machine lands, and whose review verdicts count.
import { Effect } from "effect";
import { gitHubCodeHost, NOT_READ, prOf } from "../../code-host-github.ts";
import { look } from "./look.ts";

const [url, flag, accounts] = process.argv.slice(2);
const own = (accounts ?? "").split(",").filter((login) => login !== "");
if (url === undefined || prOf(url) === null || flag !== "--own" || own.length === 0) {
  console.error("usage: node src/stages/ship/run.ts <pull request url> --own <account>[,<account>]");
  process.exit(1);
}

const found = await Effect.runPromise(look(url).pipe(Effect.provide(gitHubCodeHost({ own }))));
const next =
  found.wouldSend !== null
    ? "would enqueue: not sent, this script only reads"
    : found.facts === null
      ? "nothing: the pull request could not be read"
      : "nothing: the machine stops here with this outcome";
console.log(JSON.stringify({ ...found, next, notRead: NOT_READ }, null, 2));
