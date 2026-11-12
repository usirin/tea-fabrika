// Ticket 688, next/. Decision 0091: a folder of libfabrika is a module and its rank is a layer, so
// the old words do not come back as names in next/. oxlint's own `eslint/id-denylist` holds it
// (0040), from `.oxlintrc.json`'s `next/**` override, and this suite plants each edge case of the
// plan at a real path with the repo's own config.
//
// The rule reads names only. It reports a declaration, a reference to a declared name, an object
// key and a type member. It does not see a property read (`row.floor`), a call through a member
// (`Math.floor`), a comment or a string: those stay review work, since the word keeps other
// meanings there (a conversation room, a minimum).
import { describe, expect, it } from "vitest";
import { plant } from "../next/apps/fabrika/src/exam/plant.ts";

const denylist = "eslint(id-denylist)";

/** The config's list: the six spellings of each old word and the five compounds the plan names. */
const OLD = [
  "room",
  "rooms",
  "Room",
  "Rooms",
  "ROOM",
  "ROOMS",
  "floor",
  "floors",
  "Floor",
  "Floors",
  "FLOOR",
  "FLOORS",
  "otherRoom",
  "floorsByName",
  "floorRank",
  "floored",
  "unfloored",
] as const;

const APP = "next/apps/fabrika/src/plant";
const SRC = "next/packages/libfabrika/src";

const file = (...lines: ReadonlyArray<string>): string => ["// planted", ...lines, ""].join("\n");

/** A declaration on line 2, an object key on line 3 and a property read on line 4. */
const named = (name: string): string =>
  file(
    `export const ${name} = 1;`, // 2
    `export const row = { ${name}: 1 };`, // 3
    `export const read = (given: Readonly<Record<string, number>>) => given.${name};`, // 4: a read
  );

const declared = file("export const room = 1;"); // 2

describe("eslint/id-denylist: the old library words as names in next/", async () => {
  const files = {
    ...Object.fromEntries(OLD.map((name) => [`${APP}/old-${name}.ts`, named(name)])),
    [`${APP}/new.ts`]: file(
      "export const module = 1;",
      "export const modules = [module];",
      "export const layer = 2;",
      "export const layers = [layer];",
      "export const otherModule = (given: string) => given;",
      "export const layersByName = new Map<string, number>();",
      "export const layerRank = 0;",
      "export const ranked = true;",
    ),
    [`${APP}/arithmetic.ts`]: file(
      "export const half = (value: number) => Math.floor(value / 2);",
      "export const down = [1.5].map(Math.floor);",
    ),
    [`${APP}/words.ts`]: file(
      "// A conversation room keeps its word, and so does a floor that means a minimum.",
      "/** Leaves room for one more line, above the floor of ten. */",
      'export const text = "room, rooms, floor, floors";',
      "export const template = `a room on a floor`;",
    ),
    // Outside next/ the override does not apply: today's version, repo scripts, lead tooling. Never
    // `oxlint-plugins/`: `plant` links that folder in, so a file planted there lands in the repo.
    "packages/fabrika/src/plant.ts": declared,
    "apps/fabrika/src/plant.ts": declared,
    "scripts/plant.ts": declared,
    ".agents/skills/lead/scripts/plant.ts": declared,
    // A test in next/ is held as product code is.
    [`${APP}/plant.test.ts`]: declared,
    [`${SRC}/ledger/Plant.test.ts`]: declared,
    [`${APP}/plant.test.tsx`]: declared,
    // A conversation room is 0091's other meaning: one explained suppression, on its one line.
    [`${APP}/conversation.ts`]: file(
      "// oxlint-disable-next-line eslint/id-denylist -- a conversation room (0091), not a module",
      'export const room = { id: "lobby" };', // 3
      "export const floor = 2;", // 4: the neighbor the suppression does not reach
    ),
    // The renamed rule, configured as `fabrika/modules`, on the plan's plant of 0043.
    [`${SRC}/processes/Mailbox.ts`]: file('export {Rev} from "../ledger/Log.ts";'),
  };
  const linted = await plant(files);

  // Plant: drop the `next/**` override from `.oxlintrc.json`, or drop a name from its list.
  it("scenario: each listed name is reported where it is declared and as an object key, the config's closed list", () => {
    for (const name of OLD) {
      expect(linted(denylist, `${APP}/old-${name}.ts`), name).toEqual([2, 3]);
    }
  });

  // The rule's limit, written down so a change in it is seen: line 4 of each planted file reads
  // `given.<old name>` and is not reported.
  it("scenario: a property read through another object is not seen, the built-in rule's documented limit", () => {
    for (const name of OLD) {
      expect(linted(denylist, `${APP}/old-${name}.ts`), name).not.toContain(4);
    }
  });

  // Plant: add `module` or `layer` to the list.
  it("scenario: module, modules, layer, layers and the renamed compounds pass, the new words of 0091", () => {
    expect(linted(denylist, `${APP}/new.ts`)).toEqual([]);
  });

  it("scenario: Math.floor stays the JavaScript operation, the twelve arithmetic uses of the census", () => {
    expect(linted(denylist, `${APP}/arithmetic.ts`)).toEqual([]);
  });

  it("scenario: the words in comments and strings pass, since only review can tell their meaning", () => {
    expect(linted(denylist, `${APP}/words.ts`)).toEqual([]);
  });

  // Plant: widen the override's `files` to `**`.
  it("scenario: a file outside next/ is not held by the override, its scope as the plan sets it", () => {
    for (const path of [
      "packages/fabrika/src/plant.ts",
      "apps/fabrika/src/plant.ts",
      "scripts/plant.ts",
      ".agents/skills/lead/scripts/plant.ts",
    ]) {
      expect(linted(denylist, path), path).toEqual([]);
    }
  });

  // Plant: narrow the override's `files` to product files, `next/**/!(*.test).ts`.
  it("scenario: a test file in next/ is held as product code is, since 0062 gives tests no exemption", () => {
    for (const path of [`${APP}/plant.test.ts`, `${SRC}/ledger/Plant.test.ts`, `${APP}/plant.test.tsx`]) {
      expect(linted(denylist, path), path).toEqual([2]);
    }
  });

  // Plant: turn the suppression into a whole-file `oxlint-disable`.
  it("scenario: a suppressed conversation room passes on its one line and its neighbor is still reported", () => {
    expect(linted(denylist, `${APP}/conversation.ts`)).toEqual([4]);
  });

  // Plant: register the rule under its old name, or leave `fabrika/rooms` in `.oxlintrc.json`.
  it("scenario: the module checks fire under fabrika/modules and nothing answers to fabrika/rooms", () => {
    expect(linted("fabrika(modules)", `${SRC}/processes/Mailbox.ts`)).toEqual([2]);
    expect(linted("fabrika(rooms)", `${SRC}/processes/Mailbox.ts`)).toEqual([]);
  });
});
