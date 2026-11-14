// Experiment 285, next/. The brain's two build plugins, as `next/packages/libfabrika/src/node/build/build.ts`
// has them on main. That file keeps both private, so they are written again here for the run. Slice
// S8 hands the real ones to Alchemy.
import { compile } from "@kampus/libfabrika/compiler";
import type { Plugin } from "rolldown";

type Tables = {
  readonly programs: Readonly<Record<string, { readonly hash: string; readonly source: string }>>;
  readonly assets: Readonly<Record<string, { readonly hash: string; readonly type: string; readonly body: string }>>;
};

const BUILT_MODULE = "virtual:fabrika-built";
const TEXT = "\0fabrika-text:";

/** What the compiler plugin saw, so a run can say the plugin ran and what it was given. */
export type Seen = { builds: number; files: number; typed: number; memoized: number };

/** The React Compiler step on every `.tsx` file a bundle reaches. */
export const compiler = (seen: Seen): Plugin => ({
  name: "fabrika-compiler",
  buildStart() {
    seen.builds++;
  },
  transform(code, id) {
    if (!id.endsWith(".tsx")) {
      return;
    }

    const out = compile(id, code).code;
    seen.files++;
    // Still TypeScript means this plugin ran before the bundler's own transform.
    seen.typed += code.includes("readonly n: number") ? 1 : 0;
    seen.memoized += out.includes("react/compiler-runtime") ? 1 : 0;
    return { code: out };
  },
});

/** The brain's tables, with every compiled body as a text module: embedded, never parsed as code. */
export const embed = (tables: Tables): Plugin => {
  const texts: Array<string> = [];
  const text = (body: string) => `t${texts.push(body) - 1}`;
  const programs = Object.entries(tables.programs).map(
    ([name, p]) => `${JSON.stringify(name)}: {hash: ${JSON.stringify(p.hash)}, source: ${text(p.source)}}`,
  );
  const assets = Object.entries(tables.assets).map(
    ([route, a]) =>
      `${JSON.stringify(route)}: {hash: ${JSON.stringify(a.hash)}, type: ${JSON.stringify(a.type)}, body: ${text(a.body)}}`,
  );
  const imports = texts.map((_, n) => `import t${n} from ${JSON.stringify(`${TEXT}${n}`)};`);
  const code = [
    ...imports,
    `export const programs = {${programs.join(", ")}};`,
    `export const assets = {${assets.join(", ")}};`,
  ].join("\n");
  return {
    name: "fabrika-built",
    resolveId(id) {
      if (id === BUILT_MODULE) {
        return `\0${BUILT_MODULE}`;
      }

      if (id.startsWith(TEXT)) {
        return id;
      }
    },
    load(id) {
      if (id === `\0${BUILT_MODULE}`) {
        return code;
      }

      if (id.startsWith(TEXT)) {
        return { code: texts[Number(id.slice(TEXT.length))] ?? "", moduleType: "text" };
      }
    },
  };
};

/**
 * The same tables as files: one module and one `.txt` file a body, which Alchemy's bundler reads as
 * text. A build option can then point the table's module name at the module by an alias, with no plugin.
 */
export const tableFiles = (tables: Tables): Readonly<Record<string, string>> => {
  const files: Record<string, string> = {};
  const text = (body: string) => {
    const n = Object.keys(files).length;
    files[`t${n}.txt`] = body;
    return `t${n}`;
  };
  const programs = Object.entries(tables.programs).map(
    ([name, p]) => `${JSON.stringify(name)}: {hash: ${JSON.stringify(p.hash)}, source: ${text(p.source)}}`,
  );
  const assets = Object.entries(tables.assets).map(
    ([route, a]) =>
      `${JSON.stringify(route)}: {hash: ${JSON.stringify(a.hash)}, type: ${JSON.stringify(a.type)}, body: ${text(a.body)}}`,
  );
  const imports = Object.keys(files).map((file, n) => `import t${n} from ${JSON.stringify(`./${file}`)};`);
  files["built.js"] = [
    ...imports,
    `export const programs = {${programs.join(", ")}};`,
    `export const assets = {${assets.join(", ")}};`,
  ].join("\n");
  return files;
};
