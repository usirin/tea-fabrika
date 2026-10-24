import {TerminalWindow} from "@tea-fabrika/terminal/window";
import {useEffect, useId, useRef, useState} from "react";
import type {Message, View} from "./terminal-pipe-view.ts";

const preview = (text: string) =>
	text
		.replaceAll(/\r\n|\r|\n/g, " ↵ ")
		.replaceAll("\t", " ⇥ ")
		.replaceAll("\u001b", "␛")
		.slice(0, 96) || "Waiting for text";

export function TerminalPipeWindow({
	view,
	send,
	connected,
	active,
}: {
	view: View;
	send: (message: Message) => void;
	connected: boolean;
	active: boolean;
}) {
	const [side, focus] = useState<"from" | "to">("from");
	const [pulse, animate] = useState(0);
	const previous = useRef({id: view.from.id, sent: view.link.sent});
	const marker = useId().replaceAll(":", "");
	useEffect(() => {
		if (previous.current.id !== view.from.id) animate(0);
		else if (view.link.sent > previous.current.sent) animate((value) => value + 1);
		previous.current = {id: view.from.id, sent: view.link.sent};
	}, [view.from.id, view.link.sent]);
	const running = view.from.phase === "running" && view.to.phase === "running";
	const ready = connected && running && view.failure === null;
	const state = !connected
		? "View disconnected"
		: view.failure
			? "Failed"
			: !running
				? view.from.phase === "opening" || view.to.phase === "opening"
					? "Starting"
					: "Stopped"
				: view.link.enabled
					? "Connected"
					: "Paused";
	const packet = view.link.packets.findLast((packet) => packet.status === "queued");
	return (
		<section
			className="pipe-window"
			aria-label="Terminal pipe demo"
			data-pipe-sent={view.link.sent}
		>
			<div className="pipe-heading">
				<div>
					<p className="eyebrow">Program to program</p>
					<h2>Text in. Another program answers.</h2>
					<p className="hint">
						Type in the left terminal and press Enter. Its output becomes the right terminal’s
						input.
					</p>
				</div>
				<div className="pipe-actions">
					<button
						type="button"
						disabled={!ready}
						onClick={() => send({type: "link", enabled: !view.link.enabled})}
					>
						{view.link.enabled ? "Pause connection" : "Resume connection"}
					</button>
					<button type="button" disabled={!connected} onClick={() => send({type: "restart"})}>
						Restart demo
					</button>
				</div>
			</div>
			{view.failure && (
				<p className="notice" role="alert">
					{view.failure}
				</p>
			)}
			<div className="pipe-stage">
				<section
					className="pipe-node"
					aria-label="Sender terminal"
					onPointerDownCapture={() => focus("from")}
				>
					<header className="pipe-node-heading">
						<div>
							<span className="pipe-node-number">01</span>
							<strong>Sender</strong>
							<code>cat</code>
						</div>
						<span className="pipe-port">
							<span>stdout</span>
							<small>text</small>
							<i aria-hidden="true" />
						</span>
					</header>
					<TerminalWindow
						view={view.from}
						send={({type, value}) =>
							send({
								type: "terminal",
								side: "from",
								message: type === "action" ? value : {type: "input", data: value},
							})
						}
						connected={connected && view.failure === null}
						active={active && side === "from"}
					/>
					<div className="pipe-node-footer">
						<span>Input appears when you press Enter.</span>
						<button
							type="button"
							disabled={!ready}
							onClick={() =>
								send({
									type: "terminal",
									side: "from",
									message: {type: "input", data: "hello bro\r"},
								})
							}
						>
							Send hello bro ↵
						</button>
					</div>
				</section>
				<div className="pipe-connection" data-link-enabled={view.link.enabled}>
					<svg
						className="pipe-wire"
						viewBox="0 0 160 100"
						role="img"
						aria-label={`stdout to stdin, ${state.toLowerCase()}`}
					>
						<defs>
							<marker
								id={marker}
								viewBox="0 0 10 10"
								refX="8"
								refY="5"
								markerWidth="5"
								markerHeight="5"
								orient="auto-start-reverse"
							>
								<path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor" />
							</marker>
						</defs>
						<path
							className="pipe-wire-track"
							d="M 0 50 C 40 50 100 50 154 50"
							fill="none"
							stroke="currentColor"
							strokeWidth="2"
							strokeDasharray={view.link.enabled ? undefined : "5 7"}
							markerEnd={`url(#${marker})`}
						/>
						{pulse > 0 && connected && (
							<g key={pulse} className="pipe-packet">
								<circle r="5" fill="currentColor" />
								<text y="-13" textAnchor="middle" fill="currentColor">
									{packet ? preview(packet.text).slice(0, 20) : "text"}
								</text>
								<animateMotion dur="1.1s" path="M 0 50 C 40 50 100 50 154 50" fill="freeze" />
							</g>
						)}
					</svg>
					<div className="pipe-link-status">
						<span className="pipe-status-dot" aria-hidden="true" />
						<span role="status">{state}</span>
					</div>
					<div className="pipe-link-type">
						<code>stdout → stdin</code>
						<span>text → text</span>
					</div>
					<div className="pipe-transfer">
						<strong>{view.link.sent}</strong>
						<span>chunks queued</span>
						<small>{view.link.bytes} bytes</small>
					</div>
					{!view.link.enabled && (
						<p className="hint">New text stays on the left. It is not buffered for later.</p>
					)}
				</div>
				<section
					className="pipe-node"
					aria-label="Receiver terminal"
					onPointerDownCapture={() => focus("to")}
				>
					<header className="pipe-node-heading">
						<span className="pipe-port">
							<i aria-hidden="true" />
							<span>stdin</span>
							<small>text</small>
						</span>
						<div>
							<span className="pipe-node-number">02</span>
							<strong>Receiver</strong>
							<code>tr lower → UPPER</code>
						</div>
					</header>
					<TerminalWindow
						view={view.to}
						send={({type, value}) =>
							send({
								type: "terminal",
								side: "to",
								message: type === "action" ? value : {type: "input", data: value},
							})
						}
						connected={connected && view.failure === null}
						active={active && side === "to"}
					/>
					<div className="pipe-node-footer">
						<span>
							The native <code>tr</code> process makes the letters uppercase.
						</span>
					</div>
				</section>
			</div>
			<div className="pipe-inspector">
				<section className="pipe-latest" aria-label="Current port values">
					<h3>At the ports</h3>
					<dl>
						<div>
							<dt>Sender · stdin</dt>
							<dd>{preview(view.from.stdin.last)}</dd>
						</div>
						<div>
							<dt>Sender · stdout</dt>
							<dd>{preview(view.from.stdout.last)}</dd>
						</div>
						<div>
							<dt>Receiver · stdin</dt>
							<dd>{preview(view.to.stdin.last)}</dd>
						</div>
						<div>
							<dt>Receiver · stdout</dt>
							<dd>{preview(view.to.stdout.last)}</dd>
						</div>
					</dl>
				</section>
				<section className="pipe-traffic" aria-label="Connection traffic">
					<header>
						<h3>Traffic</h3>
						<span>{view.link.dropped} chunks discarded while paused</span>
					</header>
					<div role="log" aria-label="Pipe traffic log">
						{view.link.packets.length === 0 ? (
							<p className="hint">
								Send a line to see the actual values moving through this connection.
							</p>
						) : (
							[...view.link.packets].reverse().map((packet) => (
								<div className="pipe-traffic-row" key={packet.id}>
									<span className="pipe-sequence">#{packet.id + 1}</span>
									<code>{preview(packet.text)}</code>
									<span>{packet.bytes} B</span>
									<strong>{packet.status}</strong>
								</div>
							))
						)}
					</div>
				</section>
			</div>
			<p className="pipe-explanation">
				Two native processes. Two terminal programs. Fabrika checks the text ports and carries each
				value on the host. Closing this view keeps the connection running.
			</p>
		</section>
	);
}
