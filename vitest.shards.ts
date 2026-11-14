import { relative } from "node:path";
import { BaseSequencer, type TestSpecification } from "vitest/node";

// How `--shard k/n` splits the test files over the check's machines: each machine gets about the
// same seconds, not the same count of files. vitest's own split gives each the same count, so two
// five-minute files can land on one machine while another runs only one-second files.

/**
 * Seconds per file from the repo root: medians of the test-file times in CI runs
 * 42579837468, 42573088027 and 42571265116, rounded to one decimal.
 * The refreshed rows use main runs 42803733957, 42807559589
 * and 42801440878. box, boxrm, loosening and program-package-layout come from PR 757's check
 * run 42874119130, attempts 5 to 14 (a median of 10).
 * stepcommit, redact and gc use CI runs 42631962689, 42631256491 and 42630840277.
 * next/ medians use main runs 42717511599, 42716453289 and 42715921306, rounded to one decimal.
 * T871 medians use completed main runs 43239450301 (755d6f4ad), 43235822398 (2d60c9835)
 * and 43234969237 (27011b244), all attempt 1, with jobs and samples beside each row.
 * The four build files (build.test.ts, build-assets.test.ts, build-one-file.test.ts, exam/bytes.test.ts) are one time each from CI run 42922102030, rounded to one decimal.
 * A file not measured counts 1 s.
 */
