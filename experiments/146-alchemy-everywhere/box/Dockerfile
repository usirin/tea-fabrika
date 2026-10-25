# Spike 2's box: the smallest stand-in for the box an agent might run in later. alpine:latest is
# already on this laptop, so the build pulls nothing. Every image and container of a run carries
# the label exp146=<run>, which is how the driver finds its own, and nothing else.
FROM alpine:latest
ARG RUN=none
LABEL exp146=$RUN
RUN adduser -D agent
USER agent
WORKDIR /home/agent
# PID 1 must answer SIGTERM itself, or `docker stop` waits its whole 10 s grace before SIGKILL.
# The first run used a bare `sleep 3600` and every stop took 10.2 s (the write-up keeps it).
CMD ["sh", "-c", "trap 'exit 0' TERM; sleep 3600 & wait"]
