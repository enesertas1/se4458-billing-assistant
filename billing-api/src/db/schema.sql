-- SE4458 Midterm - Group 2 - Mobile Provider Billing
-- PostgreSQL schema (idempotent: safe to run more than once)

CREATE TABLE IF NOT EXISTS subscribers (
    subscriber_no   VARCHAR(20)  PRIMARY KEY,
    full_name       VARCHAR(100) NOT NULL,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- Login accounts. A SUBSCRIBER account is bound to exactly one subscriber_no;
-- an ADMIN account (operator / back-office system) has no subscriber_no.
CREATE TABLE IF NOT EXISTS app_users (
    username        VARCHAR(50)  PRIMARY KEY,
    password_hash   VARCHAR(100) NOT NULL,
    role            VARCHAR(20)  NOT NULL CHECK (role IN ('SUBSCRIBER', 'ADMIN')),
    subscriber_no   VARCHAR(20)  REFERENCES subscribers(subscriber_no),
    CHECK (role = 'ADMIN' OR subscriber_no IS NOT NULL)
);

-- Every Add Usage call inserts one row (10 minutes of PHONE or 1 MB of INTERNET).
-- Seed data may insert larger aggregated amounts (source = 'SEED').
CREATE TABLE IF NOT EXISTS usage_events (
    id              BIGSERIAL    PRIMARY KEY,
    subscriber_no   VARCHAR(20)  NOT NULL REFERENCES subscribers(subscriber_no),
    year            SMALLINT     NOT NULL CHECK (year BETWEEN 2000 AND 2100),
    month           SMALLINT     NOT NULL CHECK (month BETWEEN 1 AND 12),
    usage_type      VARCHAR(10)  NOT NULL CHECK (usage_type IN ('PHONE', 'INTERNET')),
    amount          INTEGER      NOT NULL CHECK (amount > 0),   -- minutes for PHONE, MB for INTERNET
    source          VARCHAR(10)  NOT NULL DEFAULT 'API' CHECK (source IN ('API', 'SEED')),
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_usage_period ON usage_events (subscriber_no, year, month);

-- One stored bill per subscriber per billing month (created by Calculate Bill).
CREATE TABLE IF NOT EXISTS bills (
    id              BIGSERIAL     PRIMARY KEY,
    subscriber_no   VARCHAR(20)   NOT NULL REFERENCES subscribers(subscriber_no),
    year            SMALLINT      NOT NULL,
    month           SMALLINT      NOT NULL,
    phone_minutes   INTEGER       NOT NULL,
    internet_mb     INTEGER       NOT NULL,
    phone_charge    NUMERIC(12,2) NOT NULL,
    internet_charge NUMERIC(12,2) NOT NULL,
    total           NUMERIC(12,2) NOT NULL,
    paid_amount     NUMERIC(12,2) NOT NULL DEFAULT 0,
    status          VARCHAR(20)   NOT NULL CHECK (status IN ('UNPAID', 'PARTIALLY_PAID', 'PAID')),
    calculated_at   TIMESTAMPTZ   NOT NULL DEFAULT now(),
    UNIQUE (subscriber_no, year, month)
);

-- transaction_id is UNIQUE -> duplicate payments are rejected at DB level too.
CREATE TABLE IF NOT EXISTS payments (
    id              BIGSERIAL     PRIMARY KEY,
    transaction_id  VARCHAR(64)   NOT NULL UNIQUE,
    bill_id         BIGINT        NOT NULL REFERENCES bills(id),
    amount          NUMERIC(12,2) NOT NULL CHECK (amount > 0),
    created_at      TIMESTAMPTZ   NOT NULL DEFAULT now()
);