export const measured: Record<string, number> = {
  ".agents/skills/lead/scripts/box.test.ts": 348.7,
  ".agents/skills/lead/scripts/gc.test.ts": 0.1,
  ".agents/skills/lead/scripts/redact.test.ts": 7.2,
  ".agents/skills/lead/scripts/skillscheck.test.ts": 25.9,
  ".agents/skills/mutation/scripts/run.test.ts": 5.8,
  ".agents/skills/mutation/scripts/sample.test.ts": 0.5,
  ".agents/skills/plan/scripts/plancheck.test.ts": 106.2,
  ".agents/skills/step-commit/scripts/stepcommit.test.ts": 18.2,
  "next/apps/fabrika/src/brain-life.test.ts": 27.4,
  "next/apps/fabrika/src/build.test.ts": 39.9,
  "next/apps/fabrika/src/door-recovery.test.ts": 52.6,
  "next/apps/fabrika/src/door-spans.test.ts": 2.8,
  "next/apps/fabrika/src/door.test.ts": 17.2,
  "next/apps/fabrika/src/exam/alchemy-lifecycle.test.ts": 11.0,
  "next/apps/fabrika/src/exam/bytes.test.ts": 4.9,
  "next/apps/fabrika/src/exam/clock.test.ts": 0.0,
  // Provisional split estimates: original commits-git median 247.6 / 4 = 61.9 s.
  // Source main runs: 42717511599, 42716453289 and 42715921306.
  "next/apps/fabrika/src/exam/commits-git-chain.test.ts": 61.9,
  "next/apps/fabrika/src/exam/commits-git-person.test.ts": 61.9,
  "next/apps/fabrika/src/exam/commits-git-signatures.test.ts": 61.9,
  "next/apps/fabrika/src/exam/commits-git-steps.test.ts": 61.9,
  "next/apps/fabrika/src/exam/commits.test.ts": 0.6,
  "next/apps/fabrika/src/exam/compiler.test.ts": 0.0,
  "next/apps/fabrika/src/exam/deps.test.ts": 1.1,
  "next/apps/fabrika/src/exam/edge-comment.test.ts": 0.0,
  "next/apps/fabrika/src/exam/edges.test.ts": 3.7,
  "next/apps/fabrika/src/exam/effect-functions.test.ts": 0.0,
  "next/apps/fabrika/src/exam/laws-scan.test.ts": 0.0,
  "next/apps/fabrika/src/exam/layers.test.ts": 0.0,
  "next/apps/fabrika/src/exam/ledger-sql.test.ts": 4.5,
  "next/apps/fabrika/src/exam/no-effect-run-outside-edge.test.ts": 0.0,
  "next/apps/fabrika/src/exam/no-hand-tag.test.ts": 0.0,
  "next/apps/fabrika/src/exam/no-of.test.ts": 0.0,
  "next/apps/fabrika/src/exam/no-promises.test.ts": 34.1,
  "next/apps/fabrika/src/exam/one-store-hook.test.ts": 0.3,
  "next/apps/fabrika/src/exam/react-rules.test.ts": 0.0,
  "next/apps/fabrika/src/exam/secret-types.test.ts": 4.6,
  "next/apps/fabrika/src/exam/twin.test.ts": 20.0,
  "next/apps/fabrika/src/file-services.laws.test.ts": 0.5,
  "next/apps/fabrika/src/grant-readers.laws.test.ts": 1.8,
  "next/apps/fabrika/src/local-instance.test.ts": 1.6,
  "next/apps/fabrika/src/runtime-recovery.laws.test.ts": 0.4,
  "next/apps/fabrika/src/runtime.laws.test.ts": 30.1,
  "next/apps/fabrika/src/settings.test.ts": 0.0,
  "next/apps/fabrika/src/instance-records.test.ts": 32.8,
  "next/apps/fabrika/src/instance-wire.test.ts": 68.6,
  // Shard 4 jobs 131255816865, 131243028487, 131240031939: 19.6, 15.7, 23.9 s; median 19.6.
  "next/apps/fabrika/src/worker-mail.test.ts": 19.6,
  "next/packages/libfabrika/src/runtime/BrainLife.laws.test.ts": 0.1,
  "next/packages/libfabrika/src/runtime/EffectFunctions.test.ts": 4.2,
  "next/packages/libfabrika/src/runtime/Entry.test.ts": 0.0,
  "next/packages/libfabrika/src/runtime/Execution.test.ts": 0.2,
  "next/packages/libfabrika/src/runtime/Gateway.laws.test.ts": 1.3,
  "next/packages/libfabrika/src/runtime/Patch.test.ts": 0.1,
  "next/packages/libfabrika/src/runtime/Program.test.ts": 0.5,
  "next/packages/libfabrika/src/runtime/Program.types.test.ts": 0.1,
  "next/packages/libfabrika/src/runtime/RecoveryGaps.test.ts": 0.9,
  "next/packages/libfabrika/src/runtime/RunnerRecovery.laws.test.ts": 0.7,
  "next/packages/libfabrika/src/runtime/RunnerSupervision.test.ts": 67.5,
  "next/packages/libfabrika/src/runtime/Runner.test.ts": 41.2,
  "next/packages/libfabrika/src/runtime/State.test.ts": 0.1,
  "next/packages/libfabrika/src/runtime/internal/supervisor.laws.test.ts": 0.1,
  "next/packages/libfabrika/src/node/build/build-assets.test.ts": 48.6,
  "next/packages/libfabrika/src/node/build/build-one-file.test.ts": 11.0,
  // First split ready run 43255323922: shard 1, job 131312463038, store wrapper 18.5 s.
  "next/packages/libfabrika/src/node/ProgramMail.test.ts": 18.5,
  // First split ready run 43255323922: shard 4, job 131312462890, runtime wrapper 290.9 s.
  "next/packages/libfabrika/src/node/ProgramMailRuntime.test.ts": 290.9,
  // Shard 4 jobs 131255816865, 131243028487, 131240031939: 79.2, 71.1, 84.4 s; median 79.2.
  "next/packages/libfabrika/src/node/Nemesis.laws.test.ts": 79.2,
  "next/packages/libfabrika/src/access/Authorization.test.ts": 16.4,
  "next/packages/libfabrika/src/access/ClientManager.test.ts": 13.0,
  "next/packages/libfabrika/src/presence/Connections.test.ts": 2.5,
  "next/packages/libfabrika/src/processes/MailboxHistory.test.ts": 0.4,
  "next/packages/libfabrika/src/processes/Mailbox.test.ts": 36.1,
  "next/packages/libfabrika/src/access/Access.test.ts": 1.4,
  "next/packages/libfabrika/src/access/Passkey.test.ts": 0.1,
  "next/packages/libfabrika/src/processes/ProcessIdGenerator.test.ts": 1.3,
  "next/packages/libfabrika/src/processes/ProcessLifecycle.test.ts": 14.8,
  "next/packages/libfabrika/src/processes/ProcessManager.test.ts": 2.5,
  "next/packages/libfabrika/src/processes/ProcessMonitors.test.ts": 20.2,
  "next/packages/libfabrika/src/runtime/internal/recovery.test.ts": 1.9,
  "next/packages/libfabrika/src/processes/ProcessSpans.test.ts": 6.0,
  "next/packages/libfabrika/src/runtime/ProcessStore.test.ts": 2.0,
  "next/packages/libfabrika/src/processes/ProcessStreams.test.ts": 8.5,
  "next/packages/libfabrika/src/processes/ProcessTextCaps.test.ts": 14.1,
  "next/packages/libfabrika/src/processes/ProcessWindow.test.ts": 1.2,
  "next/packages/libfabrika/src/runtime/RecoveryStore.test.ts": 0.1,
  "next/packages/libfabrika/src/access/SessionManager.test.ts": 8.8,
  "next/packages/libfabrika/src/access/AccessSpans.test.ts": 4.9,
  "next/packages/libfabrika/src/access/Text.test.ts": 0.0,
  "next/packages/libfabrika/src/telemetry/ArchiveCryptoFailure.test.ts": 0.0,
  "next/packages/libfabrika/src/telemetry/internal/measurements.test.ts": 4.4,
  "next/packages/libfabrika/src/ledger/LedgerCallSpans.test.ts": 0.6,
  "next/packages/libfabrika/src/ledger/LedgerTransaction.test.ts": 0.1,
  "next/packages/libfabrika/src/ledger/Ledger.test.ts": 2.2,
  "next/packages/libfabrika/src/ledger/Log.test.ts": 1.9,
  "next/packages/libfabrika/src/telemetry/P12Readers.laws.test.ts": 0.2,
  "next/packages/libfabrika/src/telemetry/Records.test.ts": 0.6,
  "next/packages/libfabrika/src/ledger/Rings.test.ts": 0.2,
  "next/packages/libfabrika/src/telemetry/Sink.test.ts": 1.0,
  "next/packages/libfabrika/src/ledger/LedgerSpans.test.ts": 1.1,
  "next/packages/libfabrika/src/ledger/TraceId.test.ts": 0.8,
  "next/packages/libfabrika/src/gateway/GatewayRevocation.test.ts": 19.6,
  "next/packages/libfabrika/src/Id.test.ts": 3.8,
  "next/packages/libfabrika/src/Id.types.test.ts": 0.0,
  "next/packages/libfabrika/src/node/dev/local-dev.test.ts": 2.5,
  "next/packages/libfabrika/src/node/dev/dev-errors.laws.test.ts": 2.1,
  "next/packages/libfabrika/src/node/dev/dev-recording.laws.test.ts": 0.1,
  "next/packages/libfabrika/src/node/dev/dev-secrets.laws.test.ts": 4.2,
  "next/packages/libfabrika/src/node/dev/dev.laws.test.ts": 2.3,
  "next/packages/libfabrika/src/node/dev/supervision-spans.test.ts": 11.3,
  "next/packages/libfabrika/src/Testing.test.ts": 0.0,
  "next/packages/libfabrika/src/transport/Answer.test.ts": 0.2,
  "next/packages/libfabrika/src/transport/internal/binaryCryptoFailure.test.ts": 0.0,
  "next/packages/libfabrika/src/transport/Hello.test.ts": 1.1,
  "next/packages/libfabrika/src/transport/SshsigWebauthn.test.ts": 0.5,
  "next/packages/libfabrika/src/transport/Sshsig.test.ts": 1.1,
  "next/packages/libfabrika/src/gateway/internal/waiting.test.ts": 0.1,
  "next/packages/libfabrika/src/cloudflare/fetch.test.ts": 0.4,
  "next/packages/libfabrika/src/cloudflare/index.test.ts": 0.0,
  "next/packages/libfabrika/src/cloudflare/readers.laws.test.ts": 0.6,
  "next/packages/libfabrika/src/cloudflare/runner-reply.laws.test.ts": 3.6,
  "next/packages/libfabrika/src/cloudflare/supervision.laws.test.ts": 11.5,
  "next/programs/counter/src/program.laws.test.ts": 0.1,
  "next/programs/counter/src/runner.laws.test.ts": 0.3,
  "oxlint-plugins/door-is-library.test.ts": 0.0,
  "oxlint-plugins/exact-versions.test.ts": 7.1,
  "oxlint-plugins/one-id-module.test.ts": 9.0,
  "oxlint-plugins/outside-input-constructor.test.ts": 1.1,
  "oxlint-plugins/plants.test.ts": 48.2,
  "oxlint-plugins/stylelint.test.ts": 6.9,
  "packages/fabrika-design/src/build/contrast.test.ts": 0.0,
  "packages/fabrika-design/src/build/schema.test.ts": 0.1,
  "packages/fabrika-design/src/build/tokens.test.ts": 22.2,
  "packages/fabrika-design/src/themes.frame.test.ts": 0.0,
  "packages/fabrika-design/src/themes.test.ts": 0.1,
  ".agents/skills/lead/scripts/boxrm.test.ts": 295.0,
  ".agents/skills/lead/scripts/loosening.test.ts": 234.6,
  "scripts/caps.test.ts": 108.5,
  "oxlint-plugins/padding-line-between-statements.test.ts": 44.7,
  ".agents/skills/lead/scripts/leakgrep.test.ts": 34.2,
  ".agents/skills/lead/scripts/mutbox.test.ts": 34.0,
  "oxlint-plugins/program-package-layout.test.ts": 80.3,
  "vitest.shards.test.ts": 0.3,
};

