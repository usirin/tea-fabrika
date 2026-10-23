// `@kampus/fabrika/agents/trace`: an agent's turns and tool calls as spans,
// under the Effect span that ran it, with the agent's words kept out of
// export. For an agent on tea's runtime (`agentTrace`) and for an Agent SDK
// run (`sdkTrace`). It needs OpenTelemetry and the Agent SDK, so it is apart
// from `/agents/claude`, which needs only the SDK.
export * from "./trace/agent.ts";
export * from "./trace/sdk-events.ts";
