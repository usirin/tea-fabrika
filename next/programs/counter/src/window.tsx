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
// The counter's window, next/ (Tier 1, P14). It shows the checked count and offers the counter's
// three inputs as Manti buttons, named by the program's own words. It never steps the counter: a
// press goes to the brain as a letter, and the count changes when the checked view does.
import { defineWindow, type WindowProps } from "@kampus/libfabrika";
import { Button, Kbd } from "@manti-ui/react";
import { counter, counterKeys, counterModel } from "./program.ts";

/**
 * x-ci-plant-2 middle: every line below this one moves down by three.
 */
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
      {ACTIONS.map(({ m, command, label }) => {/** x-ci-plant-2 inner: defineMachine( and syncTest( in a function body. */ 
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
