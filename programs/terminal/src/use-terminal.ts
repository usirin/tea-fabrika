// Adapted from Wormhole's packages/ghostty-react at dc8526958b3ef4f2903e17aa1b4e83c5951aaf06.
// Only the rendering hook is shared; Fabrika owns the connection and native program lifetime.
import {FitAddon, init, Terminal} from "ghostty-web";
import {useCallback, useEffect, useRef, useState} from "react";

let loading: Promise<void> | undefined;
const load = () => {
	loading ??= init().catch((cause) => {
		loading = undefined;
		throw cause;
	});
	return loading;
};

export function useTerminal(options: {
	onData: (data: string) => void;
	onResize: (size: {cols: number; rows: number}) => void;
	enabled: boolean;
	active: boolean;
}) {
	const [element, ref] = useState<HTMLDivElement | null>(null);
	const [terminal, setTerminal] = useState<Terminal | null>(null);
	const [failure, failed] = useState<string | null>(null);
	const [output, text] = useState("");
	const current = useRef(options);
	current.current = options;
	useEffect(() => {
		if (element === null) return;
		let closed = false;
		let dispose = () => {};
		failed(null);
		void load()
			.then(() => {
				if (closed) return;
				const term = new Terminal({
					fontSize: 14,
					fontFamily: "ui-monospace, SFMono-Regular, monospace",
					cursorBlink: true,
					scrollback: 1000,
					disableStdin: !current.current.enabled,
				});
				const fit = new FitAddon();
				const input = term.onData((data) => {
					if (current.current.enabled) current.current.onData(data);
				});
				const resize = term.onResize((size) => {
					if (current.current.enabled) current.current.onResize(size);
				});
				term.loadAddon(fit);
				const previous = document.activeElement;
				term.open(element);
				fit.fit();
				// Clear after fitting, before replay: replacement sessions otherwise kept old rows.
				term.write("\u001bc\u001b[3J\u001b[2J\u001b[H");
				fit.observeResize();
				if (!current.current.active && previous instanceof HTMLElement) previous.focus();
				setTerminal(term);
				dispose = () => {
					input.dispose();
					resize.dispose();
					fit.dispose();
					term.dispose();
				};
			})
			.catch((cause) => {
				if (!closed) failed(`Terminal display failed: ${String(cause)}`);
			});
		return () => {
			closed = true;
			dispose();
			setTerminal(null);
		};
	}, [element]);
	useEffect(() => {
		if (terminal !== null) terminal.options.disableStdin = !options.enabled;
	}, [terminal, options.enabled]);
	const write = useCallback(
		(data: string) => {
			if (terminal === null) return;
			// Ghostty 0.4 declares onRender but never fires it. Read its parsed buffer after writes.
			terminal.write(data, () => {
				const buffer = terminal.buffer.active;
				const lines = [];
				for (let y = Math.max(0, buffer.length - 200); y < buffer.length; y++)
					lines.push(buffer.getLine(y)?.translateToString(true) ?? "");
				text(lines.join("\n"));
			});
		},
		[terminal],
	);
	return {ref, terminal, write, ready: terminal !== null, failure, output};
}
