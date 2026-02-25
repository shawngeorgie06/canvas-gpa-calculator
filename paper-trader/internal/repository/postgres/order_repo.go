package postgres

import (
	"context"
	"fmt"

	"github.com/google/uuid"
	"github.com/jmoiron/sqlx"
	"github.com/yourorg/paper-trader/internal/domain"
)

type OrderRepo struct {
	db *sqlx.DB
}

func NewOrderRepo(db *sqlx.DB) *OrderRepo {
	return &OrderRepo{db: db}
}

func (r *OrderRepo) CreateTx(ctx context.Context, tx *sqlx.Tx, o *domain.Order) error {
	if o.ID == uuid.Nil {
		o.ID = uuid.New()
	}
	query := `
		INSERT INTO orders (id, portfolio_id, symbol, side, order_type, quantity, limit_price, status)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
		RETURNING created_at, updated_at`
	return tx.QueryRowContext(ctx, query,
		o.ID, o.PortfolioID, o.Symbol, o.Side, o.OrderType, o.Quantity, o.LimitPrice, o.Status).
		Scan(&o.CreatedAt, &o.UpdatedAt)
}

func (r *OrderRepo) UpdateStatusTx(ctx context.Context, tx *sqlx.Tx, id uuid.UUID, status domain.OrderStatus, fillPrice float64, filledQty float64) error {
	_, err := tx.ExecContext(ctx, `
		UPDATE orders
		SET status = $1, fill_price = $2, filled_qty = $3, filled_at = NOW(), updated_at = NOW()
		WHERE id = $4`,
		status, fillPrice, filledQty, id)
	return err
}

func (r *OrderRepo) UpdateRejectedTx(ctx context.Context, tx *sqlx.Tx, id uuid.UUID, reason string) error {
	_, err := tx.ExecContext(ctx, `
		UPDATE orders
		SET status = $1, reject_reason = $2, updated_at = NOW()
		WHERE id = $3`,
		domain.StatusRejected, reason, id)
	return err
}

func (r *OrderRepo) GetByPortfolioID(ctx context.Context, portfolioID uuid.UUID) ([]domain.Order, error) {
	var orders []domain.Order
	err := r.db.SelectContext(ctx, &orders,
		`SELECT * FROM orders WHERE portfolio_id = $1 ORDER BY created_at DESC`, portfolioID)
	if err != nil {
		return nil, err
	}
	return orders, nil
}

func (r *OrderRepo) GetByID(ctx context.Context, id uuid.UUID) (*domain.Order, error) {
	var o domain.Order
	err := r.db.GetContext(ctx, &o, `SELECT * FROM orders WHERE id = $1`, id)
	if err != nil {
		return nil, fmt.Errorf("order not found: %w", err)
	}
	return &o, nil
}
