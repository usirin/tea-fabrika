import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { parse } = require(process.cwd() + "/node_modules/.pnpm/@babel+parser@8.0.8/node_modules/@babel/parser");
const file = process.argv[2];
const src = readFileSync(file, "utf8");
const ast = parse(src, { sourceType: "module", plugins: ["typescript"] });
const out = [];
const walk = (n) => {
  if (!n || typeof n.type !== "string") return;
  if (n.type === "CallExpression" && n.callee.type === "Identifier" && (n.callee.name === "it" || n.callee.name === "describe")) {
    const a = n.arguments[0];
    out.push({ kind: n.callee.name, start: n.loc.start.line, end: n.loc.end.line, title: src.slice(a.start, a.end).slice(0, 110) });
  }
  for (const k of Object.keys(n)) { const v = n[k]; if (Array.isArray(v)) v.forEach(walk); else if (v && typeof v === "object" && k !== "loc") walk(v); }
};
walk(ast.program);
for (const o of out) console.log([o.kind, o.start, o.end, o.end - o.start + 1, o.title].join("\t"));
