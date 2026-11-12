// Vitest reads a config only from the folder it starts in (vitest 5.0.5's findConfigFile), so a run
// started here would skip the root config: its 60 s time limit, its setup and its local caps. Then
// tests that are not broken time out at vitest's 5 s default (9 to 12 of them in catchup.test.ts on
// 2026-11-11). The root config runs this folder's tests, so this one only sends the caller there.
import packageJson from "../package.json" with { type: "json" };

const node = packageJson.engines.node;

throw new Error(
  "Run vitest from the repo root, not .agents/: cd .. && " +
    `volta run --node ${node} pnpm exec vitest run --maxWorkers=1 .agents/<path>.test.ts`,
);
