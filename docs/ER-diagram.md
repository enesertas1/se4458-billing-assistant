# ER / Data Model

```mermaid
erDiagram
    SUBSCRIBERS ||--o{ APP_USERS : "has login"
    SUBSCRIBERS ||--o{ USAGE_EVENTS : records
    SUBSCRIBERS ||--o{ BILLS : "billed monthly"
    BILLS ||--o{ PAYMENTS : "paid by"

    SUBSCRIBERS {
        varchar subscriber_no PK
        varchar full_name
        timestamptz created_at
    }
    APP_USERS {
        varchar username PK
        varchar password_hash "bcrypt"
        varchar role "SUBSCRIBER | ADMIN"
        varchar subscriber_no FK "null for ADMIN"
    }
    USAGE_EVENTS {
        bigint id PK
        varchar subscriber_no FK
        smallint year
        smallint month
        varchar usage_type "PHONE | INTERNET"
        int amount "minutes or MB"
        varchar source "API | SEED"
        timestamptz created_at
    }
    BILLS {
        bigint id PK
        varchar subscriber_no FK
        smallint year
        smallint month
        int phone_minutes
        int internet_mb
        numeric phone_charge
        numeric internet_charge
        numeric total
        numeric paid_amount
        varchar status "UNPAID | PARTIALLY_PAID | PAID"
        timestamptz calculated_at
    }
    PAYMENTS {
        bigint id PK
        varchar transaction_id UK "idempotency key"
        bigint bill_id FK
        numeric amount
        timestamptz created_at
    }
```

## Design notes

| Rule | How it is enforced |
|---|---|
| One bill per subscriber per month | `UNIQUE (subscriber_no, year, month)` on `bills`; Calculate Bill does an upsert |
| Duplicate transaction IDs are rejected | `UNIQUE (transaction_id)` on `payments` + check in the service (HTTP 409) |
| Balance can never go below zero | Payment runs in a DB transaction with `SELECT ... FOR UPDATE` on the bill row; amount > remaining → HTTP 422 |
| Subscriber sees only own data | `app_users.subscriber_no` is copied into the JWT; ownership middleware compares it with the request |
| Remaining balance | Not stored; computed as `total − paid_amount` |
