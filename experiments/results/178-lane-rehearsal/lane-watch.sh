#!/bin/bash
# Waits until an ask with no answer appears or the driver ends, then prints what a person sees so far.
R=$1; max=${2:-1500}
for ((i = 0; i < max / 3; i++)); do
	sleep 3
	for w in "$R"/answers/*.waiting; do
		[ -e "$w" ] || continue
		a="${w%.waiting}"
		[ -e "$a" ] || break 2
	done
	grep -q 'driver exit' "$R/logs/driver.out" 2>/dev/null && break
done
sed "s#$R#<R>#g" "$R/logs/driver.out" | tail -n 25 | cut -c1-500
echo "--- waiting:"; for w in "$R"/answers/*.waiting; do [ -e "$w" ] && [ ! -e "${w%.waiting}" ] && cat "$w" && echo; done
echo "--- ticket, as it reads (since last ask):"
jq -r 'select(.fact.type=="commented" or .fact.type=="asked" or .fact.type=="answered")|"[\(.pos) \(.by.id // .by) \(.fact.type)] " + (.fact.body // .fact.what // .fact.pick) + (if .fact.picks then "  PICKS: " + (.fact.picks|join(", ")) else "" end)' "$R/logs/facts.jsonl" | tail -n ${3:-12} | cut -c1-6000
