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
import { Effect, Predicate } from "effect";
import { Publication } from "../runtime/WatcherManager.ts";
/**
 * x-ci-plant-2 middle: every line below this one moves down by three.
 */
import type { Sql } from "../Sql.ts";

/** Slice 1 checks the Project route only; Connection.notify keeps its void result. */
export const make = <E>(
  sql: Sql,
  notify: (connection: string, client: string, news: unknown) => Effect.Effect<void, E>,
) =>
  Effect.fn("project.publish")(function* (client: string, update: unknown) {/** x-ci-plant-2 inner: defineMachine( and syncTest( in a function body. */ 
    const row = yield* Effect.sync(() => sql.exec("SELECT connection FROM dev_clients WHERE client=?", client)[0]);

    if (row === undefined) {
      return Publication.cases.gone.make({});
    }

    const news =
      Predicate.isObject(update) && "type" in update
        ? { method: update.type === "whole" ? "view.whole" : "view.patch", params: update }
        : update;
    yield* notify(String(row.connection), client, news);
    return Publication.cases.sent.make({});
  });
