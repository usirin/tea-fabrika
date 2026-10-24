import {TerminalWindow} from "@tea-fabrika/terminal/window";
import {Effect, Exit, Schema} from "effect";
import {useCallback, useEffect, useRef, useState} from "react";
import {createRoot} from "react-dom/client";
import {CounterWindow} from "./counter/window.tsx";
import {catalog, type Message as DeskMessage} from "./desk.ts";
import {Cloud, type FromPage, Session, type Snapshot, ToPage} from "./protocol.ts";
import {TerminalPipeWindow} from "./terminal-pipe-window.tsx";
import type {Message as TshMessage, View as TshView} from "./tsh.ts";
import "./style.css";

const decode = Schema.decodeUnknownSync(Schema.fromJsonString(ToPage));
type Outgoing = FromPage extends infer E ? (E extends FromPage ? Omit<E, "id"> : never) : never;

function TshWindow({
	view,
	send,
	connected,
	active,
}: {
	view: TshView;
	send: (message: TshMessage) => void;
	connected: boolean;
	active: boolean;
}) {
	const [line, draft] = useState("");
	const input = useRef<HTMLInputElement>(null);
	const output = useRef<HTMLDivElement>(null);
	useEffect(() => {
		if (active && view.ready) input.current?.focus();
	}, [active, view.ready]);
	useEffect(() => {
		if (view.lines.length > 0 && output.current)
			output.current.scrollTop = output.current.scrollHeight;
	}, [view.lines]);
	return (
		<section className="tsh" aria-label="tsh shell">
			<div className="tsh-output" ref={output} role="log" aria-label="tsh output">
				{view.lines.join("\n")}
			</div>
			<form
				className="tsh-prompt"
				onSubmit={(event) => {
					event.preventDefault();
					if (!connected || !view.ready || !line.trim()) return;
					send({type: "line", line});
					draft("");
				}}
			>
				<label htmlFor={active ? "active-prompt" : undefined}>tsh ›</label>
				<input
					id={active ? "active-prompt" : undefined}
					aria-label="tsh command"
					ref={input}
					value={line}
					placeholder="counter, terminal, pipe, or help"
					autoComplete="off"
					spellCheck={false}
					disabled={!connected || !view.ready}
					onChange={(event) => draft(event.target.value)}
					onKeyDown={(event) => {
						if (event.key === "Escape") {
							event.preventDefault();
							draft("");
						}
						if (event.ctrlKey && event.key.toLowerCase() === "c") {
							event.preventDefault();
							draft("");
							send({type: "interrupt"});
						}
					}}
				/>
				<button type="submit" disabled={!connected || !view.ready || !line.trim()}>
					Run
				</button>
				{!view.ready && (
					<button type="button" disabled={!connected} onClick={() => send({type: "interrupt"})}>
						Stop command
					</button>
				)}
			</form>
			<p className="hint">Type a program name. A program with a window takes over this pane.</p>
		</section>
	);
}

