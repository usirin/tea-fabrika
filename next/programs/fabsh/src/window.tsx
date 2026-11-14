// fabsh's window, next/: a scrollback log above one line. The line is Manti's native `Input`, so
// IME, paste, selection and screen reader editing come free; behind its clear text an `aria-hidden`
// layer draws `read`'s spans in their role colors, and one polite status says each refused word's
// reason in words, so color is never the only cue (WCAG 1.4.1). Every mark reads `read`, never a
// regex of its own. Render is pure: it only sends Msgs on the person's input.
import { defineWindow, type TileProps, type WindowProps } from "@kampus/libfabrika";
import { Input } from "@manti-ui/react";
import { Schema } from "effect";
import { type ReactElement, type ReactNode, useId, useLayoutEffect, useRef } from "react";
import { fabsh, LINE_MOST } from "./program.ts";
import { builtins, read, Reason, type Span } from "./read.ts";
import { drawn, tile } from "./tile.ts";

/** The checked view: the submitted lines, the scrollback, and what may be started. */
const data = Schema.Struct({
  history: Schema.Array(Schema.String),
  scroll: Schema.Array(
    Schema.Union([
      Schema.TaggedStruct("answered", { line: Schema.String, says: Schema.Array(Schema.String) }),
      Schema.TaggedStruct("refused", {
        line: Schema.String,
        start: Schema.Int,
        end: Schema.Int,
        reason: Schema.String,
      }),
      Schema.TaggedStruct("starting", { line: Schema.String, program: Schema.String, name: Schema.String }),
      Schema.TaggedStruct("started", {
        line: Schema.String,
        process: Schema.String,
        name: Schema.String,
        fresh: Schema.Boolean,
      }),
      Schema.TaggedStruct("failed", { line: Schema.String, reason: Schema.String }),
    ]),
  ),
  programs: Schema.Array(Schema.String),
});

type Entry = (typeof data.Type.scroll)[number];

const WORDS: Readonly<Record<Reason, (word: string, verb: string) => string>> = {
  no_word: (w) => `${w} is not a built-in or a program.`,
  extra: (w, verb) => `${w} is one word too many for ${verb}.`,
  no_name: (w) => `${w} needs a name after it.`,
  bad_name: (w) => `${w} is not a name a process can have.`,
  ambiguous: (w) => `${w} names more than one program; type its whole name.`,
};

/** One refused span's reason in words, naming its characters. */
export const said = (span: Span, line: string): string => {
  const word = `\`${line.slice(span.start, span.end)}\``;
  const verb = `\`${/\S+/.exec(line)?.[0] ?? ""}\``;
  const reason: Reason = span.reason ?? "no_word";
  return WORDS[reason](word, verb);
};

/** The line's characters, each span in its role, the spaces between them as they are. */
const layered = (line: string, spans: ReadonlyArray<Span>): ReadonlyArray<ReactNode> => {
  const out: Array<ReactNode> = [];
  let at = 0;

  for (const s of spans) {
    out.push(line.slice(at, s.start));
    out.push(
      <span key={s.start} data-role={s.role}>
        {line.slice(s.start, s.end)}
      </span>,
    );
    at = s.end;
  }

  out.push(line.slice(at));
  return out;
};

/** Why a start did not give a live process, in words: `already_present` and each host refusal. */
const FAILED: Readonly<Record<string, string>> = {
  already_present: "That name's process has ended, so nothing was started.",
  no_program: "No program by that name is built here.",
  forbidden: "You may not start that program here.",
  stale_sender: "This shell's process ended before the start.",
  bad_name: "That is not a name a process can have.",
  bad_input: "The program could not take its first input.",
  id_reused: "This start's id was already used for another start.",
  name_taken: "That name belongs to a process of another program.",
};

/** What one scrollback entry says under its line, in words. */
const answer = (entry: Entry): ReactElement | ReadonlyArray<ReactElement> => {
  if (entry._tag === "answered") {
    return entry.says.map((say, j) => (
      <p className="fabsh-says" key={j}>
        {say}
      </p>
    ));
  }

  if (entry._tag === "refused") {
    return (
      <p className="fabsh-refused">
        {said({ start: entry.start, end: entry.end, role: "unknown", reason: toReason(entry.reason) }, entry.line)}
      </p>
    );
  }

  if (entry._tag === "starting") {
    return <p className="fabsh-says">{`Starting ${entry.program} as ${entry.name}.`}</p>;
  }

  if (entry._tag === "started") {
    return (
      <p className="fabsh-says">
        {entry.fresh
          ? `Started ${entry.name}, process ${entry.process}.`
          : `${entry.name} is already running, process ${entry.process}.`}
      </p>
    );
  }

  return (
    <p className="fabsh-refused">
      {FAILED[entry.reason] ?? `The start was refused for a reason fabsh does not know: ${entry.reason}.`}
    </p>
  );
};

