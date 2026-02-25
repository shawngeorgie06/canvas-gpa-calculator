package postgres

import (
	"context"
	"database/sql"
	"errors"

	"github.com/google/uuid"
	"github.com/jmoiron/sqlx"
	"github.com/yourorg/paper-trader/internal/domain"
)

type PositionRepo struct {
	db *sqlx.DB
}

func NewPositionRepo(db *sqlx.DB) *PositionRepo {
	return &PositionRepo{db: db}
}

func (r *PositionRepo) GetByPortfolioID(ctx context.Context, portfolioID uuid.UUID) ([]domain.Position, error) {
	var positions []domain.Position
	err := r.db.SelectContext(ctx, &positions,
		`SELECT * FROM positions WHERE portfolio_id = $1 ORDER BY symbol`, portfolioID)
	if err != nil {
		return nil, err
	}
	return positions, nil
}

func (r *PositionRepo) GetBySymbolTx(ctx context.Context, tx *sqlx.Tx, portfolioID uuid.UUID, symbol string) (*domain.Position, error) {
	var p domain.Position
	err := tx.GetContext(ctx, &p,
		`SELECT * FROM positions WHERE portfolio_id = $1 AND symbol = $2`, portfolioID, symbol)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	return &p, nil
}

func (r *PositionRepo) UpsertTx(ctx context.Context, tx *sqlx.Tx, portfolioID uuid.UUID, symbol string, qty, price float64) error {
	id := uuid.New()
	_, err := tx.ExecContext(ctx, `
		INSERT INTO positions (id, portfolio_id, symbol, quantity, avg_cost)
		VALUES ($1, $2, $3, $4, $5)
		ON CONFLICT (portfolio_id, symbol) DO UPDATE SET
			quantity   = positions.quantity + EXCLUDED.quantity,
			avg_cost   = (positions.quantity * positions.avg_cost + EXCLUDED.quantity * EXCLUDED.avg_cost)
			             / (positions.quantity + EXCLUDED.quantity),
			updated_at = NOW()`,
		id, portfolioID, symbol, qty, price)
	return err
}

func (r *PositionRepo) UpdateQtyTx(ctx context.Context, tx *sqlx.Tx, portfolioID uuid.UUID, symbol string, newQty float64) error {
	_, err := tx.ExecContext(ctx,
		`UPDATE positions SET quantity = $1, updated_at = NOW() WHERE portfolio_id = $2 AND symbol = $3`,
		newQty, portfolioID, symbol)
	return err
}

func (r *PositionRepo) DeleteTx(ctx context.Context, tx *sqlx.Tx, portfolioID uuid.UUID, symbol string) error {
	_, err := tx.ExecContext(ctx,
		`DELETE FROM positions WHERE portfolio_id = $1 AND symbol = $2`,
		portfolioID, symbol)
	return err
}
