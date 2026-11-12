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
