/**
 * Runtime instrumentation hook.
 *
 * The Vercel OTel exporter was removed as part of the Cloudflare migration —
 * `@vercel/otel` relies on Vercel-only runtime globals and pulls Node-only
 * OTLP transports that do not build on Workers. Tracing on Cloudflare is
 * handled by the platform (Workers Logs / Tail Workers) instead.
 */
export function register() {
  // no-op
}
