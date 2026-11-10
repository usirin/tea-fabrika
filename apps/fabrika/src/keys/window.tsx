import { Button, Input, Kbd, Listbox, ScrollArea } from "@manti-ui/react";
import { type ReactNode, useId, useLayoutEffect, useRef } from "react";
import { bindingFor, defaults, type Key, type Keys, spell } from "../desk/keymap.ts";
import { THE_MACS, wordOf } from "../desk/keys.ts";
import { capOf } from "../window/pop.ts";
import { type Editor, type EditorMsg, matching } from "./machine.ts";
import type { Snapshot } from "./program.ts";

const spelling = (key: Key) => `${key._tag === "after_prefix" ? "<prefix>" : ""}${spell(key.key)}`;

const spoken = (keys: Keys, key: Key) =>
  `${key._tag === "after_prefix" ? `${spell(keys.prefix)} then ` : ""}${spell(key.key)}`;

const systemReason: Readonly<Record<string, string>> = {
  "<m-q>": "Quit the app",
  "<m-h>": "Hide the app",
  "<m-tab>": "Switch apps",
  "<m- >": "Open Spotlight",
  "<a-m-escape>": "Force quit an app",
};

const shortcut = (key: Key) => {
  if (key._tag === "after_prefix") {
    return null;
  }

  const parts = spell(key.key).split("+");
  const base = parts.pop() ?? "";
  const names: Readonly<Record<string, string>> = {
    ctrl: "Control",
    cmd: "Meta",
    shift: "Shift",
    alt: "Alt",
    space: "Space",
    esc: "Escape",
    escape: "Escape",
    enter: "Enter",
    tab: "Tab",
    left: "ArrowLeft",
    right: "ArrowRight",
    up: "ArrowUp",
    down: "ArrowDown",
  };
  return [
    ...["ctrl", "alt", "cmd", "shift"].filter((part) => parts.includes(part)).map((part) => names[part]),
    names[base] ?? base.replace(/[a-z]/g, (c) => c.toUpperCase()),
  ].join("+");
};

type Stage = Editor["recording"]["_tag"];

/**
 * Where focus goes when recording moves on, so it never falls to the page when the focused button
 * goes away (WCAG 2.4.3): into the box to record, to the result line while saving, and back to
 * Change once the editor is idle again. Nothing moves while the stage stays, or on first draw.
 */
export const focusAfter = (before: Stage | null, now: Stage): "box" | "result" | "change" | null =>
  before === null || before === now
    ? null
    : now === "waiting"
      ? "box"
      : now === "saving"
        ? "result"
        : now === "idle"
          ? "change"
          : null;

/** What the one live region says now: it stays mounted, so a screen reader hears each change. */
export const announcement = (keys: Keys, recording: Editor["recording"]): string =>
  recording._tag === "waiting"
    ? recording.prefix
      ? `${spell(keys.prefix)} recorded. Press the next key. No time limit.`
      : "Press a key. Escape cancels."
    : recording._tag === "candidate"
      ? `New key: ${recording.keys.map((key) => spoken(keys, key)).join(", ")}. Save or record again.`
      : "";

const ON_A_MAC = /Mac/.test(globalThis.navigator?.userAgent ?? "");

function Keycaps({ keys, on }: { readonly keys: Keys; readonly on: readonly Key[] }): ReactNode {
  return on.length === 0 ? (
    <span>unbound</span>
  ) : (
    on.map((key) => (
      <span className="keys-combination" key={spelling(key)} aria-label={spoken(keys, key)}>
        {key._tag === "after_prefix" && (
          <>
            <Kbd>{capOf(keys.prefix)}</Kbd>
            <span>then</span>
          </>
        )}
        <Kbd>{capOf(key.key)}</Kbd>
      </span>
    ))
  );
}

