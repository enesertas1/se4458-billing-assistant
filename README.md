# SE4458 Midterm 1 – Group 2: AI Billing Support Assistant

Conversational assistant for mobile subscribers. An LLM-powered **AI Agent** decides whether to
search the billing guide through an **MCP Server**, call the **Billing REST API** through an
**API Gateway**, or both.

```
User ─► AI Agent ◄──► LLM (Gemini / Groq, tool calling)
          │
          ├─► MCP Client ─► MCP Server ─► indexed Mobile_Provider_Billing_Guide.md
          │
          └─► API Gateway (/api/v1/...) ─► Billing REST API ─► PostgreSQL
```

## Repository layout

| Folder | Content | Status |
|---|---|---|
| `billing-api/` | Node.js/Express REST API, JWT auth, Swagger, Jest tests | ✅ done |
| `mcp-server/` | MCP SDK server exposing `search_billing_documentation(query)`, Jest tests | ✅ done |
| `agent/` | AI Agent: Gemini tool calling + MCP client + REST client, terminal chat, Jest tests | ✅ done |
| `gateway/` | Azure API Management: imported API definition + policies | ✅ done |
| `docs/` | ER diagram, screenshots, tool traces | ⏳ |

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

Requirements: Node.js 20+. No local database is needed: the API connects to the
PostgreSQL server on Azure (Azure Database for PostgreSQL – Flexible Server).

```bash
cd billing-api
cp .env.example .env                 # Windows: copy .env.example .env
# edit .env -> DATABASE_URL = Azure PostgreSQL connection string, DB_SSL=true
npm install
npm run db:seed                      # creates tables + demo data
npm start                            # http://localhost:3000/swagger
```

### Unit tests

```bash
cd billing-api
npm test
```

Tests use an in-memory repository, so they need **no database, no cloud and no LLM**.
Every operation has success and failure/edge-case tests (validation, 401/403, duplicate
transaction, overpayment, paging, re-calculation, pricing boundaries).

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

Output of `npm run demo -- --save` is in [`docs/mcp-retrieval-demo.md`](docs/mcp-retrieval-demo.md).

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
WWW-Authenticate: Bearer
X-Gateway: azure-api-management

{"error":{"code":"GATEWAY_UNAUTHORIZED","message":"Missing or invalid access token (rejected by the API gateway)","details":{"reason":"...","requestId":"..."}}}
```

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
