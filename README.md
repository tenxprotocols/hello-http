# hello-http

HTTP echo server that reflects request data as JSON. Useful for running health checks or debugging proxies, load balancers, and HTTP clients.

## Quick start

### Docker

```bash
docker run -p 8080:8080 -p 8443:8443 ghcr.io/tenxprotocols/hello-http
```

### Local

```bash
pnpm install
pnpm build
pnpm start
```

## Usage

Every request to any path with any method returns a JSON response echoing the request details:

```bash
curl http://localhost:8080/hello?foo=bar
```

```json
{
  "path": "/hello",
  "headers": { "host": "localhost:8080", "user-agent": "curl/8.7.1", "accept": "*/*" },
  "method": "GET",
  "body": "",
  "cookies": {},
  "fresh": false,
  "hostname": "localhost",
  "ip": "::1",
  "ips": [],
  "protocol": "http",
  "query": { "foo": "bar" },
  "subdomains": [],
  "xhr": false,
  "os": { "hostname": "my-machine" },
  "connection": { "servername": "" }
}
```

### POST with JSON body

```bash
curl -X POST http://localhost:8080/echo \
  -H "Content-Type: application/json" \
  -d '{"message": "hello"}'
```

The response includes both the raw `body` string and a parsed `json` field.

### Custom response status code

```bash
# Via header
curl -H "x-set-response-status-code: 418" http://localhost:8080/

# Via query param
curl "http://localhost:8080/?x-set-response-status-code=201"
```

### Response delay

Useful for testing timeouts and loading states:

```bash
curl -H "x-set-response-delay-ms: 2000" http://localhost:8080/slow
```

### Custom response content type

```bash
curl -H "x-set-response-content-type: text/plain" http://localhost:8080/
```

### Return only the request body

```bash
curl -X POST "http://localhost:8080/?response_body_only=true" -d "raw data"
# Returns: raw data
```

### HTTPS

The Docker image includes a self-signed certificate. HTTPS is enabled automatically when cert files exist:

```bash
curl -k https://localhost:8443/secure
```

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `HTTP_PORT` / `PORT` | `8080` | HTTP listen port |
| `HTTPS_PORT` | `8443` | HTTPS listen port |
| `HTTPS_KEY_FILE` | `testpk.pem` | Path to TLS private key |
| `HTTPS_CERT_FILE` | `fullchain.pem` | Path to TLS certificate |
| `MTLS_ENABLE` | `false` | Request (but don't require) client certificates |
| `MAX_BODY_SIZE` | `1048576` | Max request body size in bytes (0 to disable) |
| `MAX_HEADER_SIZE` | (node default) | Max HTTP header size in bytes |
| `ECHO_BACK_TO_CLIENT` | `true` | Set to `false` to return empty responses |
| `OVERRIDE_RESPONSE_BODY_FILE_PATH` | | Serve this file's contents instead of the echo response |
| `PRESERVE_HEADER_CASE` | `false` | Preserve original header name casing |
| `ECHO_INCLUDE_ENV_VARS` | `false` | Include server environment variables in the response |
| `JWT_HEADER` | | Header name to decode as JWT (e.g. `authorization`) |
| `CORS_ALLOW_ORIGIN` | | Set `Access-Control-Allow-Origin` header |
| `CORS_ALLOW_METHODS` | | Set `Access-Control-Allow-Methods` header |
| `CORS_ALLOW_HEADERS` | | Set `Access-Control-Allow-Headers` header |
| `CORS_ALLOW_CREDENTIALS` | | Set `Access-Control-Allow-Credentials` header |
| `PROMETHEUS_ENABLED` | `false` | Enable Prometheus metrics at `/metrics` |
| `PROMETHEUS_METRICS_PATH` | `/metrics` | Path for the metrics endpoint |
| `PROMETHEUS_WITH_PATH` | `false` | Include path label in metrics |
| `PROMETHEUS_WITH_METHOD` | `true` | Include method label in metrics |
| `PROMETHEUS_WITH_STATUS` | `true` | Include status label in metrics |
| `DISABLE_REQUEST_LOGS` | `false` | Disable request logging |
| `LOG_IGNORE_PATH` | | Regex pattern to exclude paths from logs |
| `LOG_WITHOUT_NEWLINE` | `false` | Compact log output |

## JWT decoding

Set `JWT_HEADER` to the header name containing a JWT token. The token is decoded (not verified) and included in the response:

```bash
docker run -e JWT_HEADER=authorization -p 8080:8080 ghcr.io/tenxprotocols/hello-http

curl -H "Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.Rq8IjqbaVxoHaXqO4bp4AE4SWIS1xBbKKx1QcZ5m4RM" \
  http://localhost:8080/
```

The response will include a `jwt` field with the decoded header and payload.

## Development

```bash
# Install dependencies
pnpm install

# Build
pnpm build

# Run
pnpm start

# Run tests
pnpm test

# Lint and format
pnpm check        # check only
pnpm format       # auto-fix
```

## Tech stack

- **Runtime:** Node.js 22, Koa 3
- **Language:** TypeScript (ESM)
- **Dependencies:** koa, jsonwebtoken, prom-client, pino
- **Tooling:** pnpm, mise, Biome, vitest
- **CI/CD:** release-please + Docker build to GHCR