export function KeysWindow({
  keys,
  editor,
  send,
  changes = [],
  close,
  mac = ON_A_MAC,
}: {
  readonly keys: Keys;
  readonly editor: Editor;
  readonly send: (msg: EditorMsg) => void;
  readonly changes?: Snapshot["changes"];
  readonly close?: () => void;
  readonly mac?: boolean;
}): ReactNode {
  const selected = editor.selected;
  const row = keys.rows.find((r) => r.does === selected);
  const recording = editor.recording;
  const box = useRef<HTMLElement>(null);
  const change = useRef<HTMLButtonElement>(null);
  const result = useRef<HTMLDivElement>(null);
  const stage = useRef<Stage | null>(null);
  const instructions = useId();
  useLayoutEffect(() => {
    const to = focusAfter(stage.current, recording._tag);
    stage.current = recording._tag;

    if (to === "box") {
      box.current?.focus();
    }

    if (to === "result") {
      result.current?.focus();
    }

    // With no command selected there is no Change button; the result line holds focus.
    if (to === "change") {
      (change.current ?? result.current)?.focus();
    }
  }, [recording._tag]);
  const said = announcement(keys, recording);
  const busy = recording._tag === "saving";
  const choosing = recording._tag === "waiting" || recording._tag === "candidate";
  const on =
    row?.keys ??
    (selected === "prefix"
      ? [{ _tag: "alone" as const, key: keys.prefix }]
      : selected === "ignore"
        ? keys.ignore.map((key) => ({ _tag: "alone" as const, key }))
        : []);
  const shown = matching(keys, editor.query);
  const source =
    row?.source ??
    ((
      selected === "prefix"
        ? keys.prefix === defaults.prefix
        : JSON.stringify(keys.ignore) === JSON.stringify(defaults.ignore)
    )
      ? "default"
      : "yours");
  const binding = row === undefined ? undefined : bindingFor(row.does);
  const latest = changes.at(-1);
  const moved = (does: string) => {
    const before = defaults.rows.find((r) => r.does === does)?.keys ?? [];
    const lost = [
      ...before,
      ...changes.flatMap((change) => change.displaced.filter((entry) => entry.does === does).map((entry) => entry.key)),
    ];
    return [
      ...new Set(
        lost.flatMap((key) => {
          const winner = keys.rows.find((r) => r.does !== does && r.keys.some((k) => spelling(k) === spelling(key)));
          return winner === undefined ? [] : [`${spoken(keys, key)} moved to ${winner.does}`];
        }),
      ),
    ].join(". ");
  };
  const candidate = recording._tag === "candidate" ? recording.keys : [];
  const conflicts = keys.rows.filter(
    (r) => r.does !== selected && r.keys.some((key) => candidate.some((c) => spelling(c) === spelling(key))),
  );
  const select = (value: string[]) => {
    const first = value[0];
    const found = keys.rows.find((r) => r.does === first);

    if (first === "prefix" || first === "ignore") {
      send({ type: "select", does: first });
    } else if (found !== undefined) {
      send({ type: "select", does: found.does });
    }
  };
  return (
    <section
      ref={box}
      tabIndex={-1}
      className="keys-editor"
      aria-label="Keyboard shortcuts"
      aria-describedby={recording._tag === "waiting" ? instructions : undefined}
      data-over=""
    >
      <p id={instructions} className="keys-live" role="status">
        {said}
      </p>
      <Input
        label="Search commands or keys"
        placeholder="Search commands, tsh words or keys"
        value={editor.query}
        disabled={busy || choosing}
        onChange={(e) => send({ type: "query", query: e.currentTarget.value })}
      />
      {keys.file._tag === "refused" && (
        <p role="alert">
          keybindings.toml line {keys.file.line}: {keys.file.why}. Your last good keys still work.
        </p>
      )}
      {editor.error !== null && <p role="alert">{editor.error}</p>}
      <div className="keys-layout">
        <ScrollArea className="keys-list">
          <Listbox
            label="Commands and settings"
            disabled={busy || choosing}
            value={selected === null ? [] : [selected]}
            onValueChange={select}
            items={[
              ...(["prefix", "ignore"] as const)
                .filter((name) => editor.query === "" || name.includes(editor.query.toLowerCase()))
                .map((name) => ({
                  value: name,
                  label:
                    name === "prefix"
                      ? `Prefix · ${spell(keys.prefix)}`
                      : `Ignore · ${keys.ignore.map(spell).join(", ") || "none"}`,
                })),
              ...shown.map((r) => {
                const b = bindingFor(r.does);
                const why = moved(r.does);
                return {
                  value: r.does,
                  label: `${b?.name ?? "palette"} · ${r.does} · ${b === undefined ? "palette" : wordOf(b.does)} · ${r.keys.map((key) => spoken(keys, key)).join(", ") || "unbound"} · ${r.source}${why === "" ? "" : ` · ${why}`}`,
                };
              }),
            ]}
          />
          {shown.length === 0 && <p role="status">No commands found.</p>}
        </ScrollArea>
        <div className="keys-detail">
          {selected === null ? (
            <p>Select a command to change its keys.</p>
          ) : (
            <>
              <h3>{binding?.name ?? selected}</h3>
              <code>{selected}</code>
              {row !== undefined && (
                <p>
                  tsh: <code>{binding === undefined ? "palette" : wordOf(binding.does)}</code>
                </p>
              )}
              <p>{source}</p>
              <div
                aria-keyshortcuts={
                  on
                    .map(shortcut)
                    .filter((key) => key !== null)
                    .join(" ") || undefined
                }
              >
                <Keycaps keys={keys} on={on} />
              </div>
              {recording._tag === "idle" && (
                <div className="keys-actions">
                  <Button ref={change} size="sm" onClick={() => send({ type: "change" })}>
                    Change
                  </Button>
                  {selected !== "prefix" && (
                    <Button size="sm" onClick={() => send({ type: "add" })}>
                      Add
                    </Button>
                  )}
                  {selected !== "prefix" && (
                    <Button size="sm" onClick={() => send({ type: "unbind" })}>
                      Unbind
                    </Button>
                  )}
                  <Button size="sm" onClick={() => send({ type: "reset" })}>
                    Reset
                  </Button>
                  {row !== undefined &&
                    on.map((key) => (
                      <Button
                        key={spelling(key)}
                        size="sm"
                        onClick={() => send({ type: "query", query: spelling(key) })}
                      >
                        Same key: {spoken(keys, key)}
                      </Button>
                    ))}
                </div>
              )}
              {recording._tag === "waiting" && (
                <div>
                  <p aria-hidden="true">{said}</p>
                  <p>Tab reaches Cancel to stop recording. System keys and Ctrl-C keep their usual job.</p>
                  <div className="keys-actions">
                    <Button onClick={() => send({ type: "cancel" })}>Cancel</Button>
                    <Button onClick={() => send({ type: "escape-key" })}>Record Escape</Button>
                  </div>
                </div>
              )}
              {recording._tag === "candidate" && (
                <div>
                  <p>New key</p>
                  <Keycaps keys={keys} on={recording.keys} />
                  {conflicts.map((r) => (
                    <p key={r.does}>Saving moves this key from {r.does}. Its other keys stay.</p>
                  ))}
                  <div className="keys-actions">
                    <Button onClick={() => send({ type: "save" })}>Save</Button>
                    <Button onClick={() => send({ type: recording.add ? "add" : "change" })}>Record again</Button>
                    <Button onClick={() => send({ type: "cancel" })}>Cancel</Button>
                  </div>
                </div>
              )}
              {row?.keys.length === 0 && <p>No key. This command is still available in the command palette and tsh.</p>}
            </>
          )}
        </div>
      </div>
      <div ref={result} tabIndex={-1} className="keys-result" role="status">
        {/* While a save runs, the line says so and nothing older: focus rests here then. A failed
				    save's words, in the alert above, replace the last result. */}
        {busy && <p>Saving...</p>}
        {!busy && editor.save !== "failed" && latest !== undefined && (
          <>
            <p>{latest.how === "file" ? "File change applied." : "Keys saved."}</p>
            {latest.displaced.map((lost) => (
              <p key={`${lost.does}:${spelling(lost.key)}`}>
                {bindingFor(lost.does)?.name ?? lost.does} lost {spoken(keys, lost.key)}.
              </p>
            ))}
          </>
        )}
        {!busy && editor.undo !== null && (
          <Button size="sm" disabled={busy || choosing} onClick={() => send({ type: "undo" })}>
            Undo
          </Button>
        )}
      </div>
      <details className="keys-system">
        <summary>Not ours</summary>
        {mac ? (
          <>
            <p>macOS owns these keys. Recording, the prefix and ignore cannot take them.</p>
            <ul>
              {[...THE_MACS].map((key) => (
                <li key={key}>
                  <Kbd>{capOf(key)}</Kbd> {systemReason[key] ?? "System shortcut"}
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p>
            Your system keeps its own shortcuts, such as switching windows, and the app never hears them, so recording
            cannot take them.
          </p>
        )}
        <p>Ctrl-C stays with the tile program.</p>
      </details>
      {close !== undefined && (
        <Button aria-label="Close keyboard shortcuts" disabled={busy} onClick={close}>
          Close
        </Button>
      )}
    </section>
  );
}
