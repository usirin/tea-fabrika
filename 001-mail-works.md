FYI: the mail branch for ticket 955 works, and the lane has started.

- Lane branch: `fabrikalfa/cloud-t955-sink-cut`, at the parent's head `798e3d692`.
- Node 26.13.0 and pnpm 12.16.1 are installed, and `pnpm install --frozen-lockfile` passed.
- Read so far: decision 0186, the current cut in `next/packages/libfabrika/src/telemetry/Sink.ts`,
  and the earlier cut at `f83e0e9e8`.
- A first finding about the brief: the earlier cut fixes the unmatched-parenthesis case
  (`at fn (<root>/a)b/c.ts:1:2)` becomes `at fn (c.ts:1:2)`). It does not fix the `\r` case: its
  frame pattern `/^(\s*at )(.*?)( \{)?$/` matches no line that ends in `\r`, so it stores that line
  whole too. The lane still plants and fixes both cases. Only the claim that the earlier cut
  handled `\r` is wrong.
