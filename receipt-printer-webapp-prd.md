# PRD  
## Receipt Printer Control Web App  
**Anchor:** Webapp + Docker + Network printer  
**Printer:** Epson TM-T88IV  
**Modes:** USB and Ethernet  

---

## 1) Background  
Ad-hoc printing is brittle.  
Debugging is slow without job logs.  
A small web UI fixes both.  
Docker makes deployment repeatable.  

---

## 2) Problem Statement  
Users need immediate receipt prints from a browser.  
Users need visibility into printer connectivity.  
Users need a clean audit trail of print activity.  
Users need one app that works for USB and Ethernet.  

---

## 3) Goals  
Provide a web UI that prints plain text immediately.  
Provide an API for printing and monitoring.  
Record print jobs with outcomes and errors.  
Support Epson TM-T88IV via ESC/POS.  
Ship as Docker-first with best-practice defaults.  

---

## 4) Non-Goals  
No POS features.  
No payments.  
No multi-user accounts in v1.  
No templates, images, QR, or barcodes in v1.  
No cloud requirement for core functions.  

---

## 5) Target Users  
Homelab operator.  
Small shop tech.  
Lab developer testing device workflows.  

---

## 6) User Stories  
User enters text and presses **Print**.  
User sees **Success** or **Failure** immediately.  
User sees **Connected** or **Disconnected** status.  
User views a list of recent jobs.  
User opens a job and sees error details.  
User selects USB or Ethernet by configuration.  
User runs the app with `docker compose up`.  

---

## 7) Functional Requirements  

### 7.1 Printing  
UI has one main text area.  
UI has a Print button.  
Server accepts text and enqueues a job.  
Server serializes all writes per printer.  
Server prints with line feeds and optional cut.  
Server enforces max characters.  
Server sanitizes input for ESC/POS safety.  
Server returns a job id on submit.  

### 7.2 Printer Configuration  
Config selects printer mode: `usb` or `ethernet`.  
USB config supports VID and PID.  
USB config supports optional device path override.  
Ethernet config supports IP or hostname.  
Ethernet config supports port.  
Default Ethernet port is `9100`.  
Config is only env vars and optional mounted config file.  

### 7.3 Monitoring and Activity  
Every print request creates a job record.  
Job includes timestamp, mode, byte size, and result.  
Job includes a truncated text preview.  
Job includes a text hash for correlation.  
Job includes full error stack trace on failure.  
UI displays recent jobs newest first.  
API exposes status and job listing.  

### 7.4 API Endpoints  
`POST /api/print`  
`GET /api/status`  
`GET /api/jobs`  
`GET /healthz`  
`GET /readyz`  

---

## 8) Non-Functional Requirements  

### 8.1 Reliability  
One queue worker per printer.  
No concurrent device or socket writes.  
Network printing uses timeouts.  
Startup fails on invalid config.  
Transient network errors use limited retry with jitter.  

### 8.2 Security  
Bind to `127.0.0.1` by default.  
Require API key if binding to non-localhost.  
Use `X-API-Key` header.  
Use constant-time compare for key checks.  
Rate limit by IP.  
Reject oversized bodies.  
Redact secrets in logs.  

### 8.3 Observability  
Structured JSON logs.  
Log job lifecycle events.  
Include job id in all job logs.  
Expose readiness and liveness endpoints.  

### 8.4 Performance  
Submit returns fast with job id.  
Queue handles printing asynchronously.  
UI stays responsive under small bursts.  

---

## 9) UX Requirements  

### 9.1 Main Page  
Single large text area.  
Character counter.  
Print button.  
Printer status badge.  
Last job result banner.  

### 9.2 Activity Page  
Jobs table with pagination.  
Columns: Time, Mode, Bytes, Result, Error summary.  
Row click opens job detail.  

### 9.3 Job Detail Page  
Timestamp.  
Mode.  
Bytes.  
Preview.  
Full error stack trace on failure.  

---

## 10) Technical Requirements  

### 10.1 Stack  
Use a stable stack.  
Prefer TypeScript.  
Prefer Node.js LTS.  
Prefer Fastify or Express for API.  
Prefer server-rendered HTML for simplicity.  
Allow optional React if it stays minimal.  

### 10.2 ESC/POS Output  
Use a proven ESC/POS library when possible.  
Fallback to raw ESC/POS bytes when needed.  
End every print with configured feed lines.  
Send configured cut command when enabled.  
Cut modes: none, partial, full.  

### 10.3 USB Printing in Docker  
Support device passthrough.  
Support mapping `/dev/usb/lp0` when present.  
Support mapping `/dev/bus/usb` when required by library.  
Avoid privileged mode by default.  
Document privileged mode only as last resort.  

