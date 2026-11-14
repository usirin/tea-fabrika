/**
 * x-ci-plant-1: a comment-only plant for experiment 288, never merged.
 *
 * Line 01 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 02 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 03 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 04 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 05 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 06 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 07 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 08 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 09 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 10 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 11 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 12 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 13 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 14 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 15 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 16 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 17 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 18 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 19 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 20 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 21 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 22 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 23 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 24 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
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

const select = (choice: number, start: typeof Chaos.Start.Type): Chaos.Fault => {
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
