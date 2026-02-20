/**
 * Core echo handler — reads the incoming request and reflects it back as JSON.
 *
 * We read the request body manually (rather than using a body-parsing library
 * like @koa/bodyparser) because the echo server needs the raw body string as-is
 * for the response, plus optional gzip decompression. A body-parsing library
 * would parse the body into structured data and lose the original string, or
 * require extra configuration for raw access. Reading the stream directly is
 * ~15 lines and gives us exactly what we need with no additional dependency.
 */

import { hostname } from "node:os"
import type { TLSSocket } from "node:tls"
import { createGunzip } from "node:zlib"
import { decode } from "jsonwebtoken"
import type { Context, Middleware } from "koa"
import type { Logger } from "pino"

// Default 1MB — matches common reverse proxy defaults (nginx, Cloudflare).
// Set MAX_BODY_SIZE to "0" to disable the limit entirely.
const MAX_BODY_SIZE = parseInt(process.env.MAX_BODY_SIZE || "1048576", 10)

export interface EchoConfig {
  echoBackToClient: boolean
  overrideResponseBody?: string
  preserveHeaderCase: boolean
  includeEnvVars: boolean
  jwtHeader?: string
  logIgnorePath: RegExp | null
  logWithoutNewline: boolean
  logger: Logger
}

/**
 * Reads the raw request body as a UTF-8 string, decompressing gzip
 * on the fly if the Content-Encoding header indicates it.
 * Enforces MAX_BODY_SIZE to prevent memory exhaustion from oversized payloads.
 */
async function readBody(ctx: Context): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    let exceeded = false
    const stream =
      ctx.get("content-encoding") === "gzip"
        ? ctx.req.pipe(createGunzip())
        : ctx.req

    stream.on("data", (chunk: Buffer) => {
      size += chunk.length
      if (!exceeded && MAX_BODY_SIZE > 0 && size > MAX_BODY_SIZE) {
        exceeded = true
        // Keep consuming the stream so the connection isn't reset,
        // but stop accumulating data. We reject once the stream ends.
      }
      if (!exceeded) {
        chunks.push(chunk)
      }
    })
    stream.on("end", () => {
      if (exceeded) {
        reject(new Error(`Body exceeds max size of ${MAX_BODY_SIZE} bytes`))
      } else {
        resolve(Buffer.concat(chunks).toString("utf8"))
      }
    })
    stream.on("error", reject)
  })
}

/**
 * Parses the Cookie header into key-value pairs.
 * Cookies are simple "key=value" pairs separated by "; " — no library needed.
 */
function parseCookies(header?: string): Record<string, string> {
  if (!header) return {}
  const cookies: Record<string, string> = {}
  for (const pair of header.split(";")) {
    const idx = pair.indexOf("=")
    if (idx > 0) {
      cookies[pair.slice(0, idx).trim()] = pair.slice(idx + 1).trim()
    }
  }
  return cookies
}

/**
 * Reconstructs headers from rawHeaders preserving original casing.
 * Node.js lowercases all header names in the parsed `headers` object,
 * but `rawHeaders` keeps the original casing as an alternating
 * [key, value, key, value, ...] array.
 */
function rebuildHeaders(rawHeaders: string[]): Record<string, string> {
  const headers: Record<string, string> = {}
  for (let i = 0; i < rawHeaders.length; i += 2) {
    headers[rawHeaders[i]] = rawHeaders[i + 1]
  }
  return headers
}

/**
 * Factory that returns a Koa middleware for echoing requests.
 * Config is captured once at startup so environment lookups don't repeat
 * on every request.
 */
