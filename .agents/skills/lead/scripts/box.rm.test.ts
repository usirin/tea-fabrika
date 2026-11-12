// box rm's laws, on memory (every generated plan) and on real git and keepruns.sh (a small sample
// and every vector), so the memory world stays honest. The laws live in box/BoxTest.ts.
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "./mutbox.ts?raw";
import "./mutbox-entry.sh?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "./mutbox.Dockerfile?raw";
import "../../mutation/scripts/run.sh?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "../../mutation/scripts/limit.ts?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "../../mutation/scripts/sample.ts?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "../../mutation/scripts/scope.ts?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "./box.sh?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "./box.ts?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "./box/BoxGit.ts?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "./box/BoxGitProcess.ts?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "./box/Remove.ts?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "./box/Runs.ts?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "./box/RunsProcess.ts?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "./boxfiles.ts?raw";
import "./keepruns.sh?raw";
import "./leakgrep.sh?raw";
import "./catchup.sh?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "./freshmain.ts?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "./drive.ts?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "./runid.ts?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "./pgrep.ts?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "./agents.ts?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "./codexexec.ts?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "./boxnode.ts?raw";
import "./fieldrow.py?raw";
import "./runplan.sh?raw";
import "./env.sh?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "./gc.ts?raw";
import "./redact.sh?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "./botpush.mjs?raw";
import "./clauderow.py?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "./lane.ts?raw";
import "../../plan/scripts/plancheck.sh?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "./sizecap.ts?raw";
import "../../step-commit/scripts/exam.py?raw";
import "../../step-commit/scripts/stepcommit.sh?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "./gcloop.ts?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "./flow/Beat.ts?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "./box/BoxGitTest.ts?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "./box/RunsTest.ts?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "./pr/Publish.ts?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "./pr/PullRequestsGh.ts?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "./pr/PushesProcess.ts?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "./publish.ts?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "./pr/PullRequests.ts?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "./pr/Pushes.ts?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "./pr/command.ts?raw";
import { NodeServices } from "@effect/platform-node";
import { Effect } from "effect";
import * as BoxTest from "./box/BoxTest.ts";
import * as BoxTestGit from "./box/BoxTestGit.ts";

const run: BoxTest.Run = (law) =>
  // oxlint-disable-next-line fabrika/no-effect-run-outside-edge -- edge: Vitest awaits the Promise a test hands back
  Effect.runPromise(law.pipe(Effect.scoped, Effect.provide(NodeServices.layer)));

BoxTest.rm.suite("memory", BoxTest.memory, run, { numRuns: 300, seed: 119120 });
BoxTest.rm.suite("git", BoxTestGit.world, run, { numRuns: 12, seed: 119120 });
