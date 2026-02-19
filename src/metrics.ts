/**
 * Prometheus metrics middleware and endpoint.
 *
 * Uses prom-client directly with a dedicated Registry (rather than the global
 * default) to avoid conflicts if this server is embedded in a larger app.
 * Records HTTP request duration as a histogram with configurable labels.
 */

import type { Middleware } from "koa"
import { collectDefaultMetrics, Histogram, Registry } from "prom-client"

const register = new Registry()
collectDefaultMetrics({ register })

// Label configuration is read once at startup, not per-request.
// Each label adds a dimension to the histogram, increasing cardinality.
// Path is off by default because high-cardinality path labels can cause
// memory issues in Prometheus.
const {
  PROMETHEUS_WITH_PATH = "false",
  PROMETHEUS_WITH_METHOD = "true",
  PROMETHEUS_WITH_STATUS = "true",
} = process.env

const labelNames: string[] = []
if (PROMETHEUS_WITH_PATH === "true") labelNames.push("path")
if (PROMETHEUS_WITH_METHOD === "true") labelNames.push("method")
if (PROMETHEUS_WITH_STATUS === "true") labelNames.push("status")

const httpDuration = new Histogram({
  name: "http_request_duration_seconds",
  help: "Duration of HTTP requests in seconds",
  labelNames,
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [register],
})

/** Serves the /metrics endpoint with Prometheus text format. */
export const metricsEndpoint: Middleware = async (ctx) => {
  ctx.set("Content-Type", register.contentType)
  ctx.body = await register.metrics()
}

/**
 * Wraps downstream middleware with duration tracking.
 * Uses startTimer() which returns a function that records the elapsed
 * duration when called — a standard prom-client pattern.
 */
export const metricsMiddleware: Middleware = async (ctx, next) => {
  const end = httpDuration.startTimer()
  await next()
  const labels: Record<string, string> = {}
  if (PROMETHEUS_WITH_PATH === "true") labels.path = ctx.path
  if (PROMETHEUS_WITH_METHOD === "true") labels.method = ctx.method
  if (PROMETHEUS_WITH_STATUS === "true") labels.status = String(ctx.status)
  end(labels)
}
