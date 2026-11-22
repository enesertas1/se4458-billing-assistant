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
| `mcp-server/` | MCP SDK server exposing `search_billing_documentation(query)` | ⏳ next |
| `gateway/` | API Gateway configuration (Azure API Management) | ⏳ |
| `agent/` | AI Agent (LLM tool calling + MCP client + REST client) and chat UI | ⏳ |
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
