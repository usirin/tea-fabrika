// `@kampus/fabrika-old/otel`: spans out over OpenTelemetry. The tracer Layer
// (OTLP, or kept in memory for a test) and the view rules a trace viewer
// reads. Everything else traces in Effect's own terms and names no exporter.
export * from "./shell/trace/otel.ts";
export * from "./shell/trace/view.ts";
