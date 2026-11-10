import type { EventEmitter } from "node:events";
import type { WindowReport } from "./electron-launch.ts";

/** Synchronous native event recording. Node laws supply emitters instead of Electron. */
export function install(input: {
  readonly app: Pick<EventEmitter, "on" | "once"> & { isReady(): boolean };
  readonly screen: Pick<EventEmitter, "on"> & {
    getPrimaryDisplay(): { workArea: { x: number; y: number; width: number; height: number } };
  };
  readonly id: string;
  readonly pid: number;
  readonly now?: () => number;
  readonly write: (report: WindowReport) => void;
}): { report(): WindowReport };
