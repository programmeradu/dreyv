import { registerOTel } from '@vercel/otel';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';

export function register() {
  registerOTel({
    serviceName: 'dreyv-app',
    traceExporter: new OTLPTraceExporter({
      url: 'https://nexus.bugbybug.com/v1/traces',
      headers: {
        'x-api-key': 'bbb_fqsAW8FwCCUpNP4f3IgGWV3cBSWedYzP'
      }
    })
  });
}