/**
 * Each file's machine, `0` to `count - 1`, in the order the files came. Each file, heaviest first
 * (ties by path), goes to the machine with the least seconds so far (ties: the first). The same
 * files in any order get the same machines, so every machine computes the same split.
 */
export const assign = (
  files: readonly { readonly path: string; readonly seconds: number }[],
  count: number,
  start: readonly number[] = [],
): number[] => {
  const order = files
    .map((file, at) => ({ ...file, at }))
    .toSorted((x, y) => y.seconds - x.seconds || (x.path < y.path ? -1 : x.path > y.path ? 1 : 0));
  const load = Array.from({ length: count }, (_, i) => start[i] ?? 0);
  const machines = files.map(() => 0);

  for (const file of order) {
    const least = load.indexOf(Math.min(...load));
    machines[file.at] = least;
    load[least] = (load[least] ?? 0) + file.seconds;
  }

  return machines;
};

/** Workers used by the rest step on each CI machine. */
export const WORKERS = 3;

export const wall = (seconds: readonly number[]): number =>
  Math.max(0, ...seconds, seconds.reduce((sum, value) => sum + value, 0) / WORKERS);

/** vitest's own sequencer, with only `shard` changed: it keeps this machine's files of `assign`. */
export class Shards extends BaseSequencer {
  override async shard(files: TestSpecification[]): Promise<TestSpecification[]> {
    const { root, shard } = this.ctx.config;

    // vitest calls `shard` only when `--shard` is given; the type does not know that.
    if (shard === undefined) {
      throw new Error("Shards.shard: called without --shard");
    }

    const machines = assign(
      files.map((spec) => {
        const path = relative(root, spec.moduleId);
        return { path, seconds: measured[path] ?? 1 };
      }),
      shard.count,
    );
    return files.filter((_, i) => machines[i] === shard.index - 1);
  }
}
