import { readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { BaseSequencer, createVitest } from "vitest/node";
import { nextFiles } from "./.github/ci/shard-rows.ts";
import { inLaneStep } from "./.github/ci/workflow-lint.ts";
import { assign, measured, Shards, wall, WORKERS, restLoads } from "./vitest.shards.ts";

it("vector: L5 known next timings use the larger of the two completed main runs", () => {
  // Today's CI. Unordered sample pairs from T890's approved plan for attempt 1 of main runs
  // 43329697311 and 43334183021. Until the third run, use the larger.
  // The complete observations and job IDs are in nextSamples below.
  // Lead runs it: add the third green main run and use the three-run medians.
  for (const [path, samples] of [
    ["next/packages/libfabrika/src/node/StartChild.test.ts", [484.6, 590.5]],
    ["next/apps/fabrika/src/chaos.laws.test.ts", [365.1, 382.8]],
    ["next/packages/libfabrika/src/node/Replies.test.ts", [152.3, 177.7]],
    ["next/apps/fabrika/src/start-child.laws.test.ts", [130.2, 177.2]],
    ["next/apps/fabrika/src/instance-wire.test.ts", [147.5, 186.2]],
    ["next/apps/fabrika/src/door.test.ts", [127.4, 143.6]],
    ["next/apps/fabrika/src/runtime-recovery.laws.test.ts", [92.7, 99.8]],
  ] as const) {
    expect.soft(measured[path], path).toBe(Math.max(...samples));
  }
});

it("scenario: L6 the six measured heaviest next files occupy six machines with bounded loads", () => {
  // Today's CI: the real file set and the heaviest six from the plan's two green main runs.
  // Keep these names independent of the table so an accidentally tiny row cannot hide the file.
  const heaviest = [
    "next/packages/libfabrika/src/node/StartChild.test.ts",
    "next/apps/fabrika/src/chaos.laws.test.ts",
    "next/packages/libfabrika/src/node/ProgramMailRuntime.test.ts",
    "next/apps/fabrika/src/instance-wire.test.ts",
    "next/packages/libfabrika/src/node/Replies.test.ts",
    "next/apps/fabrika/src/start-child.laws.test.ts",
  ];
  const files = nextFiles(import.meta.dirname).map((path) => ({ path, seconds: measured[path] ?? 1 }));
  const placed = assign(files, 6);
  expect(new Set(heaviest.map((path) => placed[files.findIndex((file) => file.path === path)]))).toHaveLength(6);
  const loads = Array.from({ length: 6 }, (_, machine) =>
    files.reduce((sum, file, index) => sum + (placed[index] === machine ? file.seconds : 0), 0),
  );
  const mean = loads.reduce((sum, load) => sum + load, 0) / 6;
  expect(Math.max(...loads)).toBeLessThanOrEqual(mean + Math.max(...files.map((file) => file.seconds)));
});

// Today's CI, next/. Attempt 1 of main runs 43329697311 and 43334183021, in that order.
// Recorded observations: the per-file samples and job IDs preserved in build commit f641f318.
// This fixed snapshot copies those observations, never the measured table's computed weights.
// The box cannot fetch the original logs. Lead runs it: verify the samples against those logs,
// add the third green main run's samples and job IDs, then use the three-run medians.
const nextSamples = {
  // Jobs 131571231226, 131586276292.
  "next/apps/fabrika/src/brain-life.test.ts": [39.1, 31.3],
  // Jobs 131571231492, 131586276245.
  "next/apps/fabrika/src/build-command.test.ts": [1.4, 1.4],
  // Jobs 131571231356, 131586276350.
  "next/apps/fabrika/src/build.test.ts": [38.0, 48.9],
  // Jobs 131571231356, 131586276350.
  "next/apps/fabrika/src/chaos.laws.test.ts": [365.1, 382.8],
  // Jobs 131571231226, 131586276292.
  "next/apps/fabrika/src/checklist-runner.laws.test.ts": [24.3, 30.4],
  // Jobs 131571231492, 131586276245.
  "next/apps/fabrika/src/door-recovery.test.ts": [17.6, 16.9],
  // Jobs 131571231492, 131586276245.
  "next/apps/fabrika/src/door-spans.test.ts": [2.3, 2.1],
  // Jobs 131571231492, 131586276245.
  "next/apps/fabrika/src/door.test.ts": [143.6, 127.4],
  // Jobs 131571231395, 131586276297.
  "next/apps/fabrika/src/error-cause.test.ts": [0.1, 0.1],
  // Jobs 131571231492, 131586276245.
  "next/apps/fabrika/src/exam/agent-may.test.ts": [2.9, 2.6],
  // Jobs 131571231706, 131586276341.
  "next/apps/fabrika/src/exam/agents.test.ts": [9.6, 5.1],
  // Jobs 131571231492, 131586276245.
  "next/apps/fabrika/src/exam/alchemy-lifecycle.test.ts": [10.9, 10.9],
  // Jobs 131571231356, 131586276350.
  "next/apps/fabrika/src/exam/bytes.test.ts": [6.3, 9.2],
  // Jobs 131571231356, 131586276350.
  "next/apps/fabrika/src/exam/client-manager-contract.test.ts": [9.9, 13.3],
  // Jobs 131571231395, 131586276297.
  "next/apps/fabrika/src/exam/clock.test.ts": [0.0, 0.0],
  // Jobs 131571231706, 131586276341.
  "next/apps/fabrika/src/exam/commits-git-chain.test.ts": [70.6, 47.2],
  // Jobs 131571231226, 131586276292.
  "next/apps/fabrika/src/exam/commits-git-person.test.ts": [84.5, 58.5],
  // Jobs 131571231706, 131586276341.
  "next/apps/fabrika/src/exam/commits-git-signatures.test.ts": [84.9, 55.4],
  // Jobs 131571231226, 131586276292.
  "next/apps/fabrika/src/exam/commits-git-steps.test.ts": [129.9, 92.1],
  // Jobs 131571231356, 131586276350.
  "next/apps/fabrika/src/exam/commits.test.ts": [0.7, 1.6],
  // Jobs 131571231395, 131586276297.
  "next/apps/fabrika/src/exam/compiler.test.ts": [0.0, 0.0],
  // Jobs 131571231706, 131586276341.
  "next/apps/fabrika/src/exam/deps.test.ts": [5.5, 4.4],
  // Jobs 131571231395, 131586276297.
  "next/apps/fabrika/src/exam/edge-comment.test.ts": [0.0, 0.0],
  // Jobs 131571231395, 131586276297.
  "next/apps/fabrika/src/exam/edges.test.ts": [4.1, 4.1],
  // Jobs 131571231395, 131586276297.
  "next/apps/fabrika/src/exam/effect-functions.test.ts": [0.0, 0.1],
  // Jobs 131571231226, 131586276292.
  "next/apps/fabrika/src/exam/highlight.test.ts": [1.4, 0.8],
  // Jobs 131571231395, 131586276297.
  "next/apps/fabrika/src/exam/laws-scan.test.ts": [0.0, 0.0],
  // Jobs 131571231395, 131586276297.
  "next/apps/fabrika/src/exam/layers.test.ts": [4.7, 5.0],
  // Jobs 131571231395, 131586276297.
  "next/apps/fabrika/src/exam/ledger-sql.test.ts": [8.0, 8.0],
  // Jobs 131571231395, 131586276297.
  "next/apps/fabrika/src/exam/markdown.test.tsx": [36.1, 34.9],
  // Jobs 131571231395, 131586276297.
  "next/apps/fabrika/src/exam/no-effect-run-outside-edge.test.ts": [0.0, 0.0],
  // Jobs 131571231395, 131586276297.
  "next/apps/fabrika/src/exam/no-hand-tag.test.ts": [0.0, 0.0],
  // Jobs 131571231395, 131586276297.
  "next/apps/fabrika/src/exam/no-of.test.ts": [0.0, 0.0],
  // Jobs 131571231395, 131586276297.
  "next/apps/fabrika/src/exam/no-promises.test.ts": [46.3, 45.8],
  // Jobs 131571231492, 131586276245.
  "next/apps/fabrika/src/exam/notes-contract.test.ts": [49.5, 45.3],
  // Jobs 131571231706, 131586276341.
  "next/apps/fabrika/src/exam/notes-fixture.test.ts": [0.1, 0.1],
  // Jobs 131571231356, 131586276350.
  "next/apps/fabrika/src/exam/notes.laws.test.ts": [3.9, 6.2],
  // Jobs 131571231226, 131586276292.
  "next/apps/fabrika/src/exam/object-imports.test.ts": [2.3, 1.6],
  // Jobs 131571231356, 131586276350.
  "next/apps/fabrika/src/exam/one-store-hook.test.ts": [0.3, 0.4],
  // Jobs 131571231395, 131586276297.
  "next/apps/fabrika/src/exam/react-rules.test.ts": [0.0, 0.0],
  // Jobs 131571231356, 131586276350.
  "next/apps/fabrika/src/exam/secret-types.test.ts": [3.6, 6.4],
  // Jobs 131571231492, 131586276245.
  "next/apps/fabrika/src/exam/twin.test.ts": [18.0, 16.8],
  // Jobs 131571231226, 131586276292.
  "next/apps/fabrika/src/file-services.laws.test.ts": [3.0, 2.0],
  // Jobs 131571231706, 131586276341.
  "next/apps/fabrika/src/grant-readers.laws.test.ts": [1.3, 0.9],
  // Jobs 131571231395, 131586276297.
  "next/apps/fabrika/src/instance-one-file.test.ts": [31.5, 28.4],
  // Jobs 131571231706, 131586276341.
  "next/apps/fabrika/src/instance-records.test.ts": [49.0, 40.1],
  // Jobs 131571231492, 131586276245.
  "next/apps/fabrika/src/instance-watch.laws.test.ts": [0.4, 0.4],
  // Jobs 131571231356, 131586276350.
  "next/apps/fabrika/src/instance-wire.test.ts": [147.5, 186.2],
  // Jobs 131571231492, 131586276245.
  "next/apps/fabrika/src/local-instance.test.ts": [1.0, 0.8],
  // Jobs 131571231706, 131586276341.
  "next/apps/fabrika/src/port.test.ts": [0.0, 0.0],
  // Jobs 131571231356, 131586276350.
  "next/apps/fabrika/src/record.laws.test.ts": [2.7, 2.8],
  // Jobs 131571231226, 131586276292.
  "next/apps/fabrika/src/runtime-recovery.laws.test.ts": [99.8, 92.7],
  // Jobs 131571231226, 131586276292.
  "next/apps/fabrika/src/runtime.decode.test.ts": [0.1, 0.1],
  // Jobs 131571231226, 131586276292.
  "next/apps/fabrika/src/runtime.laws.test.ts": [44.6, 49.3],
  // Jobs 131571231395, 131586276297.
  "next/apps/fabrika/src/settings-generated.test.ts": [4.2, 4.2],
  // Jobs 131571231492, 131586276245.
  "next/apps/fabrika/src/settings-start.test.ts": [10.5, 9.6],
  // Jobs 131571231395, 131586276297.
  "next/apps/fabrika/src/settings.test.ts": [0.0, 0.0],
  // Jobs 131571231706, 131586276341.
  "next/apps/fabrika/src/sibling.laws.test.ts": [13.5, 8.5],
  // Jobs 131571231356, 131586276350.
  "next/apps/fabrika/src/start-child.laws.test.ts": [130.2, 177.2],
  // Jobs 131571231706, 131586276341.
  "next/apps/fabrika/src/worker-mail.test.ts": [30.5, 19.1],
  // Jobs 131571231226, 131586276292.
  "next/apps/fabrika/src/worker-supervision.test.ts": [23.3, 22.4],
  // Jobs 131571231395, 131586276297.
  "next/apps/fabrika/src/worker-usage.test.ts": [1.6, 1.4],
  // Jobs 131571231492, 131586276245.
  "next/packages/libfabrika/src/Id.cause.test.ts": [0.1, 0.1],
  // Jobs 131571231356, 131586276350.
  "next/packages/libfabrika/src/Id.test.ts": [3.4, 7.3],
  // Jobs 131571231395, 131586276297.
  "next/packages/libfabrika/src/Id.types.test.ts": [0.0, 0.0],
  // Jobs 131571231395, 131586276297.
  "next/packages/libfabrika/src/Testing.test.ts": [0.0, 0.1],
  // Jobs 131571231356, 131586276350.
  "next/packages/libfabrika/src/access/Access.test.ts": [1.8, 3.4],
  // Jobs 131571231706, 131586276341.
  "next/packages/libfabrika/src/access/AccessMachine.laws.test.ts": [2.8, 1.6],
  // Jobs 131571231226, 131586276292.
  "next/packages/libfabrika/src/access/AccessSpans.test.ts": [4.5, 4.0],
  // Jobs 131571231706, 131586276341.
  "next/packages/libfabrika/src/access/Authorization.test.ts": [13.0, 16.1],
  // Jobs 131571231356, 131586276350.
  "next/packages/libfabrika/src/access/ClientManager.test.ts": [14.0, 16.2],
  // Jobs 131571231356, 131586276350.
  "next/packages/libfabrika/src/access/ClientManager.types.test.ts": [0.0, 0.0],
  // Jobs 131571231395, 131586276297.
  "next/packages/libfabrika/src/access/Passkey.test.ts": [0.1, 0.1],
  // Jobs 131571231706, 131586276341.
  "next/packages/libfabrika/src/access/SessionManager.test.ts": [7.5, 10.5],
  // Jobs 131571231395, 131586276297.
  "next/packages/libfabrika/src/access/Text.test.ts": [0.0, 0.0],
  // Jobs 131571231226, 131586276292.
  "next/packages/libfabrika/src/ci/Ci.test.ts": [0.4, 0.2],
  // Jobs 131571231395, 131586276297.
  "next/packages/libfabrika/src/cloudflare/alarm.laws.test.ts": [0.7, 0.7],
  // Jobs 131571231492, 131586276245.
  "next/packages/libfabrika/src/cloudflare/connection.test.ts": [8.2, 6.8],
  // Jobs 131571231706, 131586276341.
  "next/packages/libfabrika/src/cloudflare/error-cause.test.ts": [0.4, 0.2],
  // Jobs 131571231706, 131586276341.
  "next/packages/libfabrika/src/cloudflare/fetch.test.ts": [0.6, 0.4],
  // Jobs 131571231395, 131586276297.
  "next/packages/libfabrika/src/cloudflare/index.test.ts": [0.3, 0.2],
  // Jobs 131571231356, 131586276350.
  "next/packages/libfabrika/src/cloudflare/mail.test.ts": [0.5, 0.6],
  // Jobs 131571231226, 131586276292.
  "next/packages/libfabrika/src/cloudflare/p14.test.ts": [0.5, 0.3],
  // Jobs 131571231395, 131586276297.
  "next/packages/libfabrika/src/cloudflare/platform.test.ts": [0.3, 0.2],
  // Jobs 131571231492, 131586276245.
  "next/packages/libfabrika/src/cloudflare/reach.laws.test.ts": [0.2, 0.2],
  // Jobs 131571231226, 131586276292.
  "next/packages/libfabrika/src/cloudflare/readers.laws.test.ts": [0.8, 0.6],
  // Jobs 131571231226, 131586276292.
  "next/packages/libfabrika/src/cloudflare/runner-reply.laws.test.ts": [12.0, 7.8],
  // Jobs 131571231706, 131586276341.
  "next/packages/libfabrika/src/cloudflare/supervision.laws.test.ts": [30.7, 16.8],
  // Jobs 131571231706, 131586276341.
  "next/packages/libfabrika/src/cloudflare/tail.test.ts": [0.3, 0.2],
  // Jobs 131571231356, 131586276350.
  "next/packages/libfabrika/src/codehost/CodeHost.test.ts": [0.4, 0.6],
  // Jobs 131571231356, 131586276350.
  "next/packages/libfabrika/src/gateway/GatewayRevocation.test.ts": [41.9, 43.3],
  // Jobs 131571231226, 131586276292.
  "next/packages/libfabrika/src/gateway/internal/rateLimit.test.ts": [0.2, 0.2],
  // Jobs 131571231395, 131586276297.
  "next/packages/libfabrika/src/gateway/internal/waiting.test.ts": [4.5, 4.0],
  // Jobs 131571231395, 131586276297.
  "next/packages/libfabrika/src/jobs/Job.test.ts": [14.1, 14.0],
  // Jobs 131571231492, 131586276245.
  "next/packages/libfabrika/src/jobs/Jobs.types.test.ts": [0.0, 0.0],
  // Jobs 131571231706, 131586276341.
  "next/packages/libfabrika/src/jobs/internal/job.test.ts": [37.4, 20.9],
  // Jobs 131571231706, 131586276341.
  "next/packages/libfabrika/src/ledger/Ledger.test.ts": [1.8, 2.1],
  // Jobs 131571231356, 131586276350.
  "next/packages/libfabrika/src/ledger/Ledger.types.test.ts": [0.0, 0.0],
  // Jobs 131571231395, 131586276297.
  "next/packages/libfabrika/src/ledger/LedgerCallSpans.test.ts": [0.8, 0.8],
  // Jobs 131571231356, 131586276350.
  "next/packages/libfabrika/src/ledger/LedgerSpans.test.ts": [1.4, 2.0],
  // Jobs 131571231356, 131586276350.
  "next/packages/libfabrika/src/ledger/LedgerTransaction.test.ts": [0.3, 0.6],
  // Jobs 131571231395, 131586276297.
  "next/packages/libfabrika/src/ledger/Log.test.ts": [1.8, 1.9],
  // Jobs 131571231356, 131586276350.
  "next/packages/libfabrika/src/ledger/Rings.test.ts": [0.1, 0.2],
  // Jobs 131571231492, 131586276245.
  "next/packages/libfabrika/src/ledger/TraceId.test.ts": [0.6, 0.5],
  // Jobs 131571231226, 131586276292.
  "next/packages/libfabrika/src/node/Chaos.laws.test.ts": [0.1, 0.1],
  // Jobs 131571231395, 131586276297.
  "next/packages/libfabrika/src/node/Children.test.ts": [93.0, 89.3],
  // Jobs 131571231492, 131586276245.
  "next/packages/libfabrika/src/node/ErrorCause.test.ts": [2.1, 1.9],
  // Jobs 131571231706, 131586276341.
  "next/packages/libfabrika/src/node/ErrorCause.types.test.ts": [0.0, 0.0],
  // Jobs 131571231356, 131586276350.
  "next/packages/libfabrika/src/node/ExitReason.test.ts": [48.1, 58.9],
  // Jobs 131571231226, 131586276292.
  "next/packages/libfabrika/src/node/IsolateUsage.test.ts": [77.5, 78.2],
  // Jobs 131571231395, 131586276297.
  "next/packages/libfabrika/src/node/Nemesis.laws.test.ts": [10.5, 11.2],
  // Jobs 131571231395, 131586276297.
  "next/packages/libfabrika/src/node/ProgramMail.test.ts": [35.0, 33.9],
  // Jobs 131571231360, 131586276373.
  "next/packages/libfabrika/src/node/ProgramMailRuntime.test.ts": [282.2, 171.0],
  // Jobs 131571231395, 131586276297.
  "next/packages/libfabrika/src/node/RecordPart.test.ts": [1.3, 1.2],
  // Jobs 131571231492, 131586276245.
  "next/packages/libfabrika/src/node/RecordPartResources.test.ts": [1.0, 0.9],
  // Jobs 131571231706, 131586276341.
  "next/packages/libfabrika/src/node/RecoveryJournal.test.ts": [48.5, 41.7],
  // Jobs 131571231356, 131586276350.
  "next/packages/libfabrika/src/node/Replies.test.ts": [152.3, 177.7],
  // Jobs 131571231226, 131586276292.
  "next/packages/libfabrika/src/node/StartChild.test.ts": [590.5, 484.6],
  // Jobs 131571231356, 131586276350.
  "next/packages/libfabrika/src/node/build/build-assets.test.ts": [34.7, 43.4],
  // Jobs 131571231226, 131586276292.
  "next/packages/libfabrika/src/node/build/build-one-file.test.ts": [68.2, 48.3],
  // Jobs 131571231395, 131586276297.
  "next/packages/libfabrika/src/node/build/css.test.ts": [14.6, 13.9],
  // Jobs 131571231492, 131586276245.
  "next/packages/libfabrika/src/node/build/error-cause.test.ts": [0.2, 0.2],
  // Jobs 131571231706, 131586276341.
  "next/packages/libfabrika/src/node/dev/DevLife.laws.test.ts": [0.2, 0.1],
  // Jobs 131571231356, 131586276350.
  "next/packages/libfabrika/src/node/dev/dev-control.laws.test.ts": [11.3, 9.9],
  // Jobs 131571231492, 131586276245.
  "next/packages/libfabrika/src/node/dev/dev-errors.laws.test.ts": [1.2, 1.1],
  // Jobs 131571231226, 131586276292.
  "next/packages/libfabrika/src/node/dev/dev-recording.laws.test.ts": [0.1, 0.1],
  // Jobs 131571231492, 131586276245.
  "next/packages/libfabrika/src/node/dev/dev-secrets.laws.test.ts": [3.4, 3.0],
  // Jobs 131571231226, 131586276292.
  "next/packages/libfabrika/src/node/dev/dev.laws.test.ts": [2.2, 2.0],
  // Jobs 131571231226, 131586276292.
  "next/packages/libfabrika/src/node/dev/error-cause.test.ts": [0.3, 0.2],
  // Jobs 131571231706, 131586276341.
  "next/packages/libfabrika/src/node/dev/local-dev.test.ts": [2.6, 2.1],
  // Jobs 131571231395, 131586276297.
  "next/packages/libfabrika/src/node/dev/supervision-spans.test.ts": [4.8, 4.6],
  // Jobs 131571231395, 131586276297.
  "next/packages/libfabrika/src/node/gateway/RateLimit.test.ts": [4.3, 3.9],
  // Jobs 131571231492, 131586276245.
  "next/packages/libfabrika/src/node/jobs/JobsLedger.test.ts": [21.2, 19.1],
  // Jobs 131571231706, 131586276341.
  "next/packages/libfabrika/src/node/settings/Command.test.ts": [0.7, 0.5],
  // Jobs 131571231356, 131586276350.
  "next/packages/libfabrika/src/node/settings/Load.test.ts": [1.0, 1.4],
  // Jobs 131571231226, 131586276292.
  "next/packages/libfabrika/src/packs/ProgramName.test.ts": [0.1, 0.1],
  // Jobs 131571231356, 131586276350.
  "next/packages/libfabrika/src/presence/Connections.test.ts": [0.7, 1.0],
  // Jobs 131571231395, 131586276297.
  "next/packages/libfabrika/src/processes/ExitReason.test.ts": [0.5, 0.5],
  // Jobs 131571231492, 131586276245.
  "next/packages/libfabrika/src/processes/Mailbox.test.ts": [2.6, 2.4],
  // Jobs 131571231395, 131586276297.
  "next/packages/libfabrika/src/processes/MailboxHistory.test.ts": [0.4, 0.5],
  // Jobs 131571231395, 131586276297.
  "next/packages/libfabrika/src/processes/ProcessIdGenerator.test.ts": [1.7, 1.7],
  // Jobs 131571231356, 131586276350.
  "next/packages/libfabrika/src/processes/ProcessLifecycle.test.ts": [5.8, 7.7],
  // Jobs 131571231395, 131586276297.
  "next/packages/libfabrika/src/processes/ProcessManager.test.ts": [0.9, 1.1],
  // Jobs 131571231395, 131586276297.
  "next/packages/libfabrika/src/processes/ProcessMonitors.test.ts": [12.9, 11.3],
  // Jobs 131571231395, 131586276297.
  "next/packages/libfabrika/src/processes/ProcessSpans.test.ts": [1.6, 2.2],
  // Jobs 131571231492, 131586276245.
  "next/packages/libfabrika/src/processes/ProcessStreams.test.ts": [2.2, 1.9],
  // Jobs 131571231226, 131586276292.
  "next/packages/libfabrika/src/processes/ProcessTextCaps.test.ts": [4.9, 3.4],
  // Jobs 131571231492, 131586276245.
  "next/packages/libfabrika/src/processes/ProcessWindow.test.ts": [0.5, 0.4],
  // Jobs 131571231492, 131586276245.
  "next/packages/libfabrika/src/processes/internal/processTable.laws.test.ts": [1.8, 1.6],
  // Jobs 131571231706, 131586276341.
  "next/packages/libfabrika/src/processes/internal/programMail.test.ts": [0.1, 0.1],
  // Jobs 131571231492, 131586276245.
  "next/packages/libfabrika/src/runtime/BrainLife.laws.test.ts": [0.1, 0.1],
  // Jobs 131571231356, 131586276350.
  "next/packages/libfabrika/src/runtime/Built.test.ts": [1.5, 1.6],
  // Jobs 131571231226, 131586276292.
  "next/packages/libfabrika/src/runtime/Chaos.laws.test.ts": [0.2, 0.1],
  // Jobs 131571231706, 131586276341.
  "next/packages/libfabrika/src/runtime/EffectFunctions.test.ts": [16.0, 9.5],
  // Jobs 131571231395, 131586276297.
  "next/packages/libfabrika/src/runtime/Entry.test.ts": [0.0, 0.0],
  // Jobs 131571231395, 131586276297.
  "next/packages/libfabrika/src/runtime/ErrorCause.test.ts": [0.6, 0.6],
  // Jobs 131571231226, 131586276292.
  "next/packages/libfabrika/src/runtime/Execution.test.ts": [0.4, 0.2],
  // Jobs 131571231226, 131586276292.
  "next/packages/libfabrika/src/runtime/Gateway.laws.test.ts": [2.2, 1.4],
  // Jobs 131571231492, 131586276245.
  "next/packages/libfabrika/src/runtime/IsolateUsage.test.ts": [0.0, 0.0],
  // Jobs 131571231706, 131586276341.
  "next/packages/libfabrika/src/runtime/Patch.test.ts": [0.1, 0.1],
  // Jobs 131571231356, 131586276350.
  "next/packages/libfabrika/src/runtime/ProcessStore.test.ts": [2.8, 2.0],
  // Jobs 131571231706, 131586276341.
  "next/packages/libfabrika/src/runtime/Program.test.ts": [1.7, 1.1],
  // Jobs 131571231395, 131586276297.
  "next/packages/libfabrika/src/runtime/Program.types.test.ts": [0.1, 0.1],
  // Jobs 131571231395, 131586276297.
  "next/packages/libfabrika/src/runtime/RecoveryGaps.test.ts": [9.9, 9.0],
  // Jobs 131571231356, 131586276350.
  "next/packages/libfabrika/src/runtime/RecoveryStore.test.ts": [0.3, 0.4],
  // Jobs 131571231395, 131586276297.
  "next/packages/libfabrika/src/runtime/Runner.test.ts": [122.4, 115.9],
  // Jobs 131571231706, 131586276341.
  "next/packages/libfabrika/src/runtime/RunnerOptions.test.ts": [0.0, 0.0],
  // Jobs 131571231706, 131586276341.
  "next/packages/libfabrika/src/runtime/RunnerRecovery.laws.test.ts": [2.2, 1.4],
  // Jobs 131571231492, 131586276245.
  "next/packages/libfabrika/src/runtime/RunnerSupervision.test.ts": [56.8, 49.8],
  // Jobs 131571231226, 131586276292.
  "next/packages/libfabrika/src/runtime/State.test.ts": [0.1, 0.1],
  // Jobs 131571231356, 131586276350.
  "next/packages/libfabrika/src/runtime/internal/exitReason.test.ts": [0.0, 0.0],
  // Jobs 131571231226, 131586276292.
  "next/packages/libfabrika/src/runtime/internal/recovery.test.ts": [2.2, 1.6],
  // Jobs 131571231226, 131586276292.
  "next/packages/libfabrika/src/runtime/internal/reply.test.ts": [0.2, 0.1],
  // Jobs 131571231492, 131586276245.
  "next/packages/libfabrika/src/runtime/internal/supervisor.laws.test.ts": [0.6, 0.6],
  // Jobs 131571231395, 131586276297.
  "next/packages/libfabrika/src/settings/Codec.test.ts": [0.2, 0.2],
  // Jobs 131571231492, 131586276245.
  "next/packages/libfabrika/src/settings/Files.test.ts": [0.3, 0.3],
  // Jobs 131571231706, 131586276341.
  "next/packages/libfabrika/src/settings/JsonSchema.test.ts": [0.6, 0.3],
  // Jobs 131571231356, 131586276350.
  "next/packages/libfabrika/src/settings/Print.test.ts": [0.2, 0.2],
  // Jobs 131571231226, 131586276292.
  "next/packages/libfabrika/src/settings/Reference.test.ts": [0.4, 0.3],
  // Jobs 131571231395, 131586276297.
  "next/packages/libfabrika/src/settings/Setting.test.ts": [0.2, 0.2],
  // Jobs 131571231492, 131586276245.
  "next/packages/libfabrika/src/settings/Snapshot.test.ts": [0.7, 0.7],
  // Jobs 131571231706, 131586276341.
  "next/packages/libfabrika/src/settings/Sources.test.ts": [0.2, 0.1],
  // Jobs 131571231356, 131586276350.
  "next/packages/libfabrika/src/settings/TomlParser.test.ts": [0.2, 0.2],
  // Jobs 131571231395, 131586276297.
  "next/packages/libfabrika/src/telemetry/ArchiveCryptoFailure.test.ts": [0.0, 0.0],
  // Jobs 131571231226, 131586276292.
  "next/packages/libfabrika/src/telemetry/ErrorCause.test.ts": [0.2, 0.2],
  // Jobs 131571231492, 131586276245.
  "next/packages/libfabrika/src/telemetry/P12Readers.laws.test.ts": [0.2, 0.2],
  // Jobs 131571231356, 131586276350.
  "next/packages/libfabrika/src/telemetry/Records.test.ts": [4.1, 3.7],
  // Jobs 131571231395, 131586276297.
  "next/packages/libfabrika/src/telemetry/Sink.test.ts": [11.0, 11.4],
  // Jobs 131571231492, 131586276245.
  "next/packages/libfabrika/src/telemetry/Trace.types.test.ts": [0.0, 0.0],
  // Jobs 131571231226, 131586276292.
  "next/packages/libfabrika/src/telemetry/internal/measurements.test.ts": [8.4, 12.1],
  // Jobs 131571231706, 131586276341.
  "next/packages/libfabrika/src/telemetry/internal/sink.test.ts": [0.7, 0.4],
  // Jobs 131571231356, 131586276350.
  "next/packages/libfabrika/src/telemetry/internal/sums.test.ts": [1.2, 2.3],
  // Jobs 131571231706, 131586276341.
  "next/packages/libfabrika/src/transport/Answer.test.ts": [0.3, 0.2],
  // Jobs 131571231226, 131586276292.
  "next/packages/libfabrika/src/transport/Connection.test.ts": [3.3, 2.0],
  // Jobs 131571231395, 131586276297.
  "next/packages/libfabrika/src/transport/ErrorCause.test.ts": [0.2, 0.2],
  // Jobs 131571231395, 131586276297.
  "next/packages/libfabrika/src/transport/Hello.test.ts": [0.6, 0.6],
  // Jobs 131571231706, 131586276341.
  "next/packages/libfabrika/src/transport/Sshsig.test.ts": [1.5, 0.8],
  // Jobs 131571231492, 131586276245.
  "next/packages/libfabrika/src/transport/SshsigWebauthn.test.ts": [0.4, 0.4],
  // Jobs 131571231395, 131586276297.
  "next/packages/libfabrika/src/transport/internal/binaryCryptoFailure.test.ts": [0.0, 0.0],
  // Jobs 131571231492, 131586276245.
  "next/packages/libfabrika/src/transport/internal/connection.test.ts": [1.6, 1.3],
  // Jobs 131571231706, 131586276341.
  "next/programs/chaos/src/program.laws.test.ts": [2.5, 1.3],
  // Jobs 131571231356, 131586276350.
  "next/programs/checklist/src/program.laws.test.ts": [0.2, 0.3],
  // Jobs 131571231706, 131586276341.
  "next/programs/counter/src/program.laws.test.ts": [0.3, 0.2],
  // Jobs 131571231492, 131586276245.
  "next/programs/counter/src/runner.laws.test.ts": [4.9, 4.2],
  // Jobs 131571231226, 131586276292.
  "next/programs/counter/src/window.types.test.ts": [0.0, 0.0],
  // Jobs 131571231395, 131586276297.
  "next/programs/pipeline/src/Change.test.ts": [1.0, 0.9],
  // Jobs 131571231492, 131586276245.
  "next/programs/pipeline/src/Merger.laws.test.ts": [1.6, 1.5],
  // Jobs 131571231706, 131586276341.
  "next/programs/pipeline/src/Settings.test.ts": [0.3, 0.2],
  // Jobs 131571231356, 131586276350.
  "next/programs/pipeline/src/handlers.test.ts": [0.7, 1.0],
  // Jobs 131571231226, 131586276292.
  "next/programs/pipeline/src/node/runner.laws.test.ts": [38.8, 27.1],
} as const;

it("vector: L5 all 210 next rows use the larger of the two recorded main-run samples", () => {
  // Preserve exact file-set coverage as well as the weights, including measured zeroes.
  const expected = Object.fromEntries(
    Object.entries(nextSamples).map(([path, samples]) => [path, Math.max(...samples)]),
  );
  expect(Object.fromEntries(Object.entries(measured).filter(([path]) => path.startsWith("next/")))).toEqual(expected);
});

// T342, today's sharding. Covers assign and the measured table. Plants: drop a file,
// restore equal-count assignment, or discard measured script times.
// T342: all three plants failed their laws. Equal-count placement initially survived
// the final load bound; checking the least measured load at each placement caught it.
it("L8: generated sharding assigns once to the least load including starts, independent of input order", () => {
  fc.assert(
    fc.property(
      fc.uniqueArray(fc.record({ path: fc.string({ minLength: 1 }), seconds: fc.integer({ min: 0, max: 500 }) }), {
        selector: (f) => f.path,
        minLength: 1,
        maxLength: 40,
      }),
      fc.integer({ min: 1, max: 12 }),
      fc.array(fc.integer({ min: 0, max: 2000 }), { maxLength: 12 }),
      (files, count, start) => {
        const machines = assign(files, count, start);
        expect(machines).toHaveLength(files.length);
        const running = Array.from({ length: count }, (_, i) => start[i] ?? 0);

        for (const { file, index } of files
          .map((file, index) => ({ file, index }))
          .toSorted(
            (a, b) =>
              b.file.seconds - a.file.seconds || (a.file.path < b.file.path ? -1 : a.file.path > b.file.path ? 1 : 0),
          )) {
          const machine = machines[index]!;
          expect(running[machine]).toBe(Math.min(...running));
          expect(machine).toBe(running.indexOf(Math.min(...running)));
          running[machine] = running[machine]! + file.seconds;
        }

        expect(machines.every((m) => m >= 0 && m < count && Number.isInteger(m))).toBe(true);
        const first = Object.fromEntries(files.map((f, i) => [f.path, machines[i]]));
        const reversed = files.toReversed();
        expect(Object.fromEntries(reversed.map((f, i) => [f.path, assign(reversed, count, start)[i]]))).toEqual(first);
        expect(assign(files, count, [])).toEqual(assign(files, count));
        const empty = assign(files, count);
        const legacy = Array.from({ length: count }, () => 0);

        for (const file of files.toSorted(
          (a, b) => b.seconds - a.seconds || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0),
        )) {
          const least = legacy.indexOf(Math.min(...legacy));
          expect(empty[files.indexOf(file)]).toBe(least);
          legacy[least] = legacy[least]! + file.seconds;
        }

        const load = Array.from({ length: count }, (_, m) =>
          files.reduce((sum, f, i) => sum + (empty[i] === m ? f.seconds : 0), 0),
        );
        expect(Math.max(...load) - Math.min(...load)).toBeLessThanOrEqual(Math.max(...files.map((f) => f.seconds)));
      },
    ),
    { seed: 119120, numRuns: 100 },
  );
});

