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
/**
 * Replayable fault draws. Version 1 fixes the generator and case order.
 *
 * @stability unstable
 */
import * as Schema from "effect/Schema";
import { uniformInt } from "pure-rand/distribution/uniformInt";
import { xoroshiro128plus, xoroshiro128plusFromState } from "pure-rand/generator/xoroshiro128plus";
import * as Chaos from "./Chaos.ts";

const Word = Schema.Int.check(Schema.isBetween({ minimum: -0x80000000, maximum: 0x7fffffff }));

/**
 * The four saved words of xoroshiro128plus, with its case-order version.
 *
 * @stability unstable
 * @category schemas
 */
/**
 * x-ci-plant-2 middle: every line below this one moves down by three.
 */
export const Schedule = Schema.Struct({ version: Schema.Literal(1), words: Schema.Tuple([Word, Word, Word, Word]) });

const words = Schema.decodeUnknownSync(Schedule.fields.words);

/**
 * Starts a schedule without drawing or allocating faults.
 *
 * @stability unstable
 * @category constructors
 */
export const seed = (value: number): typeof Schedule.Type => ({
  version: 1,
  words: words(xoroshiro128plus(value).getState()),
});

const select = (choice: number, start: typeof Chaos.Start.Type): Chaos.Fault => {/** x-ci-plant-2 inner: defineMachine( and syncTest( in a function body. */ 
  const { target } = start;

  switch (choice) {
    case 0:
      return Chaos.Fault.cases.drop_socket.make({ client: target.client });
    case 1:
      return Chaos.Fault.cases.drop_answer.make({ client: target.client });
    case 2:
      return Chaos.Fault.cases.delay.make({ client: target.client, ms: start.gap });
    case 3:
      return Chaos.Fault.cases.abort.make({ target: "connection", name: target.client });
    case 4:
      return Chaos.Fault.cases.abort.make({ target: "process", name: target.name });
    case 5:
      return Chaos.Fault.cases.abort.make({ target: "project", name: target.name });
    case 6:
      return Chaos.Fault.cases.abort_all.make({});
    case 7:
      return Chaos.Fault.cases.fail_step.make({ process: target.process, times: 1 });
    case 8:
      return Chaos.Fault.cases.fail_step.make({ process: target.process, times: 3 });
    default:
      return Chaos.Fault.cases.revoke_key.make({ client: target.client, key: target.key });
  }
};

/**
 * Draws exactly one fault and returns the state for the following draw.
 *
 * @stability unstable
 * @category scheduling
 */
export const draw = (schedule: typeof Schedule.Type, start: typeof Chaos.Start.Type) => {
  const random = xoroshiro128plusFromState(schedule.words);
  const choice = uniformInt(random, 0, 9);
  return { fault: select(choice, start), schedule: Schedule.make({ version: 1, words: words(random.getState()) }) };
};
