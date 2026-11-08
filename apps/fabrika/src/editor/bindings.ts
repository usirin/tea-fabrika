import type {Command} from "./keys.ts";

export const promptKeys: Readonly<Record<Exclude<Command, "interrupt">, readonly string[]>> = {
	"beginning-of-line": ["<c-a>", "<home>"],
	"end-of-line": ["<c-e>", "<end>"],
	"backward-char": ["<c-b>", "<arrowleft>"],
	"forward-char": ["<c-f>", "<arrowright>"],
	"backward-word": ["<a-b>"],
	"forward-word": ["<a-f>"],
	"backward-delete-char": ["<backspace>"],
	"delete-char": ["<delete>"],
	"kill-line": ["<c-k>"],
	"unix-line-discard": ["<c-u>"],
	"unix-word-rubout": ["<c-w>"],
	"kill-word": ["<a-d>"],
	"backward-kill-word": ["<a-backspace>"],
	yank: ["<c-y>"],
	"transpose-chars": ["<c-t>"],
	"clear-screen": ["<c-l>"],
	"accept-line": ["<enter>"],
	"previous-history": ["<c-p>", "<arrowup>"],
	"next-history": ["<c-n>", "<arrowdown>"],
	"reverse-search-history": ["<c-r>"],
	complete: ["<tab>"],
	"end-of-file": ["<c-d>"],
};
export const searchKeys = {
	exit: ["<escape>", "<c-g>"],
	again: ["<c-r>"],
	accept: ["<enter>"],
	back: ["<backspace>"],
	"beginning-of-line": promptKeys["beginning-of-line"],
} as const;
