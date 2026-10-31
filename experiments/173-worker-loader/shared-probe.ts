// Part 2, design A: a tiny library sent as its own module, with state at module level. Two
// program versions that load the same bytes of it: do they share one copy (one count), or does
// each isolate get its own?
let n = 0;
export const bump = () => ++n;
