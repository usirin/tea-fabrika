import { type ReactNode, useLayoutEffect, useRef } from "react";
import { type ProjectRow, type Recent, rows } from "../projects.ts";
import { agoWord } from "./frame.ts";
import { Caps, Foot, Marked, useOverlay } from "./pop.tsx";

// Where a person picks a project: the welcome page, when a window shows no project yet, and the
// projects box over a project's desk (Cmd-O, File > Open Project…, the top bar's project button).
// Today's app, ticket 276, PR 1 (docs/direction/project-window.md). Both list the same rows
// (projects.ts, `rows`): recent projects by name, their place in faint text and when each was last
// opened, and Open Folder… last, always, which shows the system's folder sheet.
//
//   <Welcome recent={recent} selected="folder" now={Date.now()} onOpen={open} onFolder={sheet} />
//   <Projects rows={rows} query="" selected={rows[0].id} onQuery onMove onOpen onClose />
//
// Welcome has no tiles and no tsh: no host runs for a window that shows no project. The box is a
// WAI-ARIA combobox in a modal dialog, as the palette is (pop.tsx), with its count in a polite
// live region a screen reader hears as it changes.

/** When a row's project was opened, or `open` while its window is. */
const whenWord = (at: number | "open", now: number): string =>
  at === "open" ? "open" : agoWord(Math.max(0, now - at));

/** Why the last folder or move was refused, and what the person can do next. */
export type Refusal =
  /** The folder picked is no project: choose another. */
  | { readonly _tag: "folder"; readonly why: string }
  /** The old desk did not move: try again once it can. */
  | { readonly _tag: "migration"; readonly why: string };

export interface WelcomeProps {
  readonly recent: readonly Recent[];
  /** The row selected: a project's key, or `folder`. */
  readonly selected: string;
  readonly now: number;
  readonly onOpen: (key: string) => void;
  readonly onFolder: () => void;
  readonly refusal?: Refusal | null;
  /** Try the refused move again. */
  readonly onRetry?: () => void;
  /** The welcome rows' keys: moving the selection, for the arrows. */
  readonly onSelect?: (id: string) => void;
  /** Focus the selected row once more: Cmd-O on welcome (P27). Counts up on each press. */
  readonly focusTick?: number;
}

