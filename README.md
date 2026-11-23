# SE4458 Midterm 1 – Group 2: AI Billing Support Assistant

Conversational assistant for mobile subscribers. An LLM-powered **AI Agent** decides whether to
search the billing guide through an **MCP Server**, call the **Billing REST API** through an
**API Gateway**, or both.

```
User ─► AI Agent ◄──► LLM (Google Gemini, tool calling)
          │
          ├─► MCP Client ─► MCP Server ─► indexed Mobile_Provider_Billing_Guide.md
          │
          └─► API Gateway (/api/v1/...) ─► Billing REST API ─► PostgreSQL
```

**Live system (Azure):** gateway `https://se4458-billing-gw-enes.azure-api.net/api/v1` ·
[Swagger UI](https://se4458-billing-api-enes-c6czbfepexbrfxe9.swedencentral-01.azurewebsites.net/swagger) ·
[demo video](https://drive.google.com/file/d/1qFDvALOocIUdVyUTjiBqruat5RsREf8Y/view?usp=sharing) · evidence: [section 6](#6-demo-video-and-evidence) ·
submission checklist: [section 7](#7-submission-checklist)

## Repository layout

| Folder | Content | Status |
|---|---|---|
| `billing-api/` | Node.js/Express REST API, JWT auth, Swagger, Jest tests | ✅ done |
| `mcp-server/` | MCP SDK server exposing `search_billing_documentation(query)`, Jest tests | ✅ done |
| `agent/` | AI Agent: Gemini tool calling + MCP client + REST client, terminal chat, Jest tests | ✅ done |
| `gateway/` | Azure API Management: imported API definition + policies | ✅ done |
| `docs/` | ER diagram, screenshots, tool traces, MCP retrieval results | ✅ done |

## 1. Billing REST API

### Endpoints (all versioned under `/api/v1`)

| Operation | Method & route | Auth | Paging |
|---|---|---|---|
| Login | `POST /api/v1/auth/login` | – | – |
| Add Usage | `POST /api/v1/usage` | ✅ ADMIN | – |
| Calculate Bill | `POST /api/v1/bills/calculate` | ✅ ADMIN | – |
| Query Bill | `GET /api/v1/bills?subscriberNo&year&month` | ❌ | – |
| Query Bill Detailed | `GET /api/v1/bills/detailed?subscriberNo&year&month&page&pageSize` | ✅ owner/ADMIN | ✅ |
| Pay Bill | `POST /api/v1/payments` | ✅ owner/ADMIN | – |

Swagger UI: `/swagger` · OpenAPI JSON: `/openapi.json` · source: [`billing-api/src/openapi.yaml`](billing-api/src/openapi.yaml)

### Pricing rules (from the billing guide, sections 2–4)

- Phone: first 1,000 minutes free, then **$10 per started 1,000-minute block**.
- Internet: **$50** up to 20 GB (also for zero usage), then **$10 per started 10 GB block**. 1 GB = 1,000 MB.
- Example: 1,350 min + 35 GB → $10 + $70 = **$80**.

### Error format

```json
{ "error": { "code": "AMOUNT_EXCEEDS_BALANCE", "message": "Payment amount 90 exceeds remaining balance 80", "details": { "remainingBalance": 80 } } }
```

| HTTP | code | When |
|---|---|---|
| 400 | `VALIDATION_ERROR`, `INVALID_JSON` | bad/missing parameters |
| 401 | `UNAUTHORIZED`, `INVALID_TOKEN`, `TOKEN_EXPIRED`, `INVALID_CREDENTIALS` | no/invalid JWT, wrong login |
| 403 | `FORBIDDEN` | wrong role, or another subscriber's data |
| 404 | `SUBSCRIBER_NOT_FOUND`, `BILL_NOT_FOUND`, `ROUTE_NOT_FOUND` | |
| 409 | `DUPLICATE_TRANSACTION`, `BILL_ALREADY_PAID` | |
| 422 | `AMOUNT_EXCEEDS_BALANCE` | payment larger than remaining balance |

### Data model

See [`docs/ER-diagram.md`](docs/ER-diagram.md).

### Run locally

Requirements: Node.js 20+ and any PostgreSQL server (local or cloud). In the deployed system the
API uses Azure Database for PostgreSQL; for your own run use your own PostgreSQL.

```bash
cd billing-api
cp .env.example .env                 # Windows: copy .env.example .env
# edit .env -> DATABASE_URL = your PostgreSQL connection string
#              DB_SSL=true for Azure / cloud PostgreSQL, DB_SSL=false for a local server
#              JWT_SECRET = any long random string
npm install
npm run db:seed                      # creates tables + demo data
npm start                            # http://localhost:3000/swagger
```

See also [How to reproduce the results](#how-to-reproduce-the-results-for-the-instructor).

### Unit tests

```bash
cd billing-api
npm test
```

Tests use an in-memory repository, so they need **no database, no cloud and no LLM**.
Every operation has success and failure/edge-case tests (validation, 401/403, duplicate
transaction, overpayment, paging, re-calculation, pricing boundaries).
Result: **44 passed** – see [section 6](#unit-test-results) for all test suites.

### Test data (created by `npm run db:seed`)

| User | Password | Role | Subscriber |
|---|---|---|---|
| `ayse` | `Ayse123!` | SUBSCRIBER | 5551001 |
| `mehmet` | `Mehmet123!` | SUBSCRIBER | 5551002 |
| `zeynep` | `Zeynep123!` | SUBSCRIBER | 5551003 |
| `admin` | `Admin123!` | ADMIN | – |

| Subscriber | Period | Usage | Total | Paid | Status |
|---|---|---|---|---|---|
| 5551001 | 2026-09 | 800 min, 18 GB | $50 | $50 | PAID |
| 5551001 | 2026-10 | 1,350 min, 35 GB | $80 | $0 | UNPAID |
| 5551002 | 2026-10 | 2,500 min, 12 GB | $70 | $30 | PARTIALLY_PAID |
| 5551003 | 2026-10 | 500 min, 21 GB | $60 | $60 | PAID |

## 2. MCP Server – billing guide search

Folder: [`mcp-server/`](mcp-server). Built with the official **MCP TypeScript/JavaScript SDK**
(`@modelcontextprotocol/sdk`). The indexed document is
[`mcp-server/data/Mobile_Provider_Billing_Guide.md`](mcp-server/data/Mobile_Provider_Billing_Guide.md)
(policy text only – it is **not** the billing database).

### Tool schema

| | |
|---|---|
| Name | `search_billing_documentation` |
| Input | `query` (string, 2–300 chars, required), `maxResults` (integer 1–8, optional, default 3) |
| Output | `{ document, documentId, query, matches: [{ section, heading, parentSection, parentHeading, text, score }] }` |
| Annotations | `readOnlyHint: true` |

Example result (`structuredContent`; the same JSON is also returned as text content):

```json
{
  "document": "Mobile_Provider_Billing_Guide.md",
  "documentId": "MOB-BILLING-2026-01",
  "query": "How much does extra internet cost?",
  "matches": [
    { "section": "8.1", "heading": "What is the cost of extra internet?", "parentSection": "8",
      "parentHeading": "Frequently asked questions",
      "text": "Each additional 10 GB block beyond 20 GB costs $10. Partially used blocks are rounded up. See Section 3.2.",
      "score": 83.94 }
  ]
}
```

### Indexing approach

1. **Chunking** ([`src/chunker.js`](mcp-server/src/chunker.js)) – the Markdown is split at headings:
   one chunk per `###` subsection (e.g. *3.2 Additional internet blocks*); a `##` section with its
   own text (e.g. *1. Scope*, *9. Guidance*) and the document header (*0. Document overview*) are
   chunks too → **26 chunks**, each with section number, heading and parent section.
2. **Index** ([`src/searchIndex.js`](mcp-server/src/searchIndex.js)) – an in-memory **full-text
   inverted index with BM25+ ranking** (MiniSearch). Fields are boosted: heading ×3,
   parent heading ×1.5, text ×1. English stop words are removed, prefix matching for terms longer
   than 3 characters ("restrict" → "restriction"), small typo tolerance for long terms.
3. **Query expansion** – a small domain synonym list maps user words to the guide's vocabulary
   (e.g. *data → internet*, *fee → cost/charge*, *installment → partial*, *complaint → dispute*).
4. **Built once** – the index is created when the server starts and shared by all requests;
   it is never rebuilt per question (`/health` shows `indexedAt`).

Embeddings / vector search were not used (optional in the assignment): full-text search is
deterministic, free, needs no external API and gives correct sections for the guide.

### Transports

| Mode | Command | Use |
|---|---|---|
| stdio | `npm run start:stdio` | local: the agent starts the process and talks over stdin/stdout |
| Streamable HTTP | `npm start` → `POST http://localhost:3001/mcp` | cloud (Azure App Service). Stateless; optional `MCP_API_KEY` → `Authorization: Bearer <key>` |

The MCP path is separate from the API Gateway path: the agent calls the MCP server directly,
REST calls go through the gateway.

### Run, demo and test

```bash
cd mcp-server
npm install
npm test                 # chunker, index, 3 retrieval tests, MCP protocol (in-memory client), HTTP auth
npm run demo             # real MCP client -> stdio server -> runs the 3 retrieval queries
# against a deployed server:
# MCP_URL=https://<mcp-app>.azurewebsites.net/mcp MCP_API_KEY=<key> npm run demo
```

### Three retrieval tests

Run with a real MCP client against the **deployed** server (Streamable HTTP). Output of `npm run demo -- --save` is in
[`docs/mcp-retrieval-demo.md`](docs/mcp-retrieval-demo.md), screenshot: [`11-mcp-retrieval.png`](docs/screenshots/11-mcp-retrieval.png).

| # | Query | Top sections returned |
|---|---|---|
| 1 | How much does extra internet cost? | 8.1 What is the cost of extra internet? · 3.1 Included internet allowance · 3.2 Additional internet blocks |
| 2 | Can I pay only part of my bill? | 8.3 Can I pay only part of my bill? · 5.1 Full and partial payments · 5.3 Payment result |
| 3 | How do I dispute a charge? | 8.4 How can I dispute a charge? · 7.1 Dispute window · 7.2 Information required |

## 3. AI Agent

Folder: [`agent/`](agent). Terminal chat (`npm start`). LLM: **Google Gemini** (`gemini-3.1-flash-lite`,
free tier) through the official `@google/genai` SDK with **real function calling** – there is no
keyword routing; the model decides which tools to call.

### Execution workflow

```
user question
  → LLM (Gemini) receives the question + 4 tool declarations, selects tool(s)
  → Agent executes the calls:  MCP tool → MCP server            (direct, not via gateway)
                               REST tools → API Gateway → Billing API → PostgreSQL
  → tool results are sent back to the LLM (functionResponse)
  → repeat while the LLM asks for more tools (max 6 rounds)
  → grounded final answer, with guide section references (e.g. "§3.2")
```

The LLM never calls a backend itself; [`src/agent.js`](agent/src/agent.js) executes every call.

### Tools given to the LLM ([`src/tools.js`](agent/src/tools.js))

| Tool | Parameters | Executed as |
|---|---|---|
| `search_billing_documentation` | `query`, `maxResults?` | MCP `tools/call` on the MCP server |
| `query_bill` | `month`, `year` | `GET /api/v1/bills` via gateway |
| `query_bill_detailed` | `month`, `year`, `page?` | `GET /api/v1/bills/detailed` via gateway, with JWT |
| `pay_bill` | `month`, `year`, `amount` | user confirmation → `POST /api/v1/payments` via gateway, with JWT |

### Security rules (enforced in code, not only in the prompt)

- **Identity comes from login only.** The user logs in at start (`POST /api/v1/auth/login`); the
  subscriber number and JWT are stored in the session. **No tool has a `subscriberNo` parameter**;
  if the model still sends one it is dropped and logged as `ignoredArgs`. A number typed in the chat
  can therefore never reach another subscriber's data (and the API would also answer `403`).
- **Explicit payment confirmation.** `pay_bill` never pays directly: the agent shows subscriber,
  period and amount and waits for the user to type `yes`. Declined → `NOT_SUBMITTED` is returned
  to the LLM and nothing is sent to the API.
- **Idempotency.** The agent generates the `transactionId`; the API rejects duplicates (`409`).

### Tool trace

For every question the terminal prints the trace (LLM tool selection → each tool call with
channel, request and result summary → final answer). The full trace is also written to
`agent/logs/session-<time>.md` and `.json` (tool names, inputs, raw results, final answer).
The trace of the demo session (all scenarios) is in [`docs/agent-trace-demo.md`](docs/agent-trace-demo.md).

### Run

Requirements: Node.js **22+**, a Gemini API key, Billing API and MCP server available.

```bash
cd agent
npm install
copy .env.example .env       # set GEMINI_API_KEY, BILLING_API_URL (gateway URL), MCP_URL (or empty = local stdio)
npm start                    # log in e.g. ayse / Ayse123!
npm test                     # 19 tests with a scripted fake LLM – no network / API key needed
```

### LLM cost

Gemini API **free tier** (no billing account) – cost **$0**. The model is configurable with `GEMINI_MODEL`. A demo session uses a few thousand
tokens per question (system prompt + tool declarations + results). Free-tier limits are per project
per minute/day; the agent retries once on `429`/`503`. To test without any LLM cost, run `npm test`
(scripted fake LLM). Note: on the free tier Google may use prompts to improve its products – only
fictitious demo data is used here.

## 4. API Gateway – Azure API Management

All REST operations – including every call of the AI agent – go through **Azure API Management
(Consumption tier)**. The MCP server is called directly by the agent (separate path, as required).

| | |
|---|---|
| Gateway base URL | **`https://se4458-billing-gw-enes.azure-api.net`** |
| Public versioned routes | `https://se4458-billing-gw-enes.azure-api.net/api/v1/...` (API URL suffix `api`, versioning scheme **Path**, version `v1`) |
| Backend (Billing API on App Service) | `https://se4458-billing-api-enes-c6czbfepexbrfxe9.swedencentral-01.azurewebsites.net/api/v1` |
| Definition imported into APIM | [`gateway/billing-api-v1.openapi.yaml`](gateway/billing-api-v1.openapi.yaml) |
| Policies | [`gateway/policies/api-policy.xml`](gateway/policies/api-policy.xml) (all operations), [`gateway/policies/jwt-validation.xml`](gateway/policies/jwt-validation.xml) (protected operations) |

### Route mappings

| Public route (gateway) | Backend route | APIM operation | Gateway auth |
|---|---|---|---|
| `POST /api/v1/auth/login` | `POST /api/v1/auth/login` | `login` | public |
| `GET /api/v1/bills` | `GET /api/v1/bills` | `query-bill` | public |
| `GET /api/v1/bills/detailed` | `GET /api/v1/bills/detailed` | `query-bill-detailed` | **JWT validated** |
| `POST /api/v1/payments` | `POST /api/v1/payments` | `pay-bill` | **JWT validated** |
| `POST /api/v1/usage` | `POST /api/v1/usage` | `add-usage` | **JWT validated** |
| `POST /api/v1/bills/calculate` | `POST /api/v1/bills/calculate` | `calculate-bill` | **JWT validated** |

### Authentication at the gateway

The `validate-jwt` policy checks the `Authorization: Bearer <JWT>` header (HS256 signature, issuer
`se4458-billing-api`, expiry) **before** the request reaches the API. The signing key is stored in
APIM as a secret *named value* `jwt-signing-key` (Base64 of the API's `JWT_SECRET`), never in the repo.
The Billing API validates the token again and enforces role and subscriber ownership (defense in depth).
No subscription key is required (*Subscription required* is off), because Query Bill must stay public.

### Error response example (rejected by the gateway)

```bash
curl -i "https://se4458-billing-gw-enes.azure-api.net/api/v1/bills/detailed?subscriberNo=5551001&year=2026&month=10"
```

```http
HTTP/1.1 401 Unauthorized
Content-Type: application/json
Cache-Control: private
WWW-Authenticate: Bearer

{
  "error": {
    "code": "GATEWAY_UNAUTHORIZED",
    "message": "Missing or invalid access token (rejected by the API gateway)",
    "details": { "reason": "JWT not present.", "requestId": "c17535ef-79f6-446a-8af6-9583895b156f" }
  }
}
```

Screenshot: [`07-gateway-401.png`](docs/screenshots/07-gateway-401.png). The request never reached the Billing API.
Successful responses that pass the gateway carry the `X-Gateway: azure-api-management` header.

### Protected route through the gateway (success)

```powershell
$r = Invoke-RestMethod -Method Post -Uri "https://se4458-billing-gw-enes.azure-api.net/api/v1/auth/login" -ContentType "application/json" -Body '{"username":"ayse","password":"Ayse123!"}'
Invoke-RestMethod -Uri "https://se4458-billing-gw-enes.azure-api.net/api/v1/bills/detailed?subscriberNo=5551001&year=2026&month=10" -Headers @{Authorization = "Bearer $($r.accessToken)"}
```

### Rate limiting

The Group 2 specification defines no rate limit for its endpoints (the 3-calls-per-day rule belongs to
Group 1), so no rate-limit policy is configured.

## 5. Cloud deployment (Azure, Sweden Central)

| Component | Azure service | URL |
|---|---|---|
| API Gateway | API Management, Consumption | `https://se4458-billing-gw-enes.azure-api.net` |
| Billing REST API | App Service (Linux, Node 22, Free F1) | `https://se4458-billing-api-enes-c6czbfepexbrfxe9.swedencentral-01.azurewebsites.net` · [`/swagger`](https://se4458-billing-api-enes-c6czbfepexbrfxe9.swedencentral-01.azurewebsites.net/swagger) · [`/health`](https://se4458-billing-api-enes-c6czbfepexbrfxe9.swedencentral-01.azurewebsites.net/health) |
| MCP server | App Service (Linux, Node 22, Free F1) | `https://se4458-billing-mcp-enes-h9bxhxahdydsh2fc.swedencentral-01.azurewebsites.net/mcp` · [`/health`](https://se4458-billing-mcp-enes-h9bxhxahdydsh2fc.swedencentral-01.azurewebsites.net/health) |
| Database | Azure Database for PostgreSQL – Flexible Server (B1ms, PostgreSQL 18) | private connection string |
| AI agent | runs on the user's machine (CLI) | – |

All resources are in one resource group (`se4458-midterm-rg`). Cost: $0 (free App Service F1,
PostgreSQL free 12-month offer, APIM Consumption first 1M calls free, Gemini free tier).

### How it was deployed

1. **PostgreSQL:** Azure portal → *Azure Database for PostgreSQL flexible server* → Burstable B1ms, 32 GB,
   public access, "Allow Azure services" on, firewall rule for the developer IP → database `billing`.
   Tables + demo data: `cd billing-api && npm run db:seed` with `DATABASE_URL` pointing to Azure (`DB_SSL=true`).
2. **Billing API:** App Service (Linux, Node 22 LTS, F1). App settings: `DATABASE_URL`, `DB_SSL=true`,
   `JWT_SECRET`, `SCM_DO_BUILD_DURING_DEPLOYMENT=true`. Deployed from VS Code (Azure App Service extension →
   *Deploy to Web App* → `billing-api/`). Tables are created on startup if missing.
3. **MCP server:** second App Service on the same F1 plan. App settings: `MCP_API_KEY`,
   `SCM_DO_BUILD_DURING_DEPLOYMENT=true`. Deployed the same way from `mcp-server/`.
4. **API Management:** Consumption tier → named value `jwt-signing-key` (secret) → *Add API → OpenAPI*
   with `gateway/billing-api-v1.openapi.yaml`, URL suffix `api`, version `v1` (Path) → *Subscription required* off
   → policies from `gateway/policies/`.
5. **Agent:** `agent/.env` → `BILLING_API_URL=https://se4458-billing-gw-enes.azure-api.net`, `MCP_URL=https://se4458-billing-mcp-enes-h9bxhxahdydsh2fc.swedencentral-01.azurewebsites.net/mcp`, `MCP_API_KEY=<key>`.

The App Service F1 plan sleeps after ~20 minutes without traffic; the first request after that can take
20–30 s.

## How to reproduce the results (for the instructor)

Requirements: Node.js 22+ (for the agent; 20+ for the API and MCP server).
Demo users and data: see [Test data](#test-data-created-by-npm-run-dbseed).

**1. Unit tests – no keys, no cloud, no LLM needed**

```bash
cd billing-api && npm install && npm test     # 44 tests
cd ../mcp-server && npm install && npm test   # 23 tests
cd ../agent && npm install && npm test        # 19 tests (scripted fake LLM)
```

**2. Live REST API through the gateway (Azure)**

```bash
# public route
curl "https://se4458-billing-gw-enes.azure-api.net/api/v1/bills?subscriberNo=5551001&year=2026&month=10"
# protected route without token -> 401 from the gateway
curl -i "https://se4458-billing-gw-enes.azure-api.net/api/v1/bills/detailed?subscriberNo=5551001&year=2026&month=10"
# login, then call the protected route with the token
curl -X POST "https://se4458-billing-gw-enes.azure-api.net/api/v1/auth/login" -H "Content-Type: application/json" -d '{"username":"ayse","password":"Ayse123!"}'
curl "https://se4458-billing-gw-enes.azure-api.net/api/v1/bills/detailed?subscriberNo=5551001&year=2026&month=10" -H "Authorization: Bearer <accessToken>"
```

(Windows PowerShell versions of these commands are in [section 4](#protected-route-through-the-gateway-success).)
If the App Service was idle, the first request can take 20–30 s.

**3. AI agent against the live system – needs only your own free Gemini API key**

```bash
cd agent
cp .env.example .env      # Windows: copy .env.example .env
# edit .env:
#   GEMINI_API_KEY=<your key from https://aistudio.google.com>
#   BILLING_API_URL=https://se4458-billing-gw-enes.azure-api.net
#   MCP_URL=          (leave empty: the agent starts the MCP server from ../mcp-server locally over stdio;
#                      the deployed MCP server is protected with a private API key)
npm start                 # log in as ayse / Ayse123!
```

Then ask the demo questions from [section 6](#agent-scenarios-tool-trace). Each answer prints its tool trace,
and the full trace is saved in `agent/logs/`. Run `npm install` in `mcp-server/` first (step 1).

**4. Three MCP retrieval tests**

```bash
cd mcp-server
npm run demo              # real MCP client -> local MCP server (stdio) -> 3 queries
```

**5. Optional: run the Billing API yourself** with your own PostgreSQL, see [Run locally](#run-locally).

**Resetting the demo data:** payments made during testing change the balances. The deployed data can be
reset by the owner with `npm run db:seed`; the expected initial state is in the test-data table.

## 6. Demo video and evidence

### Demo video

**Video:** [SE4458_demonstration_video.mp4 (Google Drive)](https://drive.google.com/file/d/1qFDvALOocIUdVyUTjiBqruat5RsREf8Y/view?usp=sharing) (≈3.5 min). It shows the GitHub repository, the Azure deployment and
Swagger, a unit-test run, a protected gateway route rejected with 401, and the AI agent scenarios
(MCP only, REST only, combined, declined and confirmed payment, privacy).

### Unit test results

| Suite | Command | Result | Evidence |
|---|---|---|---|
| Billing API | `cd billing-api && npm test` | **44 passed** | [`01-tests-billing-api.png`](docs/screenshots/01-tests-billing-api.png) |
| MCP server | `cd mcp-server && npm test` | **23 passed** | [`02-tests-mcp-server.png`](docs/screenshots/02-tests-mcp-server.png) |
| AI agent | `cd agent && npm test` | **19 passed** | [`03-tests-agent.png`](docs/screenshots/03-tests-agent.png) |

All suites run without cloud resources or a live LLM (in-memory repository, in-memory MCP transport,
scripted fake LLM).

### Agent scenarios (tool trace)

Full trace: [`docs/agent-trace-demo.md`](docs/agent-trace-demo.md) (recorded with the deployed system).

| Scenario | Question | Tools chosen by the LLM |
|---|---|---|
| MCP only | How much does extra internet cost? | `search_billing_documentation` → §3.2 |
| REST only | What is my October bill? | `query_bill` (via gateway) |
| Combined | Why is my October bill higher? | `query_bill_detailed` (via gateway, JWT) + `search_billing_documentation` |
| Payment declined | Pay 20 dollars of my October bill → *no* | `pay_bill` → DECLINED, nothing sent ([screenshot](docs/screenshots/12-agent-payment-declined.png)) |
| **Confirmed payment** | Pay 20 dollars of my October bill → *yes* | `pay_bill` → CONFIRMED, `POST /api/v1/payments` → SUCCESS |
| Privacy | Show the October bill of subscriber 5551002 | no tool call – only the logged-in account is accessible |

### Screenshots

| # | What it shows |
|---|---|
| [01](docs/screenshots/01-tests-billing-api.png) · [02](docs/screenshots/02-tests-mcp-server.png) · [03](docs/screenshots/03-tests-agent.png) | Unit test runs (44 / 23 / 19 passed) |
| [04](docs/screenshots/04-azure-resources.png) | Azure resource group: PostgreSQL, App Service plan, API, MCP server, API Management |
| [05](docs/screenshots/05-swagger.png) | Swagger UI of the deployed Billing API |
| [06](docs/screenshots/06-mcp-health.png) | Deployed MCP server health: 26 chunks indexed once at startup |
| [07](docs/screenshots/07-gateway-401.png) | Protected gateway route without token → 401 `GATEWAY_UNAUTHORIZED` |
| [08](docs/screenshots/08-gateway-protected-ok.png) | Login through the gateway, then the protected route with JWT → detailed bill |
| [09](docs/screenshots/09-apim-routes.png) | API Management: versioned API `v1` and its operations |
| [10](docs/screenshots/10-apim-jwt-policy.png) | API Management: `validate-jwt` policy on a protected operation |
| [11](docs/screenshots/11-mcp-retrieval.png) | Three MCP retrieval tests against the deployed MCP server |
| [12](docs/screenshots/12-agent-payment-declined.png) | Agent payment confirmation, user declines → nothing paid |

## 7. Submission checklist

| Requirement | Where |
|---|---|
| Source code | `billing-api/`, `mcp-server/`, `agent/`, `gateway/` |
| Swagger / API documentation | [`billing-api/src/openapi.yaml`](billing-api/src/openapi.yaml), live [Swagger UI](https://se4458-billing-api-enes-c6czbfepexbrfxe9.swedencentral-01.azurewebsites.net/swagger) |
| ER diagram / data model | [`docs/ER-diagram.md`](docs/ER-diagram.md) |
| Gateway URL and route mappings | [section 4](#4-api-gateway--azure-api-management) |
| MCP tool schema and indexing approach | [section 2](#2-mcp-server--billing-guide-search) |
| Cloud deployment instructions / URLs | [section 5](#5-cloud-deployment-azure-sweden-central) |
| Assumptions | [Assumptions](#assumptions) |
| Test data and reproducibility | [Test data](#test-data-created-by-npm-run-dbseed), [How to reproduce](#how-to-reproduce-the-results-for-the-instructor) |
| Unit tests (success + failure per endpoint) and how to run them | [Unit test results](#unit-test-results) |
| Three agent scenarios + confirmed payment (tool trace) | [`docs/agent-trace-demo.md`](docs/agent-trace-demo.md) |
| Three MCP retrieval tests | [`docs/mcp-retrieval-demo.md`](docs/mcp-retrieval-demo.md) |
| Protected gateway route + error response | [section 4](#error-response-example-rejected-by-the-gateway), screenshots 07–10 |
| LLM cost / free tier | [LLM cost](#llm-cost) |
| Demo video | [section 6](#demo-video) |

## Assumptions

1. **Add Usage units:** each call adds exactly 10 minutes (PHONE) or 1 MB (INTERNET), as specified. Seed data inserts aggregated monthly usage directly (`source = 'SEED'`) because 35 GB would need 35,000 API calls.
2. **Rounding:** partially used extra blocks are charged as full blocks (guide 2.2, 3.2). Arithmetic is done in integer minutes/MB and integer cents to avoid floating point errors.
3. **Currency:** USD; no taxes or fees (guide 4.2).
4. **Calculate Bill** stores the bill. Calling it again for the same month re-calculates the charges from current usage but **keeps the amount already paid**; the status is derived again. Usage added after calculation is not in the bill until it is re-calculated.
5. **Query Bill / Pay Bill** need a calculated bill; otherwise `404 BILL_NOT_FOUND`.
6. **Pay Bill:** amount must be > 0, at most 2 decimals and ≤ remaining balance (`422`). Paying a fully paid bill → `409 BILL_ALREADY_PAID`. A reused `transactionId` → `409 DUPLICATE_TRANSACTION` (idempotency key, enforced also by a UNIQUE constraint). Concurrent payments are serialized with a row lock (`SELECT … FOR UPDATE`).
7. **Roles:** Add Usage and Calculate Bill are operator actions → `ADMIN`. Query Bill Detailed and Pay Bill are allowed for the subscriber that owns the number, or `ADMIN`. Query Bill is public, as required by the specification.
8. **Due date** is shown as 15 days after the end of the billing month (guide 6.1).
9. **Paging** in Query Bill Detailed is applied to the list of usage records; `pageSize` max 100.
10. **Policy interpretation (MCP):** the guide is split by its own section numbers so answers can cite "Section 3.2". The guide is treated as general policy only; live amounts always come from the Billing API (guide §9).
11. **Agent date handling:** if the user gives no year, the agent uses the most recent such month that is not in the future (today's date is put in the system prompt).
12. **Agent identity:** only SUBSCRIBER accounts can use the chat; ADMIN operations (Add Usage, Calculate Bill) are not exposed to the LLM.
13. **Deployment:** the agent runs locally as a CLI (a chat UI is allowed by the assignment); all servers it uses (gateway, API, MCP, database) run in Azure.