it("vector: real CI medians include the previously unweighted scripts", () => {
  // Fixed medians from runs 42579837468, 42573088027 and 42571265116, rounded to one decimal.
  // T554 refresh: plancheck.test.ts is the median of runs 42803733957, 42807559589 and 42801440878.
  expect(measured[".agents/skills/plan/scripts/plancheck.test.ts"]).toBe(106.2);
  expect(measured["apps/fabrika/src/bundles.test.ts"]).toBe(3.7);
  expect(measured["packages/pipeline/src/laws/standard.test.ts"]).toBe(3.5);
});

it("vector: the four catchup files carry their times from PR 770's CI run", () => {
  // T559: the split files, one time each from run 42883743294, rounded to one decimal.
  // Plant: drop these rows, so all four count as 1 s and can stack on one machine.
  for (const [path, seconds] of [
    [".agents/skills/lead/scripts/catchup.test.ts", 102.4],
    [".agents/skills/lead/scripts/catchup.cleanup.test.ts", 124.1],
    [".agents/skills/lead/scripts/catchup.nested-storage-checkout.test.ts", 175.7],
    [".agents/skills/lead/scripts/catchup.nested-storage-driver.test.ts", 163.6],
  ] as const) {
    expect.soft(measured[path], path).toBe(seconds);
  }
});