/** The welcome page: what a window shows before it shows a project. */
export function Welcome(props: WelcomeProps): ReactNode {
  const list = useRef<HTMLDivElement>(null);
  // The same rows the box lists (P21): welcome shows no project, so it leaves none out.
  const shown = rows(props.recent);
  const selected = shown.some((r) => r.id === props.selected) ? props.selected : (shown[0]?.id ?? "folder");
  const act = (row: ProjectRow) => (row._tag === "folder" ? props.onFolder() : props.onOpen(row.id));
  const tick = props.focusTick ?? 0;
  useLayoutEffect(() => {
    if (tick === 0) {
      return;
    }

    list.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.focus();
  }, [tick]);
  const move = (by: number) => {
    const at = shown.findIndex((r) => r.id === selected);
    const next = shown[(at + by + shown.length) % shown.length];

    if (next !== undefined) {
      props.onSelect?.(next.id);
      list.current?.querySelector<HTMLElement>(`[data-row="${next.id}"]`)?.focus();
    }
  };
  return (
    <main className="welcome" aria-labelledby="welcome-title">
      <div className="welcome-body">
        <h1 id="welcome-title">Open a folder to start</h1>
        <p className="welcome-sub">Each folder opens in its own window, with its own agents and jobs.</p>
        {props.refusal != null && (
          <div className="welcome-refusal" role="alert">
            <p>{props.refusal.why}</p>
            {props.refusal._tag === "folder" ? (
              <button type="button" onClick={props.onFolder}>
                Choose Folder…
              </button>
            ) : (
              <button type="button" onClick={props.onRetry}>
                Try Again
              </button>
            )}
          </div>
        )}
        <div
          ref={list}
          className="welcome-rows"
          role="listbox"
          aria-label="Recent projects"
          // The selected row holds the tab stop (roving focus); the list is focused only by script.
          tabIndex={-1}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              move(1);
            } else if (e.key === "ArrowUp") {
              move(-1);
            } else if (e.key === "Enter") {
              const row = shown.find((r) => r.id === selected);

              if (row !== undefined) {
                act(row);
              }
            } else {
              return;
            }

            e.preventDefault();
          }}
        >
          {shown.map((row) => (
            // oxlint-disable-next-line jsx-a11y/click-events-have-key-events -- the listbox takes the keys (Enter and the arrows); this is its option for the pointer.
            <div
              key={row.id}
              data-row={row.id}
              className={`welcome-row${row.id === selected ? " on" : ""}`}
              role="option"
              tabIndex={row.id === selected ? 0 : -1}
              aria-selected={row.id === selected}
              onClick={() => act(row)}
            >
              <span className="name">{row.name}</span>
              {row._tag === "recent" && (
                <>
                  <span className="path faint">{row.path}</span>
                  <span className="when">{whenWord(row.at, props.now)}</span>
                </>
              )}
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}

export interface ProjectsProps {
  /** The rows that match the query, Open Folder… last. */
  readonly rows: readonly ProjectRow[];
  readonly query: string;
  /** The row selected, by its id: a query or a late list never moves it to another project. */
  readonly selected: string;
  readonly now?: number;
  readonly onQuery: (query: string) => void;
  readonly onMove: (by: number) => void;
  /** Open the row with this id. */
  readonly onOpen: (id: string) => void;
  readonly onClose: () => void;
}

/** The box's id, which the top bar's project button controls. */
export const PROJECTS_BOX = "pop-projects";

const PROJECTS_FOOT = [
  { caps: ["↑", "↓"], name: "Move" },
  { caps: ["↵"], name: "Open" },
  { caps: ["Esc"], name: "Close" },
];

const countWord = (n: number) => `${n} result${n === 1 ? "" : "s"}`;

/** The projects box: switch to another project, or open a folder in a window of its own. */
export function Projects(props: ProjectsProps): ReactNode {
  const box = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const list = `${PROJECTS_BOX}-list`;
  const optionId = (id: string) => `${PROJECTS_BOX}-o-${id}`;
  useOverlay(box, PROJECTS_BOX, () => input.current?.focus(), props.onClose, true);
  const selected = props.rows.some((r) => r.id === props.selected) ? props.selected : (props.rows[0]?.id ?? "folder");
  useLayoutEffect(() => {
    document.getElementById(optionId(selected))?.scrollIntoView({ block: "nearest" });
  });
  const now = props.now ?? Date.now();
  return (
    <>
      <div className="scrim" aria-hidden="true" />
      <div
        ref={box}
        id={PROJECTS_BOX}
        className="pop palette projects"
        role="dialog"
        aria-modal="true"
        aria-label="Open a project…"
        data-over=""
      >
        <input
          ref={input}
          className="find"
          role="combobox"
          aria-label="Find a project"
          aria-expanded="true"
          aria-controls={list}
          aria-autocomplete="list"
          aria-activedescendant={optionId(selected)}
          value={props.query}
          placeholder="Open a project…"
          spellCheck={false}
          onChange={(e) => props.onQuery(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              props.onMove(1);
            } else if (e.key === "ArrowUp") {
              props.onMove(-1);
            } else if (e.key === "Enter") {
              props.onOpen(selected);
            } else if (e.key !== "Tab") {
              return;
            }

            e.preventDefault();
          }}
        />
        <div className="list" id={list} role="listbox" aria-label="Projects">
          {props.rows.map((row) => (
            // oxlint-disable-next-line jsx-a11y/click-events-have-key-events -- the text box takes the keys (aria-activedescendant); this is its option for the pointer.
            <div
              key={row.id}
              id={optionId(row.id)}
              className={`pop-cmd${row.id === selected ? " on" : ""}`}
              role="option"
              tabIndex={-1}
              aria-selected={row.id === selected}
              onPointerDown={(e) => e.preventDefault()}
              onClick={() => props.onOpen(row.id)}
            >
              <span className="text">
                <span className="name">
                  <Marked text={row.name} query={props.query} />
                </span>
                {row._tag === "recent" && (
                  <span className="word path faint">
                    <Marked text={row.path} query={props.query} />
                  </span>
                )}
              </span>
              {row._tag === "recent" ? (
                <span className={row.at === "open" ? "when open" : "when"}>{whenWord(row.at, now)}</span>
              ) : (
                <Caps caps={row.caps} />
              )}
            </div>
          ))}
        </div>
        <div className="pop-count">
          <span className="count" role="status" aria-live="polite">
            {countWord(props.rows.length)}
          </span>
          <Foot hints={PROJECTS_FOOT} />
        </div>
      </div>
    </>
  );
}
