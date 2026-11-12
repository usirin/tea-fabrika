import type * as acp from "@agentclientprotocol/sdk/unstable";

// ACP's option kind is a display hint: Codex labels both its "no, go on" and
// its "no, and stop" `reject_once`, so the ids that end a maker's turn come
// from its harness row (`cancels`). Shared by the adapter and the `acp` program.

/** How a contained run says no to one permission request. */
type Refusal =
  /** A no that refuses this one request and lets the turn go on. */
  | { readonly _tag: "refuse"; readonly optionId: string }
  /** Every no offered would end the turn (or none is offered). */
  | { readonly _tag: "cannot" };

/**
 * The no to give. `cancels`: the option ids that end the maker's turn, from its harness row.
 * `reject_once` first, then `reject_always`, never an allow, never an id in `cancels`.
 */
export const refusal = (options: readonly acp.PermissionOption[], cancels: readonly string[]): Refusal => {
  const keeps = (kind: string) => options.find((o) => o.kind === kind && !cancels.includes(o.optionId));
  const no = keeps("reject_once") ?? keeps("reject_always");
  return no === undefined ? { _tag: "cannot" } : { _tag: "refuse", optionId: no.optionId };
};