function App() {
	const [snapshot, show] = useState<Snapshot | null>(null);
	const [connection, status] = useState("Connecting");
	const [paused, pause] = useState(false);
	const [failure, fail] = useState<string | null>(null);
	const [place, located] = useState<"local" | "sandbox">("local");
	const [cloud, saved] = useState<typeof Cloud.Type | null>(null);
	const [saving, savingNow] = useState(false);
	const refreshCloud = useCallback(
		() =>
			fetch(new URL("cloud/state", location.href), {cache: "no-store"})
				.then((response) => {
					if (!response.ok) throw Error("Could not read cloud save status.");
					return response.json();
				})
				.then(Schema.decodeUnknownSync(Cloud))
				.then(saved),
		[],
	);
	useEffect(() => {
		if (place !== "sandbox") return;
		const refresh = () => {
			void refreshCloud().catch((cause) => fail(String(cause)));
		};
		refresh();
		const interval = setInterval(refresh, 10_000);
		return () => clearInterval(interval);
	}, [place, refreshCloud]);
	const saveCloud = async (sleep: boolean) => {
		savingNow(true);
		pause(true);
		await (async () => {
			const response = await fetch(new URL(sleep ? "cloud/sleep" : "cloud/save", location.href), {
				method: "POST",
			});
			if (!response.ok)
				throw Error("Save failed. The live disk and last complete save were retained.");
			await refreshCloud();
			if (!sleep) pause(false);
		})()
			.catch((cause: unknown) => {
				fail(String(cause));
				pause(false);
			})
			.finally(() => savingNow(false));
	};
	const socket = useRef<WebSocket | null>(null);
	useEffect(() => {
		let stopped = false;
		let retry: ReturnType<typeof setTimeout> | undefined;
		const connect = () => {
			if (stopped) return;
			status("Connecting");
			void fetch(new URL("session", location.href), {cache: "no-store"})
				.then((response) => {
					if (!response.ok) throw Error("Could not open the desk.");
					return response.json();
				})
				.then(Schema.decodeUnknownSync(Session))
				.then((session) => {
					if (stopped) return;
					located(session.place);
					const target = new URL("ws", location.href);
					target.protocol = location.protocol === "https:" ? "wss:" : "ws:";
					target.searchParams.set("token", session.token);
					const ws = new WebSocket(target);
					socket.current = ws;
					ws.onopen = () => {
						status("Connected");
						fail(null);
					};
					ws.onmessage = (event) => {
						const frame = Effect.runSyncExit(Effect.try(() => decode(String(event.data))));
						if (Exit.isFailure(frame)) {
							fail("The host sent an unreadable view.");
							return;
						}
						if (frame.value.type === "state") show(frame.value);
						else fail(frame.value.why);
					};
					ws.onclose = () => {
						if (!stopped) {
							status("Reconnecting");
							retry = setTimeout(connect, 400);
						}
					};
					ws.onerror = () => fail("Connection interrupted. Input is paused until reconnection.");
				})
				.catch(() => {
					if (!stopped) {
						status("Reconnecting");
						retry = setTimeout(connect, 400);
					}
				});
		};
		if (paused) status("Disconnected");
		else connect();
		return () => {
			stopped = true;
			clearTimeout(retry);
			socket.current?.close();
			socket.current = null;
		};
	}, [paused]);
	const send = (message: Outgoing) => {
		if (socket.current?.readyState !== WebSocket.OPEN) {
			fail("Disconnected. That action was not sent.");
			return;
		}
		socket.current.send(JSON.stringify({...message, id: crypto.randomUUID()}));
	};
	const desk = (message: DeskMessage) => send({type: "desk", message});
	const connected = connection === "Connected";
	const panes = snapshot?.desk.panes ?? [];
	const selected = snapshot?.desk.active;
	const selectedKind = panes.find((pane) => pane.id === selected)?.kind;
	useEffect(() => {
		if (selected)
			document
				.querySelector(`[data-pane="${selected}"][data-kind="${selectedKind}"]`)
				?.scrollIntoView({block: "nearest"});
	}, [selected, selectedKind]);
	return (
		<div className="app">
			<header className="app-header">
				<div className="brand">
					<strong>fabrika</strong>
					<span>Your desk</span>
				</div>
				<div className="connection">
					<span data-connection role="status">
						{connection}
					</span>
					<button type="button" onClick={() => pause(!paused)}>
						{paused ? "Reconnect" : "Disconnect"}
					</button>
				</div>
			</header>
			<aside className="sidebar" aria-label="Desk navigation">
				<div className="sidebar-top">
					<h2>Panes</h2>
					<button
						type="button"
						disabled={!connected}
						onClick={() => desk({type: "open", kind: "tsh", pane: crypto.randomUUID()})}
					>
						New pane
					</button>
				</div>
				<p className="hint">New panes start with tsh.</p>
				<nav aria-label="Your panes">
					{panes.map((pane, index) => (
						<button
							type="button"
							key={pane.id}
							className="pane-link"
							aria-current={snapshot?.desk.active === pane.id ? "true" : undefined}
							disabled={!connected}
							onClick={() => desk({type: pane.open ? "focus" : "show", pane: pane.id})}
						>
							<span>
								{pane.title}
								<span className="pane-number">{index + 1}</span>
							</span>
							<small>{pane.open ? "Window open" : "Window closed · reopen"}</small>
						</button>
					))}
				</nav>
				<button
					className="program-launch"
					type="button"
					disabled={!connected}
					onClick={() => desk({type: "open", kind: "pipe", pane: crypto.randomUUID()})}
				>
					<strong>Open terminal pipe</strong>
					<span>See text move between programs →</span>
				</button>
				<div className="sidebar-bottom">
					<h2>Try a program</h2>
					<p>
						<code>counter</code>
						<br />A little job with a saved state.
					</p>
					<p>
						<code>terminal</code>
						<br />A shell on the connected host.
					</p>
					<p className="hint">Closing a window keeps its program running.</p>
					{place === "sandbox" && (
						<section aria-label="Cloud workspace">
							<h2>Cloud workspace</h2>
							<p role="status">
								{saving
									? "Saving workspace…"
									: cloud?.saved
										? `Saved ${new Date(cloud.saved).toLocaleTimeString()}`
										: "No saved copy yet"}
							</p>
							<button
								type="button"
								disabled={saving || !connected}
								onClick={() => {
									void saveCloud(false);
								}}
							>
								Save workspace
							</button>
							<button
								type="button"
								disabled={saving || !connected}
								onClick={() => {
									void saveCloud(true);
								}}
							>
								Save and sleep
							</button>
							<p className="hint">
								Saving stops programs briefly and restarts shells. Files and saved program state
								return. This preview also saves and sleeps 30 minutes after every browser
								disconnects.
							</p>
							{cloud?.failure && <p role="alert">{cloud.failure}</p>}
						</section>
					)}
				</div>
			</aside>
			<main className="workspace" aria-label="Workspace">
				{failure && (
					<div className="notice" role="alert">
						<span>{failure}</span>
						<button type="button" onClick={() => fail(null)}>
							Dismiss
						</button>
					</div>
				)}
				{!connected && snapshot && (
					<p className="notice">Showing the last received view. Programs continue on the host.</p>
				)}
				<div className="pane-grid">
					{panes
						.filter((pane) => pane.open)
						.map((pane) => {
							const window = snapshot?.windows.find((window) => window.id === pane.id);
							const active = snapshot?.desk.active === pane.id;
							return (
								<section
									className="pane"
									key={pane.id}
									data-pane={pane.id}
									data-kind={pane.kind}
									data-active={active}
									aria-label={`${pane.title} pane`}
									onPointerDown={() => {
										if (!active && connected) desk({type: "focus", pane: pane.id});
									}}
								>
									<header className="pane-header">
										<h2>{catalog[pane.kind].title}</h2>
										<div>
											{pane.kind !== "tsh" && (
												<button
													type="button"
													disabled={!connected}
													onClick={() => desk({type: "display", pane: pane.id, kind: "tsh"})}
												>
													Back to tsh
												</button>
											)}
											<button
												type="button"
												disabled={!connected}
												aria-label={`Close ${pane.title} window`}
												onClick={(event) => {
													event.stopPropagation();
													desk({type: "hide", pane: pane.id});
												}}
											>
												Close window
											</button>
										</div>
									</header>
									<div className="pane-body">
										{window?.kind === "counter" ? (
											<CounterWindow
												view={window.data}
												send={(message) => send({type: "counter", pane: pane.id, message})}
												connected={connected}
											/>
										) : window?.kind === "terminal" ? (
											<TerminalWindow
												view={window.data}
												send={({type, value}) =>
													send({
														type: "terminal",
														pane: pane.id,
														message: type === "action" ? value : {type: "input", data: value},
													})
												}
												connected={connected}
												active={active}
											/>
										) : window?.kind === "tsh" ? (
											<TshWindow
												view={window.data}
												send={(message) => send({type: "tsh", pane: pane.id, message})}
												connected={connected}
												active={active}
											/>
										) : window?.kind === "pipe" ? (
											<TerminalPipeWindow
												view={window.data}
												send={(message) => send({type: "pipe", pane: pane.id, message})}
												connected={connected}
												active={active}
											/>
										) : (
											<p>Starting program…</p>
										)}
									</div>
								</section>
							);
						})}
				</div>
				{connected && panes.every((pane) => !pane.open) && (
					<div className="empty">
						<p className="eyebrow">A little room to make things</p>
						<h1>Your programs are still here.</h1>
						<p>Reopen a pane from the left, or start a new one with tsh.</p>
						<button
							type="button"
							onClick={() => desk({type: "open", kind: "tsh", pane: crypto.randomUUID()})}
						>
							Open tsh
						</button>
					</div>
				)}
			</main>
			<footer className="app-footer">
				{place === "sandbox" ? "Cloud desk" : "Local desk"} · Tuval{" "}
				<span>One host, your programs, any open window.</span>
			</footer>
		</div>
	);
}
const root = document.getElementById("app");
if (root) createRoot(root).render(<App />);
