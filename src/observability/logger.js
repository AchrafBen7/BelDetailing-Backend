import { randomUUID } from "crypto";
import pino from "pino";
import pinoHttp from "pino-http";

export const logger = pino({
  level: process.env.LOG_LEVEL || "info",
  redact: {
    paths: ["req.headers.authorization", "req.headers.cookie"],
    remove: true,
  },
  base: undefined,
});

export const httpLogger = pinoHttp({
  logger,
  genReqId: req => req.headers["x-request-id"] || randomUUID(),
});
