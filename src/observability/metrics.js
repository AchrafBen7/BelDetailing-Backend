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

register.registerMetric(httpRequestDuration);
register.registerMetric(httpRequestsTotal);

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
