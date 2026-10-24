import type {WindowProps} from "@kampus/fabrika";
import {useEffect, useRef} from "react";
import type {terminal} from "./program.ts";
import {useTerminal} from "./use-terminal.ts";
import type {View} from "./view.ts";

type Props = WindowProps<ReturnType<typeof terminal>> & {connected?: boolean; active?: boolean};

export function TerminalWindow(props: Props) {
	return <Session key={props.view.id ?? "opening"} {...props} />;
}

function Session({view, send, connected = true, active = true}: Props) {
	const cursor = useRef(0);
	const {ref, terminal, write, failure, output} = useTerminal({
		enabled: connected && view.phase === "running",
		active,
		onData: (data) => send({type: "action", value: {type: "input", data}}),
		onResize: ({cols, rows}) => {
			if (cols >= 2 && rows >= 2)
				send({
					type: "action",
					value: {type: "resize", cols: Math.min(cols, 400), rows: Math.min(rows, 400)},
				});
		},
	});
	useEffect(() => {
		if (terminal === null) {
			cursor.current = 0;
			return;
		}
		for (const chunk of view.chunks) if (chunk.seq >= cursor.current) write(chunk.data);
		cursor.current = view.next;
	}, [view, terminal, write]);
	useEffect(() => {
		if (active) terminal?.focus();
	}, [active, terminal]);
	const key = (data: string) => {
		terminal?.input(data, true);
		terminal?.focus();
	};
	const phase = {
		opening: "Opening terminal…",
		running: "Terminal ready",
		exited: `Process exited (${view.code})`,
		stopped: "Process stopped",
	} satisfies Record<View["phase"], string>;
	return (
		<section
			className="terminal"
			aria-label="Interactive terminal"
			data-shell-pid={view.pid}
			data-session={view.id}
			data-cols={view.cols}
			data-rows={view.rows}
			data-renderer="ghostty"
		>
			<div className="terminal-tools">
				<span>{phase[view.phase]}</span>
				<button
					type="button"
					disabled={!connected || view.phase !== "running"}
					onClick={() => key("\u001b")}
				>
					Esc
				</button>
				<button
					type="button"
					disabled={!connected || view.phase !== "running"}
					onClick={() => key("\u0003")}
				>
					Ctrl+C
				</button>
				<span className="hint">Connected host{view.pid === null ? "" : ` · PID ${view.pid}`}</span>
			</div>
			<section className="terminal-ports" aria-label="Program ports">
				<span>
					<i aria-hidden="true" />
					IN <code>stdin</code>
					<small>text · {view.stdin.bytes} B</small>
				</span>
				<span>
					OUT <code>stdout</code>
					<small>text · {view.stdout.bytes} B</small>
					<i aria-hidden="true" />
				</span>
			</section>
			{failure && <p role="alert">{failure}</p>}
			<div className="terminal-screen" ref={ref} />
			<pre className="terminal-accessible" role="log" aria-label="Terminal output">
				{output}
			</pre>
			{(view.phase === "exited" || view.phase === "stopped") && (
				<p className="terminal-ended">Open a new Terminal from Programs to start another shell.</p>
			)}
		</section>
	);
}