export function echoHandler(config: EchoConfig): Middleware {
  // Cache os.hostname() — it won't change at runtime.
  const osHostname = hostname()

  return async (ctx) => {
    // If an override file was configured, return its contents for every request.
    // Useful for serving a static response (health check body, etc.).
    if (config.overrideResponseBody) {
      ctx.body = config.overrideResponseBody
      return
    }

    let body: string
    try {
      body = await readBody(ctx)
    } catch (err) {
      ctx.status = 413
      ctx.body = { error: (err as Error).message }
      return
    }

    // Build the echo response object with all available request metadata.
    const echo: Record<string, unknown> = {
      path: ctx.path,
      headers: config.preserveHeaderCase
        ? rebuildHeaders(ctx.req.rawHeaders)
        : ctx.headers,
      method: ctx.method,
      body,
      cookies: parseCookies(ctx.get("cookie")),
      fresh: ctx.fresh,
      hostname: ctx.hostname,
      ip: ctx.ip,
      ips: ctx.ips,
      protocol: ctx.protocol,
      query: ctx.query,
      subdomains: ctx.subdomains,
      // Koa has no built-in XHR check like Express — we check the header directly.
      xhr:
        (ctx.get("x-requested-with") || "").toLowerCase() === "xmlhttprequest",
      os: { hostname: osHostname },
      connection: {
        // TLS Server Name Indication — only present on HTTPS connections.
        servername: (ctx.req.socket as TLSSocket).servername || "",
      },
    }

    // mTLS: include the client certificate if the connection is TLS and
    // a cert was presented. getPeerCertificate() only exists on TLSSocket,
    // so we guard with a typeof check for plain HTTP connections.
    const socket = ctx.req.socket as TLSSocket
    if (typeof socket.getPeerCertificate === "function") {
      const cert = socket.getPeerCertificate()
      if (cert && Object.keys(cert).length > 0) {
        echo.clientCertificate = cert
      }
    }

    if (config.includeEnvVars) {
      echo.env = process.env
    }

    // If the body claims to be JSON, parse and include it as a separate field.
    // The raw string is always in `body`; the parsed object goes in `json`.
    if (ctx.is("application/json")) {
      try {
        echo.json = JSON.parse(body)
      } catch {
        config.logger.warn(
          "Invalid JSON body with Content-Type: application/json",
        )
      }
    }

    // JWT: decode (not verify) the token from the configured header.
    // We use jsonwebtoken's decode() which only parses the JWT structure
    // without checking the signature — appropriate for an echo/debug server.
    if (config.jwtHeader) {
      let token = ctx.get(config.jwtHeader)
      if (!token) {
        echo.jwt = null
      } else {
        // Strip "Bearer " or similar prefix if present.
        const parts = token.split(" ")
        token = parts[parts.length - 1]
        echo.jwt = decode(token, { complete: true })
      }
    }

    // --- Response overrides (controlled via request headers or query params) ---

    // Custom HTTP status code
    const statusOverride =
      ctx.get("x-set-response-status-code") ||
      (ctx.query["x-set-response-status-code"] as string)
    if (statusOverride) {
      const code = parseInt(statusOverride, 10)
      if (code >= 100 && code < 600) ctx.status = code
    }

    // Artificial delay — useful for testing timeouts and loading states.
    // Implemented as a simple setTimeout promise; no dependency needed.
    const delayMs = parseInt(
      ctx.get("x-set-response-delay-ms") ||
        (ctx.query["x-set-response-delay-ms"] as string) ||
        "0",
      10,
    )
    if (delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs))
    }

    // Custom content type for the response.
    // Captured here but applied after setting ctx.body, because Koa
    // auto-detects content type when body is set (object → application/json).
    // Setting ctx.type before ctx.body would be overridden.
    const contentTypeOverride =
      ctx.get("x-set-response-content-type") ||
      (ctx.query["x-set-response-content-type"] as string)

    // --- Send response ---

    if (!config.echoBackToClient) {
      // ECHO_BACK_TO_CLIENT=false: return an empty response body.
      ctx.body = null
    } else if (ctx.query.response_body_only === "true") {
      // Return just the raw request body, not the full echo object.
      ctx.body = body
    } else {
      // Normal mode: return the full echo object as JSON.
      // Koa automatically serializes objects and sets Content-Type: application/json.
      ctx.body = echo
    }

    // Apply content type override after body is set so it isn't clobbered.
    if (contentTypeOverride) {
      ctx.type = contentTypeOverride
    }

    // Log the incoming request as a structured pino object (separate from the
    // HTTP access log in app.ts).
    if (!config.logIgnorePath || !config.logIgnorePath.test(ctx.path)) {
      config.logger.info({ req: echo }, "request")
    }
  }
}
