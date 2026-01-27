// ⚠️ IMPORTANT: OpenTelemetry est chargé de manière lazy pour éviter les timeouts au démarrage
// Les imports sont faits dynamiquement seulement si le tracing est activé

let sdk;
let initialized = false;

async function initializeTracing() {
  if (initialized) return;
  initialized = true;

  // ✅ Charger les modules OpenTelemetry de manière lazy
  const { NodeSDK } = await import("@opentelemetry/sdk-node");
  const { getNodeAutoInstrumentations } = await import("@opentelemetry/auto-instrumentations-node");
  const { OTLPTraceExporter } = await import("@opentelemetry/exporter-trace-otlp-http");
  const { Resource } = await import("@opentelemetry/resources");
  const { SemanticResourceAttributes } = await import("@opentelemetry/semantic-conventions");

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
}

// Initialiser de manière non-bloquante après le démarrage du serveur
if (typeof setImmediate !== "undefined") {
  setImmediate(() => {
    initializeTracing().catch(err => {
      console.error("❌ [TRACING] Initialization error:", err.message);
    });
  });
}

export async function shutdownTracing() {
  // S'assurer que le tracing est initialisé avant de le fermer
  if (!initialized) {
    await initializeTracing();
  }
  
  if (!sdk) return;
  try {
    await sdk.shutdown();
  } catch (err) {
    console.error("OpenTelemetry shutdown error:", err);
  }
}
