import { readFileSync } from "node:fs";
const r = JSON.parse(readFileSync(process.argv[2], "utf8"));
const ms = Object.values(r.files).flatMap((f) => f.mutants);
const by = {};
for (const m of ms) by[m.status] = (by[m.status] ?? 0) + 1;
console.log(JSON.stringify(by), "total", ms.length);
if (process.argv[3]) for (const m of ms.filter((m) => m.status === process.argv[3])) console.log(m.id, m.location.start.line + ":" + m.location.start.column, m.mutatorName, JSON.stringify(m.replacement).slice(0, 80));
