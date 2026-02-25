package domain

import (
	"time"

	"github.com/google/uuid"
)

type OrderSide string

const (
	SideBuy  OrderSide = "buy"
	SideSell OrderSide = "sell"
)

type OrderType string

const (
	TypeMarket    OrderType = "market"
	TypeLimit     OrderType = "limit"
	TypeStop      OrderType = "stop"
	TypeStopLimit OrderType = "stop_limit"
)

type OrderStatus string

const (
	StatusPending         OrderStatus = "pending"
	StatusFilled          OrderStatus = "filled"
	StatusPartiallyFilled OrderStatus = "partially_filled"
	StatusCancelled       OrderStatus = "cancelled"
	StatusRejected        OrderStatus = "rejected"
)

type EntryType string

const (
	EntryDeposit    EntryType = "deposit"
	EntryWithdrawal EntryType = "withdrawal"
	EntryTradeBuy   EntryType = "trade_buy"
	EntryTradeSell  EntryType = "trade_sell"
	EntryFee        EntryType = "fee"
)

type User struct {
	ID           uuid.UUID `db:"id"            json:"id"`
	Email        string    `db:"email"         json:"email"`
	PasswordHash string    `db:"password_hash" json:"-"`
	CreatedAt    time.Time `db:"created_at"    json:"created_at"`
	UpdatedAt    time.Time `db:"updated_at"    json:"updated_at"`
}

type Portfolio struct {
	ID          uuid.UUID `db:"id"           json:"id"`
	UserID      uuid.UUID `db:"user_id"      json:"user_id"`
	Name        string    `db:"name"         json:"name"`
	CashBalance float64   `db:"cash_balance" json:"cash_balance"`
	CreatedAt   time.Time `db:"created_at"   json:"created_at"`
	UpdatedAt   time.Time `db:"updated_at"   json:"updated_at"`
}

type Position struct {
	ID          uuid.UUID `db:"id"           json:"id"`
	PortfolioID uuid.UUID `db:"portfolio_id" json:"portfolio_id"`
	Symbol      string    `db:"symbol"       json:"symbol"`
	Quantity    float64   `db:"quantity"     json:"quantity"`
	AvgCost     float64   `db:"avg_cost"     json:"avg_cost"`
	CreatedAt   time.Time `db:"created_at"   json:"created_at"`
	UpdatedAt   time.Time `db:"updated_at"   json:"updated_at"`
}

type Order struct {
	ID           uuid.UUID   `db:"id"            json:"id"`
	PortfolioID  uuid.UUID   `db:"portfolio_id"  json:"portfolio_id"`
	Symbol       string      `db:"symbol"        json:"symbol"`
	Side         OrderSide   `db:"side"          json:"side"`
	OrderType    OrderType   `db:"order_type"    json:"order_type"`
	Quantity     float64     `db:"quantity"      json:"quantity"`
	LimitPrice   *float64    `db:"limit_price"   json:"limit_price,omitempty"`
	FillPrice    *float64    `db:"fill_price"    json:"fill_price,omitempty"`
	FilledQty    float64     `db:"filled_qty"    json:"filled_qty"`
	Status       OrderStatus `db:"status"        json:"status"`
	RejectReason *string     `db:"reject_reason" json:"reject_reason,omitempty"`
	FilledAt     *time.Time  `db:"filled_at"     json:"filled_at,omitempty"`
	CreatedAt    time.Time   `db:"created_at"    json:"created_at"`
	UpdatedAt    time.Time   `db:"updated_at"    json:"updated_at"`
}

type LedgerEntry struct {
	ID           int64      `db:"id"            json:"id"`
	PortfolioID  uuid.UUID  `db:"portfolio_id"  json:"portfolio_id"`
	OrderID      *uuid.UUID `db:"order_id"      json:"order_id,omitempty"`
	EntryType    EntryType  `db:"entry_type"    json:"entry_type"`
	Amount       float64    `db:"amount"        json:"amount"`
	BalanceAfter float64    `db:"balance_after" json:"balance_after"`
	CreatedAt    time.Time  `db:"created_at"    json:"created_at"`
}

type PriceTick struct {
	Symbol    string    `json:"symbol"`
	Price     float64   `json:"price"`
	Size      float64   `json:"size"`
	Timestamp time.Time `json:"timestamp"`
}
