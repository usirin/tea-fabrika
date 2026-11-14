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
import { defineWindow, type TileProps, type WindowProps } from "@kampus/libfabrika";
import { Button, Checkbox, Input } from "@manti-ui/react";
import { useId } from "react";
import { checklist, checklistView } from "./program.ts";
import { tile } from "./tile.ts";

/**
 * x-ci-plant-2 middle: every line below this one moves down by three.
 */
type Props = WindowProps<typeof checklist> & TileProps<typeof tile>;
const states = { new: "Open", open: "Open", late: "Late", checked: "Done" } as const;

/** A click asks the brain. Only a checked view changes a box or the list. */
const ChecklistWindow = ({ data, press, tile: own, send, refusal }: Props) => {/** x-ci-plant-2 inner: defineMachine( and syncTest( in a function body. */ 
  const description = useId();
  return (
    <div className="checklist">
      {data.items.length === 0 ? (
        <p>Nothing on the list yet.</p>
      ) : (
        <ul className="checklist-items">
          {data.items.map((item) => (
            <li className="checklist-row" key={item.name}>
              <Checkbox
                checked={item.state === "checked"}
                aria-label={item.name}
                onCheckedChange={() => press({ type: item.state === "checked" ? "uncheck" : "check", name: item.name })}
              >
                <span className="checklist-name">{item.name}</span>
              </Checkbox>
              <span className="checklist-state">{states[item.state]}</span>
              <Button
                variant="tertiary"
                size="sm"
                aria-label={`Remove ${item.name}`}
                onClick={() => press({ type: "remove", name: item.name })}
              >
                Remove
              </Button>
            </li>
          ))}
        </ul>
      )}
      <p className="checklist-left">{data.left} left</p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          send({ type: "submit" });
        }}
      >
        <Input
          type="text"
          aria-label={checklist.inputs.add.description}
          maxLength={80}
          value={own.draft}
          aria-describedby={refusal ? description : undefined}
          onChange={(event) => send({ type: "typed", text: event.target.value })}
        />
        <p id={description} className="checklist-refusal">
          {refusal ?? ""}
        </p>
      </form>
    </div>
  );
};

const refused = (m: typeof checklist.machine.msg.Type, reason: string): string => {
  if (m.type !== "timer" && (reason === "missing" || (reason === "taken" && m.type === "add"))) {
    return reason === "taken" ? `"${m.name}" is already on the list.` : `"${m.name}" is not on the list any more.`;
  }

  return /^[a-z_]{1,40}$/.test(reason) ? `Not done (${reason}).` : "Not done.";
};

export const checklistWindow = defineWindow(checklist, {
  data: checklistView,
  View: ChecklistWindow,
  keys: {},
  tile,
  refused,
});
