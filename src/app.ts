/**
 * Koa app factory — creates and configures the Koa application with all
 * middleware. Separated from server startup (index.ts) so the app can be
 * imported directly in tests without starting HTTP listeners.
 */

import { existsSync, readFileSync } from "node:fs"
import Koa from "koa"
import pino from "pino"
import { echoHandler } from "./echo.js"
import { metricsEndpoint, metricsMiddleware } from "./metrics.js"

export function createApp() {
  const DISABLE_REQUEST_LOGS = process.env.DISABLE_REQUEST_LOGS === "true"
  const LOG_IGNORE_PATH = process.env.LOG_IGNORE_PATH
    ? new RegExp(process.env.LOG_IGNORE_PATH)
    : null
  const LOG_WITHOUT_NEWLINE = process.env.LOG_WITHOUT_NEWLINE === "true"

  const ECHO_BACK_TO_CLIENT = process.env.ECHO_BACK_TO_CLIENT !== "false"
  const OVERRIDE_FILE = process.env.OVERRIDE_RESPONSE_BODY_FILE_PATH
  const PRESERVE_HEADER_CASE = process.env.PRESERVE_HEADER_CASE === "true"
  const INCLUDE_ENV_VARS = process.env.ECHO_INCLUDE_ENV_VARS === "true"
  const JWT_HEADER = process.env.JWT_HEADER

  const CORS_ORIGIN = process.env.CORS_ALLOW_ORIGIN
  const CORS_METHODS = process.env.CORS_ALLOW_METHODS
  const CORS_HEADERS = process.env.CORS_ALLOW_HEADERS
  const CORS_CREDENTIALS = process.env.CORS_ALLOW_CREDENTIALS

  const PROMETHEUS_ENABLED = process.env.PROMETHEUS_ENABLED === "true"
  const PROMETHEUS_PATH = process.env.PROMETHEUS_METRICS_PATH || "/metrics"

  // Pre-read the override file at startup so we don't hit the filesystem
  // on every request.
  const overrideBody =
    OVERRIDE_FILE && existsSync(OVERRIDE_FILE)
      ? readFileSync(OVERRIDE_FILE, "utf-8")
      : undefined

  const logger = pino({ enabled: !DISABLE_REQUEST_LOGS })

  const app = new Koa()

  // Trust proxy headers (X-Forwarded-For, etc.) so ctx.ip reflects the real
  // client IP when running behind a load balancer or reverse proxy.
  app.proxy = true

  // CORS — set headers on every response when CORS_ALLOW_ORIGIN is configured.
  // Implemented inline because it's just setting 2-4 response headers.
  if (CORS_ORIGIN) {
    app.use(async (ctx, next) => {
      ctx.set("Access-Control-Allow-Origin", CORS_ORIGIN)
      if (CORS_METHODS) ctx.set("Access-Control-Allow-Methods", CORS_METHODS)
      if (CORS_HEADERS) ctx.set("Access-Control-Allow-Headers", CORS_HEADERS)
      if (CORS_CREDENTIALS)
        ctx.set("Access-Control-Allow-Credentials", CORS_CREDENTIALS)
      // Preflight requests get an immediate 204 with no body.
      if (ctx.method === "OPTIONS") {
        ctx.status = 204
        return
      }
      await next()
    })
  }

  // HTTP access log — records method, URL, status, and response time.
  // Separate from the echo payload log in echo.ts.
  if (!DISABLE_REQUEST_LOGS) {
    app.use(async (ctx, next) => {
      const start = Date.now()
      await next()
      const ms = Date.now() - start
      if (!LOG_IGNORE_PATH || !LOG_IGNORE_PATH.test(ctx.path)) {
        logger.info(`${ctx.method} ${ctx.url} ${ctx.status} - ${ms}ms`)
      }
    })
  }

  // Prometheus metrics — only loaded when explicitly enabled to avoid
  // overhead and cardinality costs when not needed.
  if (PROMETHEUS_ENABLED) {
    app.use(async (ctx, next) => {
      if (ctx.path === PROMETHEUS_PATH && ctx.method === "GET") {
        return metricsEndpoint(ctx, next)
      }
      return metricsMiddleware(ctx, next)
    })
  }

  // Echo handler — the main middleware, always last in the stack.
  app.use(
    echoHandler({
      echoBackToClient: ECHO_BACK_TO_CLIENT,
      overrideResponseBody: overrideBody,
      preserveHeaderCase: PRESERVE_HEADER_CASE,
      includeEnvVars: INCLUDE_ENV_VARS,
      jwtHeader: JWT_HEADER,
      logIgnorePath: LOG_IGNORE_PATH,
      logWithoutNewline: LOG_WITHOUT_NEWLINE,
      logger,
    }),
  )

  return { app, logger }
}