it("vector: the four build files carry their refreshed main-run times", () => {
  // T502, next/ (A9, A10), refreshed by T890. Samples and jobs are recorded in nextSamples.
  // Attempt 1 of runs 43329697311 and 43334183021; use the larger until the third green run.
  // Plant: drop these rows, so all four count 1 s and the heavy build files can stack on one machine.
  for (const path of [
    "next/apps/fabrika/src/build.test.ts",
    "next/apps/fabrika/src/exam/bytes.test.ts",
    "next/packages/libfabrika/src/node/build/build-assets.test.ts",
    "next/packages/libfabrika/src/node/build/build-one-file.test.ts",
  ] as const) {
    expect.soft(measured[path], path).toBe(Math.max(...nextSamples[path]));
  }
});

it("vector: lead test medians match the three green main CI runs", () => {
  // T375 Amendment 1: fixed CI medians from 42631962689, 42631256491 and 42630840277.
  // Plant: discard these rows, leaving the scripts to count as 1 s.
  for (const [path, seconds] of [
    // T554 refresh: median of 10 runs, PR 757's check run 42874119130, attempts 5 to 14.
    [".agents/skills/lead/scripts/box.test.ts", 348.7],
    [".agents/skills/step-commit/scripts/stepcommit.test.ts", 18.2],
    [".agents/skills/lead/scripts/redact.test.ts", 7.2],
    [".agents/skills/lead/scripts/gc.test.ts", 0.1],
  ] as const) {
    expect.soft(measured[path], path).toBe(seconds);
  }
});

