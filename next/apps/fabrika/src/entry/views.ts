import { checklistWindow } from "@kampus/checklist/window";
import { fabshWindow } from "@kampus/fabsh/window";
import { windowMachineFor } from "@kampus/libfabrika/client/WindowMachine";
import { Schema } from "effect";

// `fabsh:1` is a fixed tile beside the checklist, the seam until the desk starts fabsh as a new
// tile's default process (0275).
export const tiles = [
  { id: "tile_1", name: "checklist:1" },
  { id: "tile_2", name: "fabsh:1" },
];

export const windowFor = (name: string) =>
  name === "checklist:1" ? checklistWindow : name === "fabsh:1" ? fabshWindow : null;

// A view is decoded by its shape: the checklist's and fabsh's views share no field.
export const window = windowMachineFor({
  decode: () => Schema.decodeUnknownSync(Schema.Union([checklistWindow.data, fabshWindow.data])),
  tile: (name) => windowFor(name)?.tile,
});
