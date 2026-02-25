package postgres

import (
	"context"
	"fmt"

	"github.com/google/uuid"
	"github.com/jmoiron/sqlx"
	"github.com/yourorg/paper-trader/internal/domain"
)

type PortfolioRepo struct {
	db *sqlx.DB
}

func NewPortfolioRepo(db *sqlx.DB) *PortfolioRepo {
	return &PortfolioRepo{db: db}
}

func (r *PortfolioRepo) Create(ctx context.Context, p *domain.Portfolio) error {
	if p.ID == uuid.Nil {
		p.ID = uuid.New()
	}
	query := `
		INSERT INTO portfolios (id, user_id, name, cash_balance)
		VALUES ($1, $2, $3, $4)
		RETURNING created_at, updated_at`
	return r.db.QueryRowContext(ctx, query, p.ID, p.UserID, p.Name, p.CashBalance).
		Scan(&p.CreatedAt, &p.UpdatedAt)
}

func (r *PortfolioRepo) GetByUserID(ctx context.Context, userID uuid.UUID) (*domain.Portfolio, error) {
	var p domain.Portfolio
	err := r.db.GetContext(ctx, &p, `SELECT * FROM portfolios WHERE user_id = $1 LIMIT 1`, userID)
	if err != nil {
		return nil, fmt.Errorf("portfolio not found: %w", err)
	}
	return &p, nil
}

func (r *PortfolioRepo) GetByID(ctx context.Context, id uuid.UUID) (*domain.Portfolio, error) {
	var p domain.Portfolio
	err := r.db.GetContext(ctx, &p, `SELECT * FROM portfolios WHERE id = $1`, id)
	if err != nil {
		return nil, fmt.Errorf("portfolio not found: %w", err)
	}
	return &p, nil
}

func (r *PortfolioRepo) GetByIDForUpdateTx(ctx context.Context, tx *sqlx.Tx, id uuid.UUID) (*domain.Portfolio, error) {
	var p domain.Portfolio
	err := tx.GetContext(ctx, &p, `SELECT * FROM portfolios WHERE id = $1 FOR UPDATE`, id)
	if err != nil {
		return nil, fmt.Errorf("portfolio not found: %w", err)
	}
	return &p, nil
}

func (r *PortfolioRepo) UpdateCashBalanceTx(ctx context.Context, tx *sqlx.Tx, id uuid.UUID, newBalance float64) error {
	_, err := tx.ExecContext(ctx,
		`UPDATE portfolios SET cash_balance = $1, updated_at = NOW() WHERE id = $2`,
		newBalance, id)
	return err
}