// How the check's test machines split the test files: each gets about the same seconds, not the
// same count of files.

/** Twelve lane files of about two minutes each, and 300 files of a second. Made up. */
const HEAVY = Array.from({ length: 12 }, (_, i) => ({ path: `lane.${i}.test.ts`, seconds: 115 + i }));
const LIGHT = Array.from({ length: 300 }, (_, i) => ({ path: `small.${i}.test.ts`, seconds: 1 }));

const ROOT = dirname(fileURLToPath(import.meta.url));
const LANES = "packages/pipeline/src/stages/pipeline";

/** How many files each of `count` machines got. */
const perMachine = (machines: readonly number[], count: number) =>
  Array.from({ length: count }, (_, m) => machines.filter((at) => at === m).length);

/** Each path's machine. */
const byPath = (files: readonly { path: string }[], machines: readonly number[]) =>
  Object.fromEntries(files.map((f, i) => [f.path, machines[i]]));

describe("assign", () => {
  it("puts two of twelve heavy files on each of six machines, among 300 light ones", () => {
    const machines = assign([...HEAVY, ...LIGHT], 6);
    expect(machines).toHaveLength(312);
    expect(perMachine(machines.slice(0, 12), 6)).toEqual([2, 2, 2, 2, 2, 2]);
    expect(machines.every((m) => m >= 0 && m < 6)).toBe(true);
  });

  it("gives each machine at most one file when there are fewer files than machines", () => {
    const machines = assign(HEAVY.slice(0, 3), 6);
    expect(machines).toHaveLength(3);
    expect(Math.max(...perMachine(machines, 6))).toBe(1);
  });

  it("gives each path the same machine, in whatever order the files come", () => {
    const files = [...HEAVY, ...LIGHT];
    const first = byPath(files, assign(files, 6));
    const reversed = files.toReversed();
    const interleaved = [...files.filter((_, i) => i % 2 === 1), ...files.filter((_, i) => i % 2 === 0)];
    expect(byPath(reversed, assign(reversed, 6))).toEqual(first);
    expect(byPath(interleaved, assign(interleaved, 6))).toEqual(first);
  });

  it("places the heaviest file first, and two as heavy by their paths", () => {
    // Each goes to the machine with the least so far; of empty machines, the first.
    const files = [
      { path: "b.test.ts", seconds: 10 },
      { path: "a.test.ts", seconds: 10 },
      { path: "c.test.ts", seconds: 30 },
    ];
    expect(assign(files, 3)).toEqual([2, 1, 0]);
  });

  it("gives files of equal seconds their machines by path alone, whatever their order", () => {
    const files = ["d", "b", "e", "a", "c"].map((name) => ({ path: `${name}.test.ts`, seconds: 5 }));
    const want = { "a.test.ts": 0, "b.test.ts": 1, "c.test.ts": 2, "d.test.ts": 3, "e.test.ts": 4 };
    expect(byPath(files, assign(files, 5))).toEqual(want);
    const sorted = files.toSorted((x, y) => (x.path < y.path ? -1 : 1));
    expect(byPath(sorted, assign(sorted, 5))).toEqual(want);
    expect(byPath(sorted.toReversed(), assign(sorted.toReversed(), 5))).toEqual(want);
  });
});

