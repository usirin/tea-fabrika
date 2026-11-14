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
// The counter's window, next/ (Tier 1, P14). It shows the checked count and offers the counter's
// three inputs as Manti buttons, named by the program's own words. It never steps the counter: a
// press goes to the brain as a letter, and the count changes when the checked view does.
import { defineWindow, type WindowProps } from "@kampus/libfabrika";
import { Button, Kbd } from "@manti-ui/react";
import { counter, counterKeys, counterModel } from "./program.ts";

type Props = WindowProps<typeof counter>;

const ACTIONS = [
  { m: { type: "inc" }, command: "counter.inc", label: counter.inputs.inc.description },
  { m: { type: "dec" }, command: "counter.dec", label: counter.inputs.dec.description },
  { m: { type: "reset" }, command: "counter.reset", label: counter.inputs.reset.description },
] as const;

export const CounterWindow = ({ data, press, hint }: Props) => (
  <div className="counter">
    <output className="counter-count" data-testid="count" aria-live="polite">
      {data.count}
    </output>
    <div className="counter-actions">
      {ACTIONS.map(({ m, command, label }) => {
        const key = hint?.(command) ?? null;
        return (
          <Button
            key={command}
            variant="secondary"
            size="sm"
            aria-keyshortcuts={key ?? undefined}
            onClick={() => press(m)}
            trailingIcon={key === null ? undefined : <Kbd aria-hidden="true">{key}</Kbd>}
          >
            {label}
          </Button>
        );
      })}
    </div>
  </div>
);

/** The counter's registration: its view data is the counter's own model schema (the one
 *  `counterMachine.model` holds), checked at runtime, and its keys are the default rows. */
export const counterWindow = defineWindow(counter, {
  data: counterModel,
  View: CounterWindow,
  keys: counterKeys,
});
