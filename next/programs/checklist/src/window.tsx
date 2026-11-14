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
import { defineWindow, type TileProps, type WindowProps } from "@kampus/libfabrika";
import { Button, Checkbox, Input } from "@manti-ui/react";
import { useId } from "react";
import { checklist, checklistView } from "./program.ts";
import { tile } from "./tile.ts";

type Props = WindowProps<typeof checklist> & TileProps<typeof tile>;
const states = { new: "Open", open: "Open", late: "Late", checked: "Done" } as const;

/** A click asks the brain. Only a checked view changes a box or the list. */
const ChecklistWindow = ({ data, press, tile: own, send, refusal }: Props) => {
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
