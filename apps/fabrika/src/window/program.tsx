import {type ReactNode, useEffect, useState} from "react";
import {createRoot} from "react-dom/client";
import {readToWindow, type ToWindow} from "../messages.ts";
import {WINDOWS} from "./windows.tsx";

// A program's window: plain React, no UI library. It draws one run's view, whole, each time it
// is shown one, by the window its program has in the app (windows.tsx). What the window sends
// goes through `window.fabrika.send`; its port is its run's, so it names no run. The window
// holds no state of its own. Closing it is the person's "I am done": the run's inputs close
// (host.ts), and the program ends the way it ends on stdin's end.

const send = (msg: unknown) => window.fabrika.send({type: "msg", msg});

function Program({view}: {readonly view: ToWindow}): ReactNode {
	const known = WINDOWS.get(view.program);
	return (
		<main className="program" aria-label={`${view.program} window`}>
			{known === undefined ? (
				<p role="alert">no window for {view.program} in this app</p>
			) : (
				known.draw(view.data, send)
			)}
		</main>
	);
}

function App() {
	const [view, setView] = useState<ToWindow | null>(null);
	const [refused, setRefused] = useState<string | null>(null);
	useEffect(() => {
		window.fabrika.onMessage((raw) => {
			const read = readToWindow(raw);
			if (read.kind === "refused") return setRefused(read.why);
			document.title = read.msg.program;
			setView(read.msg);
		});
	}, []);
	if (refused !== null) return <p role="alert">refused a view from the app: {refused}</p>;
	if (view === null) return <p className="starting">starting</p>;
	return <Program view={view} />;
}

const root = document.getElementById("root");
if (root !== null) createRoot(root).render(<App />);
