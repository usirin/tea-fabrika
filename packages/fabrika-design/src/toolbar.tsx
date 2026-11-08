import {Button, Kbd} from "@manti-ui/react";

export function Toolbar({
	commands,
	send,
}: {
	readonly commands: readonly {
		readonly id: string;
		readonly name: string;
		readonly keys: readonly string[];
		readonly send: {readonly type: string; readonly value: unknown};
	}[];
	readonly send: (value: any) => void;
}) {
	return (
		<div role="toolbar" aria-label="Inbox actions" className="inbox-toolbar">
			{commands.map((command) => (
				<Button
					type="button"
					key={command.id}
					size="sm"
					variant="tertiary"
					aria-keyshortcuts={command.keys.length ? command.keys.join(" ") : undefined}
					onClick={() => send(command.send)}
				>
					{command.name}
					{command.keys.length > 0 && <Kbd>{command.keys.join(" / ")}</Kbd>}
				</Button>
			))}
		</div>
	);
}
