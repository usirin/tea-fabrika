// `@kampus/fabrika-old/agents/summon`: agents a person summons by name, in their repository. The
// host's manager of them, which starts each on `acp` in Node, and `turn`, the program one said
// line runs as. tsh asks for the manager as `Shell.SummonManager`.

export { SummonedNow, summonManager } from "./summon/manager.ts";
export { turnProgram } from "./summon/turn.ts";
