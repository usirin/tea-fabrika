// The module a brain imports its built tables from. `build.ts` generates it: each selected
// program's compiled source with its hash, and each window file under its route, all as text.
declare module "virtual:fabrika-built" {
  export const programs: Readonly<Record<string, import("./app/built.ts").BuiltProgram>>;
  export const assets: Readonly<Record<string, import("./app/built.ts").Asset>>;
}
