#!/bin/sh
# Run by the agent through Bash, inside the SDK's sandbox. It prints what the box let through.
echo "env: ${EXP155_ENV:-unset}"
echo "ctrl: ${EXP155_CTRL:-unset}"
if (echo x > "{{OUTSIDE}}/sbx-probe") 2>/dev/null; then echo "outside-write: ok"; else echo "outside-write: denied"; fi
code=$(curl -s -m 5 -o /dev/null -w "%{http_code}" https://example.com 2>/dev/null)
echo "net: ${code:-none}"
