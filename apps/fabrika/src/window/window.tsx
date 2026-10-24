import {type FormEvent, useEffect, useState} from "react";
import {createRoot} from "react-dom/client";
import {type Front, type PaneView, readToPage, type Tsh, type TshView} from "../messages.ts";
import {WINDOWS} from "./windows.tsx";

// The window: plain React, no UI library. It draws the pane it is shown, whole, each time: tsh,
// or the newest program window over it. It keeps only what a person is typing. What it sends
// goes through `window.fabrika.send`, to the run the pane names; the main process reads it.
//
//   Enter    sends the line to tsh
//   Ctrl-C   sends tsh `signal: interrupt`, from tsh or from a program's window: it stops what
//            runs in tsh's foreground, as a terminal's Ctrl-C does

const sendTo = (run: string, msg: unknown) =>
	window.fabrika.send({type: "msg", pane: "p1", to: run, msg});

const said = (state: Tsh) => {
	if (state.kind === "busy") return "running";
	if (state.kind === "ended") return `tsh ${state.how}`;
	return state.status === null ? "ready" : `ready, last status ${state.status}`;
};

function TshScreen({tsh}: {readonly tsh: TshView}) {
	const [draft, setDraft] = useState("");
	const submit = (e: FormEvent) => {
		e.preventDefault();
		sendTo(tsh.run, {type: "line", value: draft});
		setDraft("");
	};
	const text = tsh.lines.map((l) => (l.kind === "typed" ? `tsh> ${l.text}` : l.text)).join("\n");
	return (
		<main className="tsh">
			{/* A log: a screen reader reads each new line as it comes, as a terminal's output. */}
			<pre className="lines" role="log" aria-label="tsh output">
				{text}
			</pre>
			<form onSubmit={submit}>
				<label>
					<span className="prompt">tsh&gt;</span>
					<input
						aria-label="tsh line"
						value={draft}
						onChange={(e) => setDraft(e.target.value)}
						disabled={tsh.state.kind === "ended"}
						spellCheck={false}
						autoComplete="off"
						// biome-ignore lint/a11y/noAutofocus: a shell's line is where a person types first, as a terminal's prompt is.
						autoFocus
					/>
				</label>
			</form>
			<output className="status" aria-label="tsh status">
				{said(tsh.state)}
			</output>
		</main>
	);
}

function FrontWindow({front}: {readonly front: Front}) {
	const known = WINDOWS.get(front.program);
	return (
		<main className="front" aria-label={`${front.program} window`}>
			<header>
				<span>{front.program}</span>
				<small>Ctrl-C stops it</small>
			</header>
			{known === undefined ? (
				<p role="alert">no window for {front.program} in this app</p>
			) : (
				known.draw(front.data, (msg) => sendTo(front.run, msg))
			)}
		</main>
	);
}

function App() {
	const [pane, setPane] = useState<PaneView | null>(null);
	const [refused, setRefused] = useState<string | null>(null);
	useEffect(() => {
		window.fabrika.onView((raw) => {
			const read = readToPage(raw);
			if (read.kind === "read") setPane(read.msg.data);
			else setRefused(read.why);
		});
	}, []);
	const tshRun = pane?.tsh.run;
	useEffect(() => {
		if (tshRun === undefined) return;
		const onKey = (e: KeyboardEvent) => {
			// "C" too: Ctrl-Shift-C, or Caps Lock on, is still Ctrl-C to a terminal.
			if (!e.ctrlKey || e.key.toLowerCase() !== "c") return;
			e.preventDefault();
			sendTo(tshRun, {type: "signal", value: "interrupt"});
		};
		document.addEventListener("keydown", onKey);
		return () => document.removeEventListener("keydown", onKey);
	}, [tshRun]);
	if (refused !== null) return <p role="alert">refused a view from the app: {refused}</p>;
	if (pane === null) return <p className="starting">starting tsh</p>;
	const top = pane.front.at(-1);
	return top === undefined ? <TshScreen tsh={pane.tsh} /> : <FrontWindow front={top} />;
}

const root = document.getElementById("root");
if (root !== null) createRoot(root).render(<App />);