type Props = WindowProps<typeof fabsh> & TileProps<typeof tile>;

const FabshWindow = ({ data: view, tile: own, send }: Props) => {
  const status = useId();
  const field = useRef<HTMLInputElement>(null);
  const layer = useRef<HTMLSpanElement>(null);
  const line = drawn(own);
  const spans = read(line.text, { builtins, programs: view.programs }).spans;
  const reasons = spans.filter((s) => s.role === "unknown").map((s) => said(s, line.text));

  // Tab and recall move the cursor in the model; the native input follows it while focused.
  useLayoutEffect(() => {
    const el = field.current;

    if (el !== null && el === el.ownerDocument.activeElement && el.selectionStart !== line.cursor) {
      el.setSelectionRange(line.cursor, line.cursor);
    }
  }, [line.cursor, line.text]);

  // The input scrolls its own clear text to keep the caret in view; the layer is moved by the same
  // amount, so a line wider than the field draws the letters the input shows, as a highlighter over
  // a native field does. Layout, never state: nothing reads it back.
  const follow = () => {
    const el = field.current;
    const text = layer.current;

    if (el !== null && text !== null) {
      text.style.transform = el.scrollLeft === 0 ? "" : `translateX(${-el.scrollLeft}px)`;
    }
  };
  useLayoutEffect(follow);

  const edited = (el: HTMLInputElement) =>
    send({ type: "edited", text: el.value, cursor: el.selectionStart ?? el.value.length });
  // A select is only a cursor move: React fires it on focus and in the same keydown as a recall,
  // before the input shows the model's new line, so it never carries text and moves only a cursor
  // that really moved.
  const moved = (el: HTMLInputElement) => {
    const at = el.selectionStart ?? el.value.length;

    if (el.value === line.text && at !== line.cursor) {
      send({ type: "edited", text: line.text, cursor: at });
    }
  };

  return (
    <div className="fabsh">
      <div className="fabsh-log" role="log" aria-label="Scrollback">
        {view.scroll.map((entry, i) => (
          <div className="fabsh-entry" key={i}>
            <p className="fabsh-ran">{entry.line}</p>
            {answer(entry)}
          </div>
        ))}
      </div>
      <form
        className="fabsh-form"
        onSubmit={(event) => {
          event.preventDefault();
          send({ type: "enter" });
        }}
      >
        <div className="fabsh-line">
          <div className="fabsh-spans">
            <span className="fabsh-text" aria-hidden="true" ref={layer}>
              {layered(line.text, spans)}
            </span>
          </div>
          <Input
            ref={field}
            type="text"
            className="fabsh-input"
            aria-label="Shell line"
            aria-describedby={status}
            autoComplete="off"
            spellCheck={false}
            maxLength={LINE_MOST}
            value={line.text}
            onChange={(event) => edited(event.target)}
            onSelect={(event) => moved(event.currentTarget)}
            onScroll={follow}
            onBlur={() => send({ type: "blurred" })}
            onKeyDown={(event) => {
              if (event.key === "Tab" && !event.shiftKey) {
                event.preventDefault();
                send({ type: "tab", programs: [...view.programs] });
              }

              if (event.key === "ArrowUp" || event.key === "ArrowDown") {
                event.preventDefault();
                send({ type: "recall", to: event.key === "ArrowUp" ? "back" : "forward", history: [...view.history] });
              }
            }}
          />
        </div>
        <p id={status} className="fabsh-status" aria-live="polite">
          {reasons.join(" ")}
        </p>
      </form>
    </div>
  );
};

const isReason = Schema.is(Reason);
const toReason = (reason: string): Reason => (isReason(reason) ? reason : "no_word");

const TOO: Readonly<Record<string, string>> = {
  too_long: `That line is longer than ${LINE_MOST} characters.`,
  bad_line: "A line cannot hold a line break.",
};

const refused = (_m: typeof fabsh.machine.msg.Type, reason: string): string =>
  TOO[reason] ?? (/^[a-z_]{1,40}$/.test(reason) ? `Not run (${reason}).` : "Not run.");

export const fabshWindow = defineWindow(fabsh, {
  data,
  View: FabshWindow,
  keys: {},
  tile,
  refused,
});
