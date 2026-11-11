// Program mail's pure rules, next/ (P41 slice 1): a delivery's ID and the host's grant.
import type { Grants } from "../ProgramMail.ts";

/**
 * A delivery's ID: its dispatched command's one child under `/mail`. Never `/answer`, which is the
 * runner's own reply space, so peer mail never passes as a runner's own letter.
 * @internal
 */
export const mailId = (command: string): string => `${command}/mail`;

/**
 * Whether the host's grant lets `source` reach `to`: only a source's own entry counts, never an
 * inherited key.
 * @internal
 */
export const granted = (grants: Grants, source: string, to: string): boolean =>
  Object.hasOwn(grants, source) && (grants[source] ?? []).includes(to);

/** The business `ref` a message carries, if it has one. @internal */
export const businessRef = (m: unknown): string | null =>
  typeof m === "object" && m !== null && "ref" in m && typeof m.ref === "string" ? m.ref : null;
