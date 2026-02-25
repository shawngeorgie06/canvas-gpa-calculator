package postgres

import (
	"context"

	"github.com/google/uuid"
	"github.com/jmoiron/sqlx"
	"github.com/yourorg/paper-trader/internal/domain"
)

type LedgerRepo struct {
	db *sqlx.DB
}

func NewLedgerRepo(db *sqlx.DB) *LedgerRepo {
	return &LedgerRepo{db: db}
}

func (r *LedgerRepo) InsertTx(ctx context.Context, tx *sqlx.Tx, entry *domain.LedgerEntry) error {
	query := `
		INSERT INTO ledger (portfolio_id, order_id, entry_type, amount, balance_after)
		VALUES ($1, $2, $3, $4, $5)
		RETURNING id, created_at`
	return tx.QueryRowContext(ctx, query,
		entry.PortfolioID, entry.OrderID, entry.EntryType, entry.Amount, entry.BalanceAfter).
		Scan(&entry.ID, &entry.CreatedAt)
}

func (r *LedgerRepo) GetByPortfolioID(ctx context.Context, portfolioID uuid.UUID) ([]domain.LedgerEntry, error) {
	var entries []domain.LedgerEntry
	err := r.db.SelectContext(ctx, &entries,
		`SELECT * FROM ledger WHERE portfolio_id = $1 ORDER BY id DESC`, portfolioID)
	if err != nil {
		return nil, err
	}
	return entries, nil
}
