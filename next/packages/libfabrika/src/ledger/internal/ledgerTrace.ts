// The ledger's span tag keys, shared by the store and the remote layer (0095).

/** Span tag keys: OpenTelemetry's messaging names where they fit, `fab.ledger.*` for the rest. */
/** @internal */
export const STREAM = "messaging.destination.name";
/** @internal */
export const tag = (name: string): string => `fab.ledger.${name}`;
