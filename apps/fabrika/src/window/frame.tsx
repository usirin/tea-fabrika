import { Dialog } from "@manti-ui/react";
import {
  type ReactNode,
  type RefObject,
  useCallback,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import type { AsksNow } from "../asks.ts";
import { activeOf, focusedOf, type Open } from "../desk/desk.ts";
import type { Keys } from "../desk/keymap.ts";
import { type Group, wordOf } from "../desk/keys.ts";
import type { Editor, EditorMsg } from "../keys/machine.ts";
import type { Snapshot } from "../keys/program.ts";
import { KeysWindow } from "../keys/window.tsx";
import type { FromPage, HostNow, LinkNow, SummonedOn, ToApp } from "../messages.ts";
import type { Project, ProjectRow } from "../projects.ts";
import {
  agentsWord,
  asksSections,
  asksWord,
  bottomLineShows,
  type Command,
  clockWord,
  commandsOf,
  fileWord,
  type Frame,
  type FrameMsg,
  frameUpdate,
  hereWord,
  holdsWord,
  hostWord,
  INFO,
  infoFor,
  type JobItem,
  jobItem,
  jobsList,
  lineIn,
  matching,
  middleFree,
  modeWord,
  nowhereNote,
  opensOf,
  type Part,
  prefixLine,
  projectRowsFor,
  questionWord,
  restartedWord,
  type Shapes,
  syncWord,
  type TicketsShown,
  tileWord,
  workspaceName,
} from "./frame.ts";
import { type Cap, type Hint, type Row, sentence, type Words } from "./pop.ts";
import { type Empty, IconOf, Lines, Menu, Palette, Panel, useTip, WordsOf } from "./pop.tsx";
import { PROJECTS_BOX, Projects } from "./projects.tsx";

// The window's frame, drawn: the top bar, the bottom line, and what opens over the desk (the
// asks list, the jobs list, the palette, an item's few lines). Its words are frame.ts's; this file only lays
// them out. Every item is a button with a tooltip (its name, keys and tsh word, pop.tsx) and, in info mode,
// a line of plain words (`data-info`). No item has a background: plain words, ` · ` between them.
// The bars stay monospace, as a terminal's status line; what opens over the desk is drawn by
// pop.tsx, in the program windows' own font (docs/direction/popovers.md).

/** The element id of each thing that opens over the desk: its opener names it in `aria-controls`. */
const POP = {
  asks: "pop-asks",
  jobs: "pop-jobs",
  lines: "pop-lines",
  palette: "pop-palette",
} as const;

/** What the frame is drawn from, and how it sends. */
export interface FrameProps {
  readonly desk: Open | null;
  readonly frame: Frame;
  readonly asks: AsksNow | null;
  /** The host as it says of itself: its process, its ledger, its agents. `null` until it says. */
  readonly host: HostNow | null;
  readonly link: LinkNow;
  /** A desk came once: a link down after it is the host down, not a first connect. */
  readonly attachedOnce: boolean;
  /** The keys file's table, as the host sent it (desk/keymap.ts): the defaults until it says. */
  readonly keys: Keys;
  readonly keysEditor?: Editor | null;
  readonly editKeys?: (msg: EditorMsg) => void;
  readonly keyChanges?: Snapshot["changes"];
  readonly shapes: Shapes;
  readonly tickets: TicketsShown;
  readonly armed: boolean;
  readonly toHost: (m: FromPage) => void;
  readonly toApp: (m: ToApp) => void;
  /** One of a run's own inputs, as its window would send it: `{type: "query", value: {ticket: 2}}`. */
  readonly toRun: (run: string, msg: unknown) => void;
  readonly step: (m: FrameMsg) => void;
  /** The project this window shows, and its name as the title says it (ticket 276). */
  readonly project?: Project | undefined;
  readonly name?: string | undefined;
  /** The projects box's rows: every other recent project, and Open Folder… last. */
  readonly projectRows?: readonly ProjectRow[];
}

/** ` · `, between two words of the frame. */
const Sep = () => <span className="sep">·</span>;

/** The palette's command by its name, with every workspace there could be. */
const commandNamed = (props: FrameProps, name: string): Command | undefined =>
  commandsOf(props.keys, 9).find((c) => c.name === name);

/** The key a name's command is on, as the bars write it, or `null`: no key runs it. */
const keyFor = (props: FrameProps, name: string): string | null => {
  const command = commandNamed(props, name);
  return command === undefined || command.caps.length === 0 ? null : command.key;
};

/** The key a name's command is on, as keycaps for its tooltip: `⌃B` `A`. None when nothing is bound. */
const capsFor = (props: FrameProps, name: string): readonly Cap[] => commandNamed(props, name)?.caps ?? [];

/** The tsh word of a name's command, or `null`. */
const wordFor = (props: FrameProps, name: string): string | null => commandNamed(props, name)?.tsh ?? null;

/** No tooltip shows while something lies over the desk, or while info mode explains the item. */
const quietOf = (frame: Frame): boolean => frame.over.kind !== "none" || frame.info.kind === "on";

/** What a frame item opens, if anything: a menu or a dialog, by its element's id. */
interface Opens {
  readonly popup: "menu" | "dialog";
  readonly id: string;
  readonly open: boolean;
}

/** A frame item: a button of plain words, with its tooltip and its info line. */
function Item(props: {
  readonly name: string;
  /** The name is a typed word, a program's: its tooltip draws it in mono. */
  readonly typed?: boolean;
  readonly caps: readonly Cap[];
  /** The tsh word that does the same, typed in a tile; `null` for Try again, which no word does. */
  readonly word: string | null;
  readonly quiet: boolean;
  readonly info: string;
  /** What a screen reader names it, when its words alone do not: an icon with no word. */
  readonly label?: string;
  readonly className?: string | undefined;
  readonly current?: boolean;
  /** A toggle button's state, as `aria-pressed`: its name stays, and this says on or off. */
  readonly pressed?: boolean;
  readonly opens?: Opens;
  readonly onClick: () => void;
  readonly children: ReactNode;
}): ReactNode {
  const tip = useTip(
    {
      name: props.typed === true ? props.name : sentence(props.name),
      typed: props.typed === true,
      caps: props.caps,
      word: props.word,
    },
    props.quiet,
  );
  return (
    <>
      <button
        type="button"
        className={`fb${props.className === undefined ? "" : ` ${props.className}`}`}
        data-info={props.info}
        data-item={props.name}
        aria-label={props.label}
        aria-current={props.current}
        aria-pressed={props.pressed}
        aria-haspopup={props.opens?.popup}
        aria-expanded={props.opens?.open}
        aria-controls={props.opens?.id}
        {...tip.on}
        onPointerDown={(e) => e.preventDefault()}
        onClick={props.onClick}
      >
        {props.children}
      </button>
      {tip.node}
    </>
  );
}

/**
 * A name as the bar draws it: the folder's name, which may be cut, and the parent folders that tell
 * two of the same name apart (project.ts, `titles`), which never are.
 *
 *   twinOf("repo · left")   {name: "repo", twin: "left"}
 */
const twinOf = (full: string): { readonly name: string; readonly twin: string | null } => {
  const at = full.lastIndexOf(" · ");
  return at < 0 ? { name: full, twin: null } : { name: full.slice(0, at), twin: full.slice(at + 3) };
};

/**
 * The project this window shows, first in the top bar: a button by the ARIA APG's dialog button,
 * whose full name says what it is and does, with a chevron since it opens the projects box. Long
 * names are cut by the bar's width; the title keeps the whole one. It is never a drag region.
 */
function ProjectButton(props: FrameProps & { readonly name: string }): ReactNode {
  const open = props.frame.over.kind === "palette" && props.frame.over.source._tag === "projects";
  const shown = twinOf(props.name);
  return (
    <button
      type="button"
      className="fb project"
      data-info={INFO.project}
      data-item="project"
      aria-label={`Project ${props.name}, switch project`}
      aria-haspopup="dialog"
      aria-expanded={open}
      aria-controls={PROJECTS_BOX}
      title={props.name}
      onClick={() =>
        props.step(
          open
            ? { type: "close" }
            : { type: "projects", rows: props.projectRows ?? [], focus: "button:project", press: "button" },
        )
      }
    >
      <span className="project-name">{shown.name}</span>
      {shown.twin !== null && <span className="project-twin">{` · ${shown.twin}`}</span>}
      <span className="chevron" aria-hidden="true">
        ▾
      </span>
    </button>
  );
}

/** The projects box over the desk: picking a row closes it, then the app opens that project. */
function ProjectsBox(props: FrameProps): ReactNode {
  const { frame, step } = props;
  const close = useCallback(() => step({ type: "close" }), [step]);

  if (frame.over.kind !== "palette") {
    return null;
  }

  const { rows, query, selected } = frame.over;
  return (
    <Projects
      rows={projectRowsFor(rows, query)}
      query={query}
      selected={selected}
      onQuery={(q) => step({ type: "query", query: q })}
      onMove={(by) => step({ type: "move", by, of: rows.length })}
      onOpen={(id) => {
        // The app is told what the frame's own step opened, with the press that showed the box.
        const enter = { type: "project_enter", id } as const;
        const opening = frameUpdate(frame, enter).opening;
        step(enter);

        if (opening !== null && opening !== frame.opening) {
          props.toApp(
            opening.id === "folder"
              ? { type: "folder", source: opening.source }
              : { type: "open", key: opening.id, source: opening.source },
          );
        }
      }}
      onClose={close}
    />
  );
}

/** The host's own words are its own: while the app is not attached, they may be old, and are not shown. */
const onHost = (link: LinkNow): boolean => link.kind === "up" || link.kind === "build";

/** The host as it said last, while the app is on it; else `null`. */
const reachedOf = (props: FrameProps): HostNow | null =>
  props.host !== null && onHost(props.link) ? props.host : null;

/**
 * The top bar: the whole desk. Workspaces, the line, then the asks, the agents and the sync, each
 * drawn only while it has something to say, and the host: a quiet icon while it is up, a word with
 * its own shape when it is not.
 */
export function TopBar(props: FrameProps): ReactNode {
  const { desk, asks, step } = props;
  const ws = desk === null ? null : activeOf(desk);
  const line = ws === null ? [] : lineIn(ws);
  const reached = reachedOf(props);
  const agents = reached === null ? null : agentsWord(reached);
  const sync = asks === null || reached === null ? null : syncWord(asks, reached.ledger);
  const host = hostWord(props.link, props.attachedOnce);
  const asking = asks === null ? null : asksWord(asks.asks.length);
  const unseen = asks?.asks.filter((a) => !a.seen).length ?? 0;
  const quiet = quietOf(props.frame);
  const over = props.frame.over;
  const lines = (what: Part): Opens => ({
    popup: "dialog",
    id: POP.lines,
    open: over.kind === "item" && over.what === what,
  });
  const bar = useRef<HTMLElement>(null);
  const brand = useRef<HTMLDivElement>(null);
  const free = useFreeMiddle(bar, brand, desk !== null);
  return (
    <header className="topbar" ref={bar}>
      <div className="lights-room" aria-hidden="true" />
      {props.project !== undefined && props.name !== undefined && <ProjectButton {...props} name={props.name} />}
      {desk !== null && (
        <nav className="workspaces" aria-label="workspaces">
          {desk.workspaces.map((w, i) => (
            <Item
              key={w.id}
              name={`workspace ${i + 1}`}
              caps={i < 9 ? capsFor(props, `workspace ${i + 1}`) : []}
              word={wordOf({ kind: "pick", at: i + 1 })}
              quiet={quiet}
              info={infoFor(props.keys).workspace}
              current={w.id === desk.active}
              onClick={() => props.toHost({ type: "pick", workspace: w.id })}
            >
              <span className="num">{i + 1}</span> {workspaceName(w, props.tickets)}
            </Item>
          ))}
        </nav>
      )}
      <nav className="line" aria-label="the line">
        {line.length === 0 && ws !== null && <span className="seg plain">tsh</span>}
        {line.map((s, i) => (
          <span key={s.tile} className="seg-pair">
            {i > 0 && (
              <span className="pipe" data-info={INFO.pipe}>
                |
              </span>
            )}
            <Item
              name={s.program}
              typed
              caps={[]}
              word={wordOf({ kind: "go", tile: s.tile })}
              quiet={quiet}
              info={INFO.segment}
              className={`seg${s.focused ? " on" : ""}`}
              onClick={() => props.toHost({ type: "go", tile: s.tile })}
            >
              {s.program}
            </Item>
          </span>
        ))}
      </nav>
      <div className="drag" data-info={INFO.drag} />
      <div className="right">
        {asks === null && (
          <>
            <span className="quiet">reading the ledger</span>
            <Sep />
          </>
        )}
        {asking !== null && (
          <>
            <Item
              name="asks"
              caps={capsFor(props, "asks")}
              word={wordFor(props, "asks")}
              quiet={quiet}
              info={INFO.asks}
              className="accent"
              opens={{ popup: "menu", id: POP.asks, open: over.kind === "asks" }}
              onClick={() => step({ type: "show", what: "asks" })}
            >
              {asking}
              {unseen > 0 && <span className="udot" role="img" aria-label={`${unseen} not seen`} />}
            </Item>
            <Sep />
          </>
        )}
        {agents !== null && (
          <>
            <Item
              name="agents"
              caps={capsFor(props, "agents")}
              word={wordFor(props, "agents")}
              quiet={quiet}
              info={INFO.agents}
              opens={lines("agents")}
              onClick={() => step({ type: "item", what: "agents" })}
            >
              {agents}
            </Item>
            <Sep />
          </>
        )}
        {sync !== null && (
          <>
            <Item
              name="sync"
              caps={capsFor(props, "sync")}
              word={wordFor(props, "sync")}
              quiet={quiet}
              info={INFO.sync}
              className={sync.broken ? "broken" : undefined}
              opens={lines("sync")}
              onClick={() => step({ type: "item", what: "sync" })}
            >
              {sync.word}
            </Item>
            <Sep />
          </>
        )}
        {/* Said as a status, never an alert: a screen reader hears the host go and come back. */}
        <span role="status" aria-label="the link to the host">
          <Item
            name="host"
            caps={capsFor(props, "host")}
            word={wordFor(props, "host")}
            quiet={quiet}
            info={INFO.host}
            label={host.kind === "up" ? "host up" : host.word}
            className={host.kind === "word" && host.broken ? "host broken" : "host"}
            opens={lines("host")}
            onClick={() => step({ type: "item", what: "host" })}
          >
            {host.kind === "up" ? (
              <IconOf icon="done" />
            ) : (
              <>
                <IconOf icon={host.shape} />
                {host.word}
              </>
            )}
          </Item>
          {props.link.kind === "stopped" && (
            <>
              <Sep />
              <Item
                name="try again"
                caps={[]}
                word={null}
                quiet={quiet}
                info={INFO.again}
                onClick={() => props.toApp({ type: "again" })}
              >
                try again
              </Item>
            </>
          )}
        </span>
      </div>
      <div className="brand" data-free={free} ref={brand} aria-hidden="true">
        <Mark />
        <span>fabrika</span>
      </div>
    </header>
  );
}

/** The app's icon as a small size draws it, on its 16 grid (docs/direction/app-icon.md). */
function Mark(): ReactNode {
  return (
    <svg className="mark" viewBox="0 0 16 16" width="16" height="16">
      <rect className="dim" x="5" y="3" width="2" height="10" rx="0.5" />
      <rect className="lit" x="8" y="3" width="4" height="3" rx="0.5" />
      <rect className="dim" x="8" y="7" width="3" height="3" rx="0.5" />
    </svg>
  );
}

/**
 * Whether the middle of the bar is free for the mark and name. They take no room: they sit over the
 * bar, and are gone when what the bar has to say reaches them. Each item that changes size moves
 * the others, so watching sizes is enough. The workspaces come and go with the desk, so `hasDesk`
 * watches them anew.
 */
function useFreeMiddle(
  bar: RefObject<HTMLElement | null>,
  brand: RefObject<HTMLElement | null>,
  hasDesk: boolean,
): boolean {
  const [free, setFree] = useState(true);
  useLayoutEffect(() => {
    const header = bar.current;
    const name = brand.current;

    if (header === null || name === null) {
      return;
    }

    const items = [...header.children].filter((item) => item !== name && !item.classList.contains("drag"));
    const check = () =>
      setFree(
        middleFree(
          name.getBoundingClientRect(),
          items.map((item) => item.getBoundingClientRect()),
        ),
      );
    const watch = new ResizeObserver(check);
    watch.observe(header);

    for (const item of items) {
      watch.observe(item);
    }

    return () => watch.disconnect();
  }, [bar, brand, hasDesk]);
  return free;
}

/** What lies over the desk now: the asks list, the jobs list, an item's lines, or the palette. Shown with the bars hidden too. */
export function Over(props: FrameProps): ReactNode {
  const { over } = props.frame;

  switch (over.kind) {
    case "none":
      return null;
    case "asks":
      return props.asks === null ? null : <AsksList {...props} asks={props.asks} />;
    case "jobs":
      return props.desk === null ? null : <JobsMenu {...props} desk={props.desk} />;
    case "item":
      return <ItemLines {...props} what={over.what} />;
    case "palette":
      return over.source._tag === "projects" ? <ProjectsBox {...props} /> : <CommandPalette {...props} />;
  }
}

/** The band left when both bars are hidden, or before there is a desk: room for the window's buttons. */
export function Band(): ReactNode {
  return <div className="band" data-info={INFO.drag} />;
}

/** The asks list's footer: the keys no row shows. */
const ASKS_FOOT: readonly Hint[] = [
  { caps: ["↑", "↓"], name: "Move" },
  { caps: ["↵"], name: "Open" },
  { caps: ["H"], name: "Later" },
  { caps: ["Esc"], name: "Close" },
];

/**
 * The asks list, a menu: one row per ask, the ones set aside under `Later`. Enter opens the
 * ticket: its tile, else the tracker turned to it (frame.ts, `opensOf`). H sets an ask aside, or
 * brings it back. You answer in the ticket's own tile, never here.
 */
function AsksList(props: FrameProps & { readonly asks: AsksNow }): ReactNode {
  const { asks, desk, step, toHost, toRun, tickets } = props;
  // Opened, every ask in it is seen: the dot in the top bar goes. By the asks' keys, not their
  // count: one ask leaving as another arrives keeps the count, and the new one is seen too.
  const shown = asks.asks.map((a) => a.key).join("\n");
  const sayAsksSeen = useEffectEvent(() => toHost({ type: "seen" }));
  useLayoutEffect(() => {
    sayAsksSeen();
  }, [shown]);
  const close = useCallback(() => step({ type: "close" }), [step]);
  const open = (row: Row) => {
    const ask = [...asks.asks, ...asks.later].find((a) => a.key === row.id);

    if (ask === undefined) {
      return;
    }

    const to = opensOf(desk, ask.ticket, tickets);

    switch (to.kind) {
      case "tile":
        toHost({ type: "go", tile: to.tile });
        return close();
      case "tracker":
        toRun(to.run, { type: "query", value: { ticket: ask.ticket } });
        toHost({ type: "go", tile: to.tile });
        return close();
      case "none":
        return step({ type: "say", note: nowhereNote(ask.ticket) });
    }
  };
  const aside = (row: Row) =>
    toHost(asks.later.some((a) => a.key === row.id) ? { type: "back", key: row.id } : { type: "later", key: row.id });
  return (
    <Menu
      id={POP.asks}
      label="Asks"
      from="top"
      count={asks.asks.length}
      sections={asksSections(asks, desk, tickets, Date.now())}
      foot={ASKS_FOOT}
      empty={{ title: "Nothing waits on you", sub: "A new ask shows here and in the top bar." }}
      onAct={open}
      onSecond={aside}
      onClose={close}
    />
  );
}

/** The jobs list's footer: its rows have no second thing, so Enter is the one action. */
const JOBS_FOOT: readonly Hint[] = [
  { caps: ["↑", "↓"], name: "Move" },
  { caps: ["↵"], name: "Go to tile" },
  { caps: ["Esc"], name: "Close" },
];

/**
 * The jobs list's calm line, shown only when no tile runs anything: what to expect, and the two
 * tsh words for jobs, since that is when someone is learning them. A list with rows needs no
 * hint: each row already shows its `%n`.
 */
const JOBS_EMPTY: Empty = {
  title: "Nothing is running",
  sub: [
    { text: "A job you start in tsh shows here. There, ", typed: false },
    { text: "jobs", typed: true },
    { text: " lists them and ", typed: false },
    { text: "attach %n", typed: true },
    { text: " brings one forward.", typed: false },
  ],
};

/**
 * The jobs list, a menu over the bottom line's job item, as tsh's `jobs` prints the host's table:
 * the focused tile's jobs, its last to end, then each other tile's (frame.ts, `jobsList`). Enter
 * on a row focuses the tile it runs in; on one of this tile's, that is only the list closing and
 * focus going back to the tile. There is no trace to open for a job yet.
 */
function JobsMenu(props: FrameProps & { readonly desk: Open }): ReactNode {
  const { desk, step, toHost } = props;
  const now = useNow(() => true);
  const list = jobsList(desk, now);
  const here = focusedOf(desk)?.id;
  const close = useCallback(() => step({ type: "close" }), [step]);
  const go = (row: Row) => {
    const tile = list.tiles.get(row.id);

    if (tile !== undefined && tile !== here) {
      toHost({ type: "go", tile });
    }

    close();
  };
  return (
    <Menu
      id={POP.jobs}
      label="Jobs"
      from="bottom"
      count={list.count}
      sections={list.sections}
      foot={JOBS_FOOT}
      empty={JOBS_EMPTY}
      onAct={go}
      // No job row has a second thing (`second: null`), so H does nothing here.
      onSecond={() => undefined}
      onClose={close}
    />
  );
}

/** What the restart does to the jobs, said before the person confirms. */
const JOBS_STOP = "Its running jobs stop. Their saved lists stay, and each comes back with attach %n.";

/** Each item's panel, as a screen reader names it. */
const LINES_LABEL: Readonly<Record<Part, string>> = {
  agents: "The agents",
  sync: "The sync",
  host: "The host",
};

/** A few lines on one item of the top bar, under it: the agents, the sync or the host. */
function ItemLines(props: FrameProps & { readonly what: Part }): ReactNode {
  const { link, step } = props;
  const close = useCallback(() => step({ type: "close" }), [step]);
  const host = reachedOf(props);
  const now = Date.now();
  const body = (): ReactNode => {
    if (props.what === "host") {
      return (
        <HostLines
          link={link}
          first={!props.attachedOnce}
          toApp={props.toApp}
          host={host}
          desk={props.desk}
          now={now}
        />
      );
    }

    if (host === null) {
      return (
        <>
          <h2 className="pop-title">The app is not on the host</h2>
          <p className="pop-text">Once it is back, this says what the host says.</p>
        </>
      );
    }

    return props.what === "agents" ? (
      <AgentsLines host={host} now={now} toHost={props.toHost} />
    ) : (
      <SyncLines host={host} asks={props.asks} />
    );
  };
  return (
    <Panel id={POP.lines} label={LINES_LABEL[props.what]} onClose={close}>
      {body()}
    </Panel>
  );
}

/** How an agent attaches, said under its list, its command typed. */
const ATTACH: Words = [
  { text: "An agent attaches with ", typed: false },
  { text: "fabrika mcp --as claude", typed: true },
  {
    text: ", under its own name. It drives the app's programs as tools; it never answers an ask.",
    typed: false,
  },
];

/** What a summoned agent does now, in a word or two. */
const STATE_WORD: Readonly<Record<SummonedOn["state"], string>> = {
  opening: "opening",
  idle: "idle",
  turn: "working",
  asking: "asking you",
  down: "down",
};

/**
 * The agents the person summoned here, a row each: its name, what it runs on and does now, and a
 * Dismiss, as `dismiss <name>` is in a tile. Nothing when none is summoned.
 */
function SummonedLines(props: {
  readonly summoned: readonly SummonedOn[];
  readonly now: number;
  readonly toHost: (m: FromPage) => void;
}): ReactNode {
  const { summoned } = props;

  if (summoned.length === 0) {
    return null;
  }

  return (
    <>
      <h2 className="pop-title">{`${summoned.length} agent${summoned.length === 1 ? "" : "s"} summoned here`}</h2>
      <ul className="pop-lines">
        {summoned.map((a) => (
          <li key={a.name} className="pop-row two">
            <span className="lead">
              <IconOf icon={a.state === "down" ? "stuck" : "running"} />
            </span>
            <span className="text">
              <span className="t">{a.name}</span>
              <span className="s">
                {[a.agent, a.model, a.effort].filter((w) => w !== null).join(" · ")} · {STATE_WORD[a.state]} · since{" "}
                {clockWord(a.since, props.now)}
              </span>
            </span>
            <button
              type="button"
              className="pop-button"
              aria-label={`Dismiss ${a.name}`}
              onClick={() => props.toHost({ type: "dismiss", name: a.name })}
            >
              Dismiss
            </button>
          </li>
        ))}
      </ul>
      <p className="pop-text">
        <WordsOf words={SUMMON} />
      </p>
    </>
  );
}

/** How an agent is summoned, said under the summoned ones, its command typed. */
const SUMMON: Words = [
  { text: "Summon one in a tile with ", typed: false },
  { text: "summon claude as scout", typed: true },
  { text: ", then talk with ", typed: false },
  { text: "@scout", typed: true },
  { text: ".", typed: false },
];

/**
 * The agents on this desk: the ones the person summoned, ours to dismiss, then each attached to
 * the host's agents' socket, under its own heading: its name, and since when.
 */
function AgentsLines(props: {
  readonly host: HostNow;
  readonly now: number;
  readonly toHost: (m: FromPage) => void;
}): ReactNode {
  return (
    <>
      <SummonedLines summoned={props.host.summoned ?? []} now={props.now} toHost={props.toHost} />
      <AttachedLines host={props.host} now={props.now} />
    </>
  );
}

/** Each agent attached to the host now, a row each: its name, and since when. */
function AttachedLines(props: { readonly host: HostNow; readonly now: number }): ReactNode {
  const { agents } = props.host;

  if (agents === null) {
    return (
      <>
        <h2 className="pop-title">No agents attach here</h2>
        <p className="pop-text">
          This host has no agents' socket, so no agent can attach to it. Only a host built before every home had one
          says so.
        </p>
      </>
    );
  }

  return (
    <>
      <h2 className="pop-title">
        {agents.length === 0
          ? "No agent is attached"
          : `${agents.length} agent${agents.length === 1 ? " is" : "s are"} attached`}
      </h2>
      <Lines
        rows={agents.map((a, i) => ({
          id: `${a.name}-${a.since}-${i}`,
          icon: "running",
          title: sentence(a.name),
          sub: null,
          side: `since ${clockWord(a.since, props.now)}`,
          second: null,
        }))}
      />
      <p className="pop-text">
        <WordsOf words={ATTACH} />
      </p>
    </>
  );
}

/** Which ledger the home reads, and how its last read went. */
function SyncLines(props: { readonly host: HostNow; readonly asks: AsksNow | null }): ReactNode {
  const { ledger } = props.host;
  const { asks } = props;
  const failed = asks?.reach === "failed";
  const why = failed && (
    <>
      {asks.why !== null && <code className="pop-why">{asks.why}</code>}
      <p className="pop-text">The asks count is the last one read. It reads again every second.</p>
    </>
  );

  if (ledger.kind === "own") {
    return (
      <>
        <h2 className={`pop-title${failed ? " broken" : ""}`}>
          {failed ? "The ledger is unreachable" : "This home keeps its own ledger"}
        </h2>
        <p className="pop-text">
          <code>ledger.sqlite</code>, in the app's home. Nothing to sync: every fact is written here.
        </p>
        {why}
      </>
    );
  }

  return (
    <>
      <h2 className={`pop-title${failed ? " broken" : ""}`}>
        {failed
          ? "The ledger server is unreachable"
          : asks?.reach === "ok"
            ? "Synced with the ledger server"
            : "Syncing with the ledger server"}
      </h2>
      <p className="pop-text">
        <code>{ledger.address}</code>, as {ledger.login}
      </p>
      {why || (
        <p className="pop-text">
          Every write goes straight to the server, so none waits here. It reads again every second.
        </p>
      )}
    </>
  );
}

/** A panel's one thing to do, as a button. */
function Do(props: { readonly onClick: () => void; readonly children: ReactNode }): ReactNode {
  return (
    <button type="button" className="pop-button" onClick={props.onClick}>
      {props.children}
    </button>
  );
}

/** The host, in a few lines: its process when it is up; else what the old corner notes said. */
function HostLines(props: {
  readonly link: LinkNow;
  readonly first: boolean;
  readonly toApp: (m: ToApp) => void;
  readonly host: HostNow | null;
  readonly desk: Open | null;
  readonly now: number;
}): ReactNode {
  const { link, first, host } = props;
  const restarted = host === null ? null : restartedWord(host, props.now);
  const restart = <Do onClick={() => props.toApp({ type: "restart" })}>Stop the old host and start this one</Do>;

  switch (link.kind) {
    case "up":
      return (
        <>
          <h2 className="pop-title">The host is up</h2>
          {host !== null && (
            <p className="pop-text">
              Process {host.pid}, since {clockWord(host.since, props.now)},{" "}
              {host.build === null ? (
                "no build named"
              ) : (
                <>
                  build <code>{host.build}</code>
                </>
              )}
              .
            </p>
          )}
          {restarted !== null && (
            <p className="pop-text">
              {sentence(restarted)}
              {/[.!?]$/.test(restarted) ? "" : "."}
            </p>
          )}
          {props.desk !== null && <p className="pop-text">{holdsWord(props.desk)}</p>}
          <p className="pop-text">
            It runs every tile and job. Quitting the app leaves it running; the next start attaches to it.
          </p>
        </>
      );
    case "build":
      return (
        <>
          <h2 className="pop-title">The host runs older code</h2>
          <p className="pop-text">
            {link.theirs === null ? (
              <>
                It names no build. This app is build <code>{link.ours}</code>.
              </>
            ) : (
              <>
                It is build <code>{link.theirs}</code>. This app is build <code>{link.ours}</code>.
              </>
            )}{" "}
            {JOBS_STOP}
          </p>
          {restart}
        </>
      );
    case "version":
      return (
        <>
          <h2 className="pop-title broken">The host speaks link version {link.theirs}</h2>
          <p className="pop-text">This app speaks {link.ours}.</p>
          {restart}
        </>
      );
    case "reconnecting":
      return (
        <>
          <h2 className="pop-title">{first ? "Connecting to the host…" : "Reconnecting to the host…"}</h2>
          <code className="pop-why">{link.why}</code>
        </>
      );
    case "stopped":
      return (
        <>
          <h2 className="pop-title broken">
            {first ? "Could not connect to the host" : "Could not reconnect to the host"}
          </h2>
          <code className="pop-why">{link.why}</code>
          <p className="pop-text">It stopped trying after five minutes.</p>
          <Do onClick={() => props.toApp({ type: "again" })}>Try again</Do>
        </>
      );
    case "restarting":
      return (
        <>
          <h2 className="pop-title">Stopping the old host…</h2>
          <p className="pop-text">Once it has stopped, this app starts its own and attaches.</p>
        </>
      );
  }
}

/**
 * The bottom line: the tile you are in, or the key you just pressed. Its own question
 * (`close t2? (y/n)`) is said here, where tmux says it. An agent's ask never is.
 */
export function BottomLine(props: FrameProps): ReactNode {
  const { desk, frame, armed } = props;
  const question = desk === null ? null : questionWord(desk);
  const here = desk === null ? null : focusedOf(desk);
  const jobs = desk === null || here === null ? undefined : desk.jobs[here.id];
  const now = useNow((t) => jobItem(jobs, t) !== null);
  const job = jobItem(jobs, now);
  const left = (): ReactNode => {
    if (question !== null) {
      return (
        <span className="prompt" role="alertdialog" aria-label={question}>
          {question}
        </span>
      );
    }

    if (armed) {
      return (
        <span className="keying">
          <b>PREFIX</b>
          {prefixLine(props.keys).map((k) => (
            <span key={k.key}>
              <Sep />
              <b>{k.key}</b> {k.name}
            </span>
          ))}
        </span>
      );
    }

    if (frame.info.kind === "on") {
      return (
        <span className="info">
          <b>INFO</b>
          <Sep />
          {frame.info.explained ?? "point at anything"}
        </span>
      );
    }

    if (desk === null) {
      return null;
    }

    return (
      <>
        <span className="here" data-info={INFO.here}>
          {hereWord(desk, props.shapes, props.tickets)}
        </span>
        {job !== null && (
          <>
            <Sep />
            <JobWord {...props} job={job} />
          </>
        )}
      </>
    );
  };
  const right = (): ReactNode => {
    if (question !== null) {
      return <span className="quiet">y closes · n keeps it</span>;
    }

    if (armed) {
      return <span className="quiet">esc cancels</span>;
    }

    if (frame.note !== null) {
      return <span className="note">{frame.note}</span>;
    }

    const keys = keyFor(props, "keys");
    const info = keyFor(props, "info");
    const quiet = quietOf(frame);
    const on = frame.info.kind === "on";
    const file = fileWord(props.keys.file);
    const said = infoFor(props.keys);
    return (
      <>
        {/* The way out, named first: the right side is pinned to the window's right edge, so a
				    word after the items would push them left. First, it leaves them where they were, and
				    a second click where the mode turned on turns it off. */}
        {on && (
          <>
            <span className="quiet">esc leaves</span>
            <Sep />
          </>
        )}
        {/* A keys file that did not read: in words, with the warning color, while the keys go on
				    as they were (WCAG 1.4.1: the words say it, the color only marks it). */}
        {file !== null && (
          <>
            <span className="broken" title={file}>
              {file}
            </span>
            <Sep />
          </>
        )}
        {/* A toggle button by the ARIA APG: its name stays "info", and aria-pressed says on or
				    off. Clicked or pressed, the pointer or focus is on it, so it is what is explained first. */}
        <Item
          name="info"
          caps={capsFor(props, "info")}
          word={wordFor(props, "info")}
          quiet={quiet}
          info={said.info}
          pressed={on}
          onClick={() => props.step({ type: "info", focus: said.info })}
        >
          {info ?? ""} info
        </Item>
        <Sep />
        <Item
          name="keys"
          caps={capsFor(props, "keys")}
          word={wordFor(props, "keys")}
          quiet={quiet}
          info={said.keys}
          opens={{
            popup: "dialog",
            id: POP.palette,
            open: frame.over.kind === "palette" && frame.over.source._tag === "keys",
          }}
          onClick={() => props.step({ type: "show", what: "keys" })}
        >
          {keys ?? ""} keys
        </Item>
      </>
    );
  };
  return (
    <footer className="bottomline">
      <div className="left">{left()}</div>
      <div className="right">{right()}</div>
    </footer>
  );
}

/**
 * The window's one status region for its mode: it says "Info mode on. Escape leaves." when info
 * mode comes on and "Info mode off." when it goes, and nothing on each part explained (WCAG 4.1.3,
 * docs/direction/modes.md, M3). `status` is polite and atomic, so it waits for a pause and reads
 * the whole line. Out of sight: the bottom line says the same where the eye is. It is drawn
 * whatever the bars, before it has anything to say, so a screen reader is listening when it
 * changes, and "off" is heard with the bars hidden.
 */
export function ModeStatus(props: { readonly frame: Frame }): ReactNode {
  return (
    <p className="mode-status" role="status">
      {modeWord(props.frame)}
    </p>
  );
}

/**
 * The desk's bottom area: the bottom line when `bottomLineShows` says so and no page stands
 * `instead` of the desk (another link version), and the mode's status region always, outside the
 * line, so it is heard whatever the bars and the link.
 */
export function BottomArea(props: FrameProps & { readonly instead: boolean }): ReactNode {
  const { frame, desk, armed, instead } = props;
  const shows = bottomLineShows(frame, { armed, asking: desk?.ask != null });
  return (
    <>
      {!instead && shows && <BottomLine {...props} />}
      <ModeStatus frame={frame} />
    </>
  );
}

/** How often the page reads its clock again while a job's time is on screen, in ms. */
const TICK_MS = 1000;

/**
 * The time now, by the page's clock, read again each second while `moving` says the time on
 * screen moves at that time: a job runs, or one just ended and will clear. Elm's `Time.every`.
 */
const useNow = (moving: (now: number) => boolean): number => {
  const [now, setNow] = useState(Date.now);
  const on = moving(now);
  useEffect(() => {
    if (!on) {
      return;
    }

    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(timer);
  }, [on]);
  return now;
};

/** The job item: `%3 seq --to 9 | tally 2m +1`. A click lists the jobs, as C-b J does. */
function JobWord(props: FrameProps & { readonly job: JobItem }): ReactNode {
  const { job, frame } = props;
  return (
    <Item
      name="jobs"
      caps={capsFor(props, "jobs")}
      word={wordFor(props, "jobs")}
      quiet={quietOf(frame)}
      info={INFO.job}
      className="job"
      opens={{ popup: "menu", id: POP.jobs, open: frame.over.kind === "jobs" }}
      onClick={() => props.step({ type: "show", what: "jobs" })}
    >
      <b>%{job.n}</b> <span className="job-line">{job.text}</span> <span className="took">{job.said}</span>
      {job.more > 0 && <span className="took"> +{job.more}</span>}
    </Item>
  );
}

/** A group of commands, as its heading says it. */
const GROUP_TITLE: Readonly<Record<Group, string>> = {
  tile: "Tile",
  focus: "Focus",
  workspace: "Workspace",
  window: "Window",
};

/** `19 commands`, `1 shortcut`. */
const countWord = (n: number, keys: boolean): string => `${n} ${keys ? "shortcut" : "command"}${n === 1 ? "" : "s"}`;

/**
 * The palette (Cmd-K), or every key (C-b ?): each command and its keys, grouped, the focused tile
 * named on top since the commands act on it. Typing narrows it, the arrows move, Enter runs the
 * command as its key would, Escape closes it.
 */
function CommandPalette(props: FrameProps): ReactNode {
  const { frame, step, desk } = props;
  const close = useCallback(() => step({ type: "close" }), [step]);

  if (frame.over.kind !== "palette") {
    return null;
  }

  const { source, query, at } = frame.over;

  if (source._tag === "keys" && props.keysEditor != null && props.editKeys !== undefined) {
    return (
      <Dialog
        id={POP.palette}
        className="keys-dialog"
        title="Keyboard shortcuts"
        open
        size="lg"
        closeOnEscape={false}
        showCloseButton={false}
        closeOnInteractOutside={props.keysEditor.recording._tag !== "saving"}
        onOpenChange={(open) => {
          if (!open && props.keysEditor?.recording._tag !== "saving") {
            close();
          }
        }}
      >
        <KeysWindow
          keys={props.keys}
          editor={props.keysEditor}
          send={props.editKeys}
          changes={props.keyChanges ?? []}
          close={close}
        />
      </Dialog>
    );
  }

  const keys = source._tag === "keys";
  const shown = matching(commandsOf(props.keys, desk?.workspaces.length ?? 0), query);
  const run = (i: number) => {
    const c = shown[i];

    if (c === undefined) {
      return;
    }

    props.toHost({ type: "run", does: c.runs });
    step({ type: "ran", key: c.key });
  };
  const focused = desk === null ? null : focusedOf(desk);
  const groups = [...new Set(shown.map((c) => c.group))];
  // The shortcuts list says a keys file that did not read on top, until it reads again.
  const file = keys ? fileWord(props.keys.file) : null;
  return (
    <Palette
      id={POP.palette}
      label={keys ? "Keyboard shortcuts" : "Commands"}
      chip={keys || focused === null ? "Keyboard shortcuts" : `${focused.id} · ${tileWord(focused, props.tickets)}`}
      note={file ?? undefined}
      query={query}
      sections={groups.map((g) => ({
        title: GROUP_TITLE[g],
        options: shown
          .filter((c) => c.group === g)
          .map((c) => ({ id: c.name, name: c.name, word: c.tsh, caps: c.caps })),
      }))}
      at={at}
      count={countWord(shown.length, keys)}
      onQuery={(q) => step({ type: "query", query: q })}
      onMove={(by) => step({ type: "move", by, of: shown.length })}
      onRun={run}
      onClose={close}
    />
  );
}
