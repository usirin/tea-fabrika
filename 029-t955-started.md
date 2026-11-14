FYI: "Cloud lane: T955 sink frame cut" is started on Opus, branch fabrikalfa/cloud-t955-sink-cut stacked on fabrikalfa/t502-s1-connection, reporting through fabrikalfa/mail-t955.

- **The fix:** the opening and portable frame cut in `next/packages/libfabrika/src/telemetry/Sink.ts`, under 0186 and ticket 955. The child reads `f83e0e9e8` before the plan.
- **The laws:** the unmatched-paren folder case, the trailing `\r` case, and every case `f83e0e9e8` covered.
- **Steps:** the child's lead approves and signs the plan, then tests, build and one review, each by its own Opus agent.
- **Leans:** a lean goes in the PR body as the lead's lean. A walk-back or a loosening stops the lane with NEEDS ANSWER.
- **Pull request:** none from the cloud. You open the draft with base `fabrikalfa/t502-s1-connection`.
- **Reports:** to `fabrikalfa/mail-t955`, in the same shape as this branch. If that push is refused, the child writes its reports into its transcript, and I relay them here.