### 10.4 Ethernet Printing in Docker  
Use RAW TCP socket to printer.  
Default to port `9100`.  
Use connect and write timeouts.  
Support limited retries.  

### 10.5 Data Storage  
Use SQLite for job storage.  
Store DB file in a mounted volume.  
Use schema migrations.  

### 10.6 Queue Model  
Persist job as `queued`.  
Process job in FIFO order.  
Update job to `succeeded` or `failed`.  
Store error stack trace on failure.  

### 10.7 Configuration Validation  
Validate all env vars at startup.  
Fail fast with clear error messages.  
Log active config with redaction.  

---

## 11) Docker Requirements  

### 11.1 Dockerfile  
Use multi-stage build.  
Run as non-root user.  
Use minimal runtime image.  
Expose port 3000 by default.  
Include container healthcheck.  

### 11.2 Docker Compose  
Provide `docker-compose.yml`.  
Provide profiles: `usb` and `ethernet`.  
Provide volume for SQLite.  
Provide `.env.example`.  
Provide documented device mappings for USB.  

---

## 12) Configuration  

### 12.1 Environment Variables  
| Name | Required | Example | Notes |
|---|---:|---|---|
| `PRINTER_MODE` | Yes | `ethernet` | `usb` or `ethernet` |
| `APP_HOST` | Yes | `127.0.0.1` | Require API key if `0.0.0.0` |
| `APP_PORT` | Yes | `3000` | HTTP port |
| `API_KEY` | Conditional | `changeme` | Required when exposed |
| `RATE_LIMIT_PER_MINUTE` | No | `60` | Per IP |
| `MAX_CHARS` | No | `1000` | Input limit |
| `FEED_LINES` | No | `3` | Line feeds after text |
| `CUT_MODE` | No | `partial` | `none` `partial` `full` |
| `CONNECT_TIMEOUT_MS` | No | `2000` | Ethernet |
| `WRITE_TIMEOUT_MS` | No | `2000` | Ethernet |

### 12.2 USB Mode Variables  
| Name | Required | Example | Notes |
|---|---:|---|---|
| `USB_VENDOR_ID` | Yes | `0x04B8` | Epson VID often |
| `USB_PRODUCT_ID` | Yes | `0x0E15` | Varies by device |
| `USB_DEVICE_PATH` | No | `/dev/usb/lp0` | Optional override |

### 12.3 Ethernet Mode Variables  
| Name | Required | Example | Notes |
|---|---:|---|---|
| `PRINTER_HOST` | Yes | `192.168.1.50` | IP or DNS |
| `PRINTER_PORT` | No | `9100` | RAW printing |

---

## 13) API Specification  

### 13.1 POST `/api/print`  
**Request JSON**  
- `text: string`  

**Response JSON**  
- `jobId: string`  
- `status: "queued"`  

**Errors**  
- `400` invalid input  
- `401` missing or bad API key  
- `429` rate limit  
- `500` server error  

### 13.2 GET `/api/status`  
**Response JSON**  
- `mode: "usb" | "ethernet"`  
- `connected: boolean`  
- `details: object`  

### 13.3 GET `/api/jobs`  
**Query**  
- `page: number`  
- `pageSize: number`  

**Response JSON**  
- `items: Job[]`  
- `page: number`  
- `pageSize: number`  
- `total: number`  

### 13.4 GET `/healthz`  
Returns `200 ok` when process is alive.  

### 13.5 GET `/readyz`  
Returns `200 ready` when config is valid.  
Returns `503 not ready` when printer is not reachable in selected mode.  

---

## 14) Printer Notes  
Epson TM-T88IV is ESC/POS compatible.  
Ethernet printing uses RAW TCP in typical setups.  
USB printing requires host device access.  
App must not rely on desktop drivers.  

---

## 15) Testing Requirements  

### 15.1 Unit Tests  
Config validation.  
Input validation and truncation.  
ESC/POS byte generation.  
Queue serialization.  
API key auth logic.  

### 15.2 Integration Tests  
Mock TCP server for Ethernet.  
SQLite job persistence.  
End-to-end print route with mocked transport.  

### 15.3 Manual Test Checklist  
Ethernet print to TM-T88IV on LAN.  
USB print via docker device mapping.  
Jobs list updates.  
Failures show stack trace.  
Auth blocks remote usage without key.  

---

## 16) Acceptance Criteria  
Docker compose starts cleanly.  
UI loads and prints plain text.  
USB mode works with documented mappings.  
Ethernet mode works with IP and port.  
Job log shows each print attempt.  
Status endpoint reports connectivity.  
Security defaults prevent accidental exposure.  

---

## 17) Deliverables  
App source code.  
Dockerfile.  
docker-compose.yml with profiles.  
README with setup for USB and Ethernet.  
.env.example.  
Test suite.  
