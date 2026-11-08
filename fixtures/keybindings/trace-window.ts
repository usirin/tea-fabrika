import type {WindowProps} from "@kampus/fabrika-old";
import {trace} from "@tea-fabrika/trace";

type Props = WindowProps<typeof trace>;

const command = (word: keyof typeof trace.commands, send: Props["send"]) => {
	const run = () => send(trace.commands[word].send);
	return Object.assign(run, {
		keys: [],
		control: {
			onClick: run,
			"data-command": word,
			"data-command-program": trace.name,
			"data-command-mode": "",
		},
	});
};

export const windowProps = (view: Props["view"], send: Props["send"] = () => {}): Props => ({
	view,
	send,
	commands: {
		previous: command("previous", send),
		next: command("next", send),
		live: command("live", send),
		quit: command("quit", send),
	},
});
