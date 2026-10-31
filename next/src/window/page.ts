// The page the brain serves: one root, the styles, and the window's script. Calm and plain.

const STYLE = `
:root { color-scheme: dark; --bg: #0f1114; --panel: #16191d; --line: #2a2f36; --text: #d6dae0;
  --faint: #7b8490; --focus: #6d9eeb; --good: #5fb37c; --warn: #d9a54a; }
* { box-sizing: border-box; }
html, body, #root { height: 100%; margin: 0; }
body { background: var(--bg); color: var(--text); overflow: hidden;
  font: 13px/1.4 -apple-system, "Segoe UI", system-ui, sans-serif; }
.desk { position: absolute; inset: 0 0 28px 0; }
.desk.empty { display: grid; place-items: center; color: var(--faint); }
.tile { position: absolute; display: flex; flex-direction: column; background: var(--panel);
  border: 1px solid var(--line); overflow: hidden; }
.tile.focused { border-color: var(--focus); box-shadow: inset 0 0 0 1px var(--focus); }
.tile-head { display: flex; justify-content: space-between; padding: 6px 10px;
  border-bottom: 1px solid var(--line); color: var(--faint); font-size: 12px; }
.tile.focused .tile-head { color: var(--text); }
.tile-shows { font-variant-numeric: tabular-nums; }
.counter { flex: 1; display: flex; flex-direction: column; align-items: center;
  justify-content: center; gap: 18px; }
.count { font-size: 64px; font-weight: 300; font-variant-numeric: tabular-nums; }
.plus { background: transparent; color: var(--text); border: 1px solid var(--line);
  border-radius: 4px; padding: 6px 18px; font: inherit; cursor: pointer; }
.plus:hover { border-color: var(--faint); }
.tile.folded { align-items: center; gap: 10px; padding-top: 10px; cursor: pointer;
  color: var(--faint); font-size: 12px; }
.strip-name { writing-mode: vertical-rl; }
.strip-count { font-variant-numeric: tabular-nums; color: var(--text); }
.status { position: absolute; left: 0; right: 0; bottom: 0; height: 28px; display: flex;
  align-items: center; gap: 10px; padding: 0 10px; border-top: 1px solid var(--line);
  font-size: 12px; white-space: nowrap; overflow: hidden; }
.dot { width: 8px; height: 8px; border-radius: 50%; background: var(--warn); }
.status[data-link="online"] .dot { background: var(--good); }
.status:not([data-link="online"]) [data-status] { color: var(--warn); }
body:has(.status:not([data-link="online"])) .tile { opacity: 0.55; }
.faint { color: var(--faint); }
.right { margin-left: auto; }
`;

export const PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>fabrika next</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>${STYLE}</style>
</head>
<body>
<div id="root"></div>
<script type="module" src="/window.js"></script>
</body>
</html>
`;
