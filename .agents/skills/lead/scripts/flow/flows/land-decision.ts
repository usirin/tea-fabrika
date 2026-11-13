// The flow that lands a docs-only decision pull request (AGENTS.md: merged on
// green CI with a clean leak grep, no plan, tests, review or field rows). Today's lead tooling
// (0064). The lead writes a three-line flow file per decision and runs it:
//
//   // BOXES/flows/adr-0065.ts, importing landDecision from this module by its path
//   export default landDecision({ ticket: "660", dir: "<worktree>", branch: "fabrikalfa/adr-0065",
//     paths: [".decisions/0065-x.md"], subject: "T660 lead: 0065, ...", title: "...", body: "..." });
//
// and runs that file with the flow runner and `--lead` (its usage is in the runner's header).
//
// Without `--lead` it formats, lints and reads governance, then parks on the lead sign with `ask`.

import * as Flow from "../Flow.ts";
import * as Step from "../Step.ts";

export type Decision = {
  readonly ticket: string;
  /** The worktree that holds the decision's branch. */
  readonly dir: string;
  readonly branch: string;
  /** The files the lead commit stages, by name. */
  readonly paths: readonly [string, ...ReadonlyArray<string>];
  /** The lead commit's subject, `T<ticket> lead: ...`. */
  readonly subject: string;
  readonly title: string;
  readonly body: string;
};

export const landDecision = (d: Decision): Flow.Flow =>
  Flow.make(`land-${d.branch.replace(/^fabrikalfa\//, "")}`, [
    Step.act("format", { dir: d.dir }),
    Step.check("lint", { dir: d.dir }),
    Step.gather("governance", { dir: d.dir }),
    Step.act("lead-commit", { dir: d.dir, ticket: d.ticket, subject: d.subject, paths: d.paths }, { lead: true }),
    Step.check("leak-grep", { dir: d.dir }),
    Step.act("bot-push", { dir: d.dir, branch: d.branch }),
    Step.act("open-pr", { dir: d.dir, branch: d.branch, title: d.title, body: d.body }),
    Step.listen("ci", { dir: d.dir, branch: d.branch }),
    Step.act("queue", { dir: d.dir, branch: d.branch }, { lead: true }),
  ]);
