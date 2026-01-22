import client from "prom-client";

const register = new client.Registry();
client.collectDefaultMetrics({ register });

const httpRequestDuration = new client.Histogram({
  name: "http_request_duration_ms",
  help: "Duration of HTTP requests in ms",
  labelNames: ["method", "route", "status_code"],
  buckets: [50, 100, 200, 300, 500, 1000, 2000, 5000],
});

const httpRequestsTotal = new client.Counter({
  name: "http_requests_total",
  help: "Total number of HTTP requests",
  labelNames: ["method", "route", "status_code"],
});

// ✅ NOUVELLES MÉTRIQUES : Missions et Paiements
const missionAgreementsTotal = new client.Counter({
  name: "mission_agreements_total",
  help: "Total number of mission agreements created",
  labelNames: ["status"],
});

const missionPaymentsTotal = new client.Counter({
  name: "mission_payments_total",
  help: "Total number of mission payments",
  labelNames: ["type", "status"],
});

const missionPaymentsAmount = new client.Counter({
  name: "mission_payments_amount_total",
  help: "Total amount of mission payments in euros",
  labelNames: ["type", "status"],
});

const missionTransfersTotal = new client.Counter({
  name: "mission_transfers_total",
  help: "Total number of transfers to detailers",
  labelNames: ["status"],
});

const missionTransfersAmount = new client.Counter({
  name: "mission_transfers_amount_total",
  help: "Total amount transferred to detailers in euros",
  labelNames: ["status"],
});

const missionInvoicesTotal = new client.Counter({
  name: "mission_invoices_total",
  help: "Total number of invoices generated",
  labelNames: ["type"],
});

const failedTransfersTotal = new client.Counter({
  name: "failed_transfers_total",
  help: "Total number of failed transfers",
  labelNames: ["retry_count"],
});

register.registerMetric(httpRequestDuration);
register.registerMetric(httpRequestsTotal);
register.registerMetric(missionAgreementsTotal);
register.registerMetric(missionPaymentsTotal);
register.registerMetric(missionPaymentsAmount);
register.registerMetric(missionTransfersTotal);
register.registerMetric(missionTransfersAmount);
register.registerMetric(missionInvoicesTotal);
register.registerMetric(failedTransfersTotal);

export function metricsMiddleware(req, res, next) {
  const endTimer = httpRequestDuration.startTimer();

  res.on("finish", () => {
    const route = req.route?.path
      ? `${req.baseUrl || ""}${req.route.path}`
      : req.path;
    const labels = {
      method: req.method,
      route,
      status_code: String(res.statusCode),
    };

    httpRequestsTotal.inc(labels);
    endTimer(labels);
  });

  next();
}

export async function metricsEndpoint(req, res) {
  res.set("Content-Type", register.contentType);
  res.end(await register.metrics());
}

// ✅ EXPORT DES MÉTRIQUES POUR UTILISATION DANS LES SERVICES
export {
  missionAgreementsTotal,
  missionPaymentsTotal,
  missionPaymentsAmount,
  missionTransfersTotal,
  missionTransfersAmount,
  missionInvoicesTotal,
  failedTransfersTotal,
};
