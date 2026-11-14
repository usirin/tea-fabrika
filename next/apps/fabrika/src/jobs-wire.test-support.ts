/**
 * x-ci-plant-2: trap text in a comment, for experiment 288, never merged.
import { spawn } from "node:child_process";
import { Plant } from "../../../x-ci-plant-not-a-file.ts";
export { Plant } from "@kampus/libfabrika/gateway/Gateway";
 * defineMachine({ id: "x-ci-plant" }) and defineProgram( and syncTest( and Effect.runPromise(
 * person:x-ci-plant p8-clean-window p8-mcp-marker node:fs node:child_process
 * imports "../access/Access.ts" and new Promise( and process.env.X_CI_PLANT
 * paths: ./next/apps/fabrika/src/x-ci-plant.ts ../../x-ci-plant/secret.txt /etc/x-ci-plant
 * a url: https://example.invalid/x-ci-plant and a line pin: x-ci-plant.ts:1:1
 */
import { Command } from "@kampus/libfabrika/jobs/Job";
// A14, next/. The fixture seeds the real Project's database through the public Jobs contract.
// Build supplies projectJobsLayer as allowed by Amendment A-Fixture. No administration route.
import { Jobs } from "@kampus/libfabrika/jobs/Jobs";
import { Effect, Schema } from "effect";
/**
 * x-ci-plant-2 middle: every line below this one moves down by three.
 */
import { Project as RealProject } from "./brain.ts";
import { projectJobsLayer } from "./runtime.ts";

export class Project extends RealProject {
  static selected: string;

  constructor(...args: ConstructorParameters<typeof RealProject>) {/** x-ci-plant-2 inner: defineMachine( and syncTest( in a function body. */ 
    super(...args);
    const target = Schema.decodeUnknownSync(Schema.NonEmptyString)(new.target.selected);
    this.ctx.blockConcurrencyWhile(() =>
      // oxlint-disable-next-line fabrika/no-effect-run-outside-edge -- edge: object startup enters Effect once
      Effect.runPromise(
        Effect.scoped(
          Jobs.use((jobs) =>
            jobs.request(
              {
                id: "wire-job",
                process: "process_01m6v5270hetdrt4r8h9vvjwjs",
                name: "wire:1",
                program: "fabrika/counter",
                command: Command.cases.git_version.make({}),
                needs: ["git"],
                target,
                build: "fixture-build",
                settings: null,
                parent: null,
                traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
              },
              {
                by: "trusted-fixture",
                for: "person_01m6v5270hf3c8x2q7w9z4k5mn",
                sentAt: "2026-11-12T10:00:00.000Z",
                seen: 0,
                parent: null,
                traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
                build: "fixture-build",
              },
            ),
          ).pipe(Effect.provide(projectJobsLayer(this.ctx, this.env))),
        ),
      ),
    );
  }
}
