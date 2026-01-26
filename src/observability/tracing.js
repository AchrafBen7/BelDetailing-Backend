import { NodeSDK } from "@opentelemetry/sdk-node";
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { Resource } from "@opentelemetry/resources";
import { SemanticResourceAttributes } from "@opentelemetry/semantic-conventions";

let sdk;

const endpoint =
  process.env.OTEL_EXPORTER_OTLP_ENDPOINT || process.env.OTEL_TRACES_ENDPOINT;
const enabled = process.env.OTEL_TRACING_ENABLED === "true" || Boolean(endpoint);

if (enabled) {
  console.log("🔄 [TRACING] Initializing OpenTelemetry...");
  const exporter = endpoint ? new OTLPTraceExporter({ url: endpoint }) : undefined;
  sdk = new NodeSDK({
    resource: new Resource({
      [SemanticResourceAttributes.SERVICE_NAME]:
        process.env.OTEL_SERVICE_NAME || "beldetailing-api",
      [SemanticResourceAttributes.SERVICE_VERSION]:
        process.env.npm_package_version,
    }),
    traceExporter: exporter,
    instrumentations: [getNodeAutoInstrumentations()],
  });

  // Démarrer OpenTelemetry de manière non-bloquante avec timeout
  setImmediate(() => {
    const timeout = setTimeout(() => {
      console.warn("⚠️ [TRACING] OpenTelemetry start timeout, continuing without tracing");
    }, 2000); // Timeout de 2 secondes

    sdk.start()
      .then(() => {
        clearTimeout(timeout);
        console.log("✅ [TRACING] OpenTelemetry started successfully");
      })
      .catch(err => {
        clearTimeout(timeout);
        console.error("❌ [TRACING] OpenTelemetry start error:", err.message);
      });
  });
} else {
  console.log("ℹ️ [TRACING] OpenTelemetry disabled (OTEL_TRACING_ENABLED not set or no endpoint)");
}

export async function shutdownTracing() {
  if (!sdk) return;
  try {
    await sdk.shutdown();
  } catch (err) {
    console.error("OpenTelemetry shutdown error:", err);
  }
}