describe("measured", () => {
  it("names only files that are in the repo, so a renamed file cannot quietly count 1", () => {
    const keys = Object.keys(measured);
    expect(keys.length).toBeGreaterThan(0);
    const isFile = (path: string) => statSync(join(ROOT, path), { throwIfNoEntry: false })?.isFile() === true;
    expect(keys.filter((path) => !isFile(path))).toEqual([]);
  });
});

describe("Shards", () => {
  it("is vitest's own sequencer with only its sharding changed: vitest's sort is kept", () => {
    expect(Object.getPrototypeOf(Shards.prototype)).toBe(BaseSequencer.prototype);
    expect(Object.hasOwn(Shards.prototype, "shard")).toBe(true);
    expect(Shards.prototype.sort).toBe(BaseSequencer.prototype.sort);
  });

  it("scenario: L13 lane-only shards cover every lane once and balance on top of the rest", async () => {
    // The real repo config selects lanes before sharding. Plant: start lanes from zero.
    const lanes = readdirSync(join(ROOT, LANES))
      .filter((name) => /^lane\..*\.test\.ts$/.test(name))
      .map((name) => `${LANES}/${name}`);
    const kept: string[][] = [];

    for (const index of [1, 2, 3, 4, 5, 6]) {
      // This repo's config, as `vitest run --shard k/6` reads it; nothing runs.
      const vitest = await createVitest("test", { root: ROOT, watch: false, shard: `${index}/6` });

      try {
        const specs = (await vitest.globTestSpecifications()).filter((spec) =>
          inLaneStep(relative(ROOT, spec.moduleId)),
        );
        const Sequencer = vitest.config.sequence.sequencer;
        const mine = await new Sequencer(vitest).shard(specs);
        kept.push(mine.map((spec) => relative(ROOT, spec.moduleId)));
      } finally {
        await vitest.close();
      }
    }

    expect(
      kept
        .flat()
        .filter((p) => lanes.includes(p))
        .toSorted(),
    ).toEqual(lanes.toSorted());
    const rest = Object.entries(measured)
      .filter(([path]) => !path.startsWith("next/") && !inLaneStep(path))
      .map(([path, seconds]) => ({ path, seconds }));
    const placed = assign(rest, 6);
    const loads = Array.from({ length: 6 }, (_, i) =>
      wall(rest.filter((_, j) => placed[j] === i).map((file) => file.seconds)),
    );
    expect(restLoads(6)).toEqual(loads);
    const seconds = kept.map((paths, i) => paths.reduce((sum, p) => sum + (measured[p] ?? 1), loads[i]!));
    const heaviestLane = Math.max(...lanes.map((path) => measured[path] ?? 1));
    const biggest = Math.max(
      ...Object.entries(measured)
        .filter(([path]) => !path.startsWith("next/"))
        .map(([, seconds]) => seconds),
    );
    expect(Math.max(...seconds)).toBeLessThanOrEqual(Math.max(Math.min(...seconds) + heaviestLane, biggest));
  });

  it("scenario: a list holding a lane file and another file is split as `assign` does, from zeros", async () => {
    // Only a list of lane files only starts from `restLoads`: the rest step shares those machines.
    // Plant: start from `restLoads` when any file is a lane file.
    const lanes = readdirSync(join(ROOT, LANES))
      .filter((name) => /^lane\..*\.test\.ts$/.test(name))
      .map((name) => `${LANES}/${name}`);
    const others = Object.keys(measured).filter((path) => !path.startsWith("next/") && !inLaneStep(path));
    const paths = [...lanes, ...others];
    const files = paths.map((path) => ({ path, seconds: measured[path] ?? 1 }));
    const placed = assign(files, 6);

    for (const index of [1, 2, 3, 4, 5, 6]) {
      const vitest = await createVitest("test", { root: ROOT, watch: false, shard: `${index}/6` });

      try {
        const Sequencer = vitest.config.sequence.sequencer;
        const mine = await new Sequencer(vitest).shard(paths.map((path) => ({ moduleId: join(ROOT, path) })) as never);
        expect(mine.map((spec) => relative(ROOT, spec.moduleId))).toEqual(
          paths.filter((_, i) => placed[i] === index - 1),
        );
      } finally {
        await vitest.close();
      }
    }
  });
});

