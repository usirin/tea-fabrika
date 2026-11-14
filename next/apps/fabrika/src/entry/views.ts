import type { checklist } from "@kampus/checklist";
import { checklistWindow } from "@kampus/checklist/window";
import { windowMachineFor } from "@kampus/libfabrika/client/WindowMachine";
import { Schema } from "effect";

export const tiles = [{ id: "tile_1", name: "checklist:1" }];
export const windowFor = (name: string) => (name === "checklist:1" ? checklistWindow : null);

export const window = windowMachineFor<typeof checklist>({
  decode: () => Schema.decodeUnknownSync(checklistWindow.data),
  tile: (name) => windowFor(name)?.tile,
});
