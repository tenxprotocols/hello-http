/**
 * End-to-end tests for the echo server.
 *
 * Each test creates a fresh Koa app via createApp(), starts an HTTP server
 * on an ephemeral port, makes real HTTP requests, and asserts on the response.
 * The server is torn down after each test to avoid port conflicts.
 */

import { createServer, type Server } from "node:http"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

// Set DISABLE_REQUEST_LOGS before importing the app to keep test output clean.
process.env.DISABLE_REQUEST_LOGS = "true"

// Dynamic import so env vars are set first.
const { createApp } = await import("../src/app.js")

let server: Server
let baseUrl: string

beforeEach(async () => {
  const { app } = createApp()
  server = createServer(app.callback())
  await new Promise<void>((resolve) => {
    // Port 0 lets the OS assign an available port.
    server.listen(0, () => resolve())
  })
  const addr = server.address()
  const port = typeof addr === "object" && addr ? addr.port : 0
  baseUrl = `http://localhost:${port}`
})

afterEach(async () => {
  await new Promise<void>((resolve) => {
    server.close(() => resolve())
  })
})

describe("echo response fields", () => {
  it("echoes path, method, query, and standard fields", async () => {
    const res = await fetch(`${baseUrl}/hello?foo=bar`)
    expect(res.status).toBe(200)
    expect(res.headers.get("content-type")).toMatch(/application\/json/)

    const body = await res.json()
    expect(body.path).toBe("/hello")
    expect(body.method).toBe("GET")
    expect(body.query).toEqual({ foo: "bar" })
    expect(body.hostname).toBe("localhost")
    expect(body.protocol).toBe("http")
    expect(body.ip).toBeDefined()
    expect(body.os.hostname).toBeDefined()
    expect(body.headers).toBeDefined()
    expect(body.cookies).toEqual({})
    expect(body.xhr).toBe(false)
    expect(body.fresh).toBe(false)
    expect(body.ips).toEqual([])
    expect(body.subdomains).toEqual([])
    expect(body.connection).toBeDefined()
  })

  it("echoes POST body as raw string", async () => {
    const res = await fetch(`${baseUrl}/echo`, {
      method: "POST",
      body: "hello world",
    })
    const json = await res.json()
    expect(json.body).toBe("hello world")
    expect(json.method).toBe("POST")
  })

  it("parses JSON body into a separate json field", async () => {
    const res = await fetch(`${baseUrl}/echo`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ msg: "hi" }),
    })
    const json = await res.json()
    expect(json.body).toBe('{"msg":"hi"}')
    expect(json.json).toEqual({ msg: "hi" })
  })

  it("echoes cookies from the Cookie header", async () => {
    const res = await fetch(`${baseUrl}/`, {
      headers: { Cookie: "session=abc123; theme=dark" },
    })
    const json = await res.json()
    expect(json.cookies).toEqual({ session: "abc123", theme: "dark" })
  })

  it("detects XHR requests", async () => {
    const res = await fetch(`${baseUrl}/`, {
      headers: { "X-Requested-With": "XMLHttpRequest" },
    })
    const json = await res.json()
    expect(json.xhr).toBe(true)
  })
})

describe("response overrides", () => {
  it("sets custom status code via header", async () => {
    const res = await fetch(`${baseUrl}/`, {
      headers: { "x-set-response-status-code": "418" },
    })
    expect(res.status).toBe(418)
  })

  it("sets custom status code via query param", async () => {
    const res = await fetch(`${baseUrl}/?x-set-response-status-code=201`)
    expect(res.status).toBe(201)
  })

  it("sets custom content type via header", async () => {
    const res = await fetch(`${baseUrl}/`, {
      headers: { "x-set-response-content-type": "text/plain" },
    })
    expect(res.headers.get("content-type")).toMatch(/text\/plain/)
  })

  it("delays response by specified milliseconds", async () => {
    const start = Date.now()
    await fetch(`${baseUrl}/`, {
      headers: { "x-set-response-delay-ms": "200" },
    })
    const elapsed = Date.now() - start
    expect(elapsed).toBeGreaterThanOrEqual(180)
  })

  it("returns only the request body with response_body_only=true", async () => {
    const res = await fetch(`${baseUrl}/?response_body_only=true`, {
      method: "POST",
      body: "raw body here",
    })
    const text = await res.text()
    expect(text).toBe("raw body here")
  })
})

describe("body size limit", () => {
  it("rejects bodies exceeding MAX_BODY_SIZE with 413", async () => {
    // Default MAX_BODY_SIZE is 1MB. Send 2MB to trigger the limit.
    const largeBody = "x".repeat(2 * 1024 * 1024)
    const res = await fetch(`${baseUrl}/`, {
      method: "POST",
      body: largeBody,
    })
    expect(res.status).toBe(413)
    const json = await res.json()
    expect(json.error).toMatch(/max size/)
  })
})

describe("all HTTP methods", () => {
  for (const method of ["GET", "POST", "PUT", "PATCH", "DELETE"]) {
    it(`echoes ${method} requests`, async () => {
      const res = await fetch(`${baseUrl}/test`, { method })
      const json = await res.json()
      expect(json.method).toBe(method)
      expect(json.path).toBe("/test")
    })
  }
})