it("L9: wall equals the largest file or the shared worker load", () => {
  // Plant: return the plain sum, ignoring parallel workers.
  fc.assert(
    fc.property(fc.array(fc.integer({ min: 0, max: 10000 })), (seconds) => {
      const biggest = Math.max(0, ...seconds);
      const shared = seconds.reduce((sum, seconds) => sum + seconds, 0) / WORKERS;
      const actual = wall(seconds);
      expect(actual).toBeGreaterThanOrEqual(biggest);
      expect(actual).toBeGreaterThanOrEqual(shared);
      expect([biggest, shared]).toContain(actual);
    }),
    { seed: 119120, numRuns: 100 },
  );
});

it("vector: L12 stale non-lane rows hold the three T554 run medians", () => {
  // Runs 42803733957, 42807559589, 42801440878. Gap >20 s; missing rows count 1 s.
  // The last four rows (box, boxrm, loosening, program-package-layout) come from PR 757's
  // check run 42874119130, attempts 5 to 14, a median of 10.
  // Plant: restore catchup's old 47.2 seconds. Lane rows await the PR's own run.
  // catchup.test.ts was split by PR 772 (ticket 572); its row is now main's 102.4 from run 42883743294.
  const expected = {
    ".agents/skills/lead/scripts/catchup.test.ts": 102.4,
    ".agents/skills/lead/scripts/box.test.ts": 348.7,
    ".agents/skills/lead/scripts/boxrm.test.ts": 295.0,
    ".agents/skills/lead/scripts/loosening.test.ts": 234.6,
    "oxlint-plugins/program-package-layout.test.ts": 80.3,
    "packages/fabrika/src/host/fence.laws.test.ts": 117.1,
    "scripts/caps.test.ts": 108.5,
    ".agents/skills/plan/scripts/plancheck.test.ts": 106.2,
    "oxlint-plugins/plants.test.ts": 48.2,
    "oxlint-plugins/padding-line-between-statements.test.ts": 44.7,
    ".agents/skills/lead/scripts/leakgrep.test.ts": 34.2,
    ".agents/skills/lead/scripts/mutbox.test.ts": 34.0,
    ".agents/skills/lead/scripts/skillscheck.test.ts": 25.9,
  };

  for (const [path, seconds] of Object.entries(expected)) {
    expect.soft(measured[path], path).toBe(seconds);
  }
});
