# What the tsh terminal checks share. `want` waits for exact text on the
# terminal and fails the check, with what it was waiting for, when it does not
# come. `key` types one key, as a person does: readline takes a Tab in a chunk
# of several keys as pasted text, not as completion.
set timeout 10
log_user 1

proc want {text} {
	expect {
		-ex $text {}
		timeout { puts "\nCHECK FAILED: timed out waiting for: $text"; exit 2 }
		eof { puts "\nCHECK FAILED: tsh ended while waiting for: $text"; exit 3 }
	}
}

proc key {k} {
	send -- $k
	sleep 0.15
}

proc ended {} {
	expect {
		eof {}
		timeout { puts "\nCHECK FAILED: tsh did not end"; exit 4 }
	}
	return [lindex [wait] 3]
}
