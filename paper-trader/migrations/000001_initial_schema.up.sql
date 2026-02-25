CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TYPE order_side AS ENUM ('buy', 'sell');
CREATE TYPE order_type AS ENUM ('market', 'limit', 'stop', 'stop_limit');
CREATE TYPE order_status AS ENUM ('pending', 'filled', 'partially_filled', 'cancelled', 'rejected');
CREATE TYPE entry_type AS ENUM ('deposit', 'withdrawal', 'trade_buy', 'trade_sell', 'fee');

CREATE TABLE users (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email         TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE portfolios (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name         TEXT NOT NULL DEFAULT 'Paper Portfolio',
    cash_balance NUMERIC(19,4) NOT NULL DEFAULT 100000.0000 CHECK (cash_balance >= 0),
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE positions (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    portfolio_id UUID NOT NULL REFERENCES portfolios(id) ON DELETE CASCADE,
    symbol       TEXT NOT NULL,
    quantity     NUMERIC(19,4) NOT NULL CHECK (quantity > 0),
    avg_cost     NUMERIC(19,4) NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (portfolio_id, symbol)
);

CREATE TABLE orders (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    portfolio_id  UUID NOT NULL REFERENCES portfolios(id) ON DELETE CASCADE,
    symbol        TEXT NOT NULL,
    side          order_side NOT NULL,
    order_type    order_type NOT NULL,
    quantity      NUMERIC(19,4) NOT NULL CHECK (quantity > 0),
    limit_price   NUMERIC(19,4),
    fill_price    NUMERIC(19,4),
    filled_qty    NUMERIC(19,4) NOT NULL DEFAULT 0,
    status        order_status NOT NULL DEFAULT 'pending',
    reject_reason TEXT,
    filled_at     TIMESTAMPTZ,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE ledger (
    id            BIGSERIAL PRIMARY KEY,
    portfolio_id  UUID NOT NULL REFERENCES portfolios(id) ON DELETE CASCADE,
    order_id      UUID REFERENCES orders(id),
    entry_type    entry_type NOT NULL,
    amount        NUMERIC(19,4) NOT NULL,
    balance_after NUMERIC(19,4) NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_portfolios_user_id  ON portfolios(user_id);
CREATE INDEX idx_positions_portfolio ON positions(portfolio_id);
CREATE INDEX idx_positions_symbol    ON positions(symbol);
CREATE INDEX idx_orders_portfolio    ON orders(portfolio_id);
CREATE INDEX idx_orders_status       ON orders(status);
CREATE INDEX idx_orders_created_at   ON orders(created_at);
CREATE INDEX idx_ledger_portfolio    ON ledger(portfolio_id);
CREATE INDEX idx_ledger_created_at   ON ledger(created_at);

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER portfolios_updated_at
    BEFORE UPDATE ON portfolios
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER positions_updated_at
    BEFORE UPDATE ON positions
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
