/**
 * Entry point — reads server configuration from env vars, starts HTTP and
 * HTTPS listeners, and handles graceful shutdown.
 *
 * App creation and middleware assembly live in app.ts so they can be
 * imported directly in tests without starting network listeners.
 *
 * HTTPS is enabled automatically when certificate files exist on disk.
 * In the Docker image these are generated at build time; locally you can
 * provide your own via HTTPS_KEY_FILE / HTTPS_CERT_FILE env vars.
 */

import { existsSync, readFileSync } from "node:fs"
import { createServer as createHttpServer } from "node:http"
import { createServer as createHttpsServer } from "node:https"
import { createApp } from "./app.js"

const { app, logger } = createApp()

// --- Server config ---
// All env vars are read once at startup. Defaults match the reference project
// (mendhak/docker-http-https-echo) where applicable.

const HTTP_PORT = parseInt(
  process.env.HTTP_PORT || process.env.PORT || "8080",
  10,
)
const HTTPS_PORT = parseInt(process.env.HTTPS_PORT || "8443", 10)
const MAX_HEADER_SIZE = process.env.MAX_HEADER_SIZE
  ? parseInt(process.env.MAX_HEADER_SIZE, 10)
  : undefined

// TLS certificate paths default to the filenames generated in the Dockerfile.
const HTTPS_KEY_FILE = process.env.HTTPS_KEY_FILE || "testpk.pem"
const HTTPS_CERT_FILE = process.env.HTTPS_CERT_FILE || "fullchain.pem"
const ENABLE_HTTPS = existsSync(HTTPS_KEY_FILE) && existsSync(HTTPS_CERT_FILE)

// When true, the HTTPS server requests (but does not require) a client cert.
// The cert details are then included in the echo response.
const MTLS_ENABLE = process.env.MTLS_ENABLE === "true"

// --- Servers ---

const httpOpts = MAX_HEADER_SIZE ? { maxHeaderSize: MAX_HEADER_SIZE } : {}
const httpServer = createHttpServer(httpOpts, app.callback())
httpServer.listen(HTTP_PORT, () => {
  logger.info(`HTTP listening on :${HTTP_PORT}`)
})

let httpsServer: ReturnType<typeof createHttpsServer> | undefined
if (ENABLE_HTTPS) {
  const httpsOpts = {
    key: readFileSync(HTTPS_KEY_FILE),
    cert: readFileSync(HTTPS_CERT_FILE),
    // requestCert: true makes the server ask for a client cert.
    // rejectUnauthorized: false allows connections without one — the cert
    // is still available via getPeerCertificate() for the echo response.
    ...(MTLS_ENABLE && { requestCert: true, rejectUnauthorized: false }),
    ...(MAX_HEADER_SIZE && { maxHeaderSize: MAX_HEADER_SIZE }),
  }
  httpsServer = createHttpsServer(httpsOpts, app.callback())
  httpsServer.listen(HTTPS_PORT, () => {
    logger.info(`HTTPS listening on :${HTTPS_PORT}`)
  })
}

// --- Graceful shutdown ---
// Close HTTP first, then HTTPS, then exit. This gives in-flight requests
// a chance to complete.

function shutdown() {
  logger.info("Shutting down...")
  httpServer.close(() => {
    if (httpsServer) {
      httpsServer.close(() => process.exit(0))
    } else {
      process.exit(0)
    }
  })
}

process.on("SIGINT", shutdown)
process.on("SIGTERM", shutdown)
