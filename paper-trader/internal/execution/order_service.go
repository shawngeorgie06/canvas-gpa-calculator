package execution

import (
	"context"
	"fmt"
	"time"

	"github.com/jmoiron/sqlx"
	"github.com/yourorg/paper-trader/internal/domain"
	pgRepo "github.com/yourorg/paper-trader/internal/repository/postgres"
	redisRepo "github.com/yourorg/paper-trader/internal/repository/redis"
)

type OrderService struct {
	db            *sqlx.DB
	portfolioRepo *pgRepo.PortfolioRepo
	positionRepo  *pgRepo.PositionRepo
	orderRepo     *pgRepo.OrderRepo
	ledgerRepo    *pgRepo.LedgerRepo
	priceRepo     *redisRepo.PriceRepo
}

func NewOrderService(
	db *sqlx.DB,
	portfolioRepo *pgRepo.PortfolioRepo,
	positionRepo *pgRepo.PositionRepo,
	orderRepo *pgRepo.OrderRepo,
	ledgerRepo *pgRepo.LedgerRepo,
	priceRepo *redisRepo.PriceRepo,
) *OrderService {
	return &OrderService{
		db:            db,
		portfolioRepo: portfolioRepo,
		positionRepo:  positionRepo,
		orderRepo:     orderRepo,
		ledgerRepo:    ledgerRepo,
		priceRepo:     priceRepo,
	}
}

func (s *OrderService) SubmitAndExecute(ctx context.Context, req domain.Order) (*domain.Order, error) {
	if err := validateOrderRequest(&req); err != nil {
		return nil, err
	}

	tick, err := s.priceRepo.GetLastPrice(ctx, req.Symbol)
	if err != nil {
		return nil, fmt.Errorf("price lookup failed: %w", err)
	}
	if tick == nil {
		return nil, fmt.Errorf("no price data available for symbol: %s", req.Symbol)
	}

	fillPrice := tick.Price
	cost := fillPrice * req.Quantity

	req.Status = domain.StatusPending

	tx, err := s.db.BeginTxx(ctx, nil)
	if err != nil {
		return nil, fmt.Errorf("begin transaction: %w", err)
	}
	defer tx.Rollback()

	portfolio, err := s.portfolioRepo.GetByIDForUpdateTx(ctx, tx, req.PortfolioID)
	if err != nil {
		return nil, fmt.Errorf("get portfolio: %w", err)
	}

	if req.Side == domain.SideBuy {
		if portfolio.CashBalance < cost {
			req.Status = domain.StatusRejected
			reason := "insufficient funds"
			req.RejectReason = &reason
			if err := s.orderRepo.CreateTx(ctx, tx, &req); err != nil {
				return nil, err
			}
			if err := tx.Commit(); err != nil {
				return nil, err
			}
			return &req, nil
		}
	} else {
		pos, err := s.positionRepo.GetBySymbolTx(ctx, tx, req.PortfolioID, req.Symbol)
		if err != nil {
			return nil, fmt.Errorf("get position: %w", err)
		}
		if pos == nil || pos.Quantity < req.Quantity {
			req.Status = domain.StatusRejected
			reason := "insufficient position"
			req.RejectReason = &reason
			if err := s.orderRepo.CreateTx(ctx, tx, &req); err != nil {
				return nil, err
			}
			if err := tx.Commit(); err != nil {
				return nil, err
			}
			return &req, nil
		}
	}

	if err := s.orderRepo.CreateTx(ctx, tx, &req); err != nil {
		return nil, fmt.Errorf("create order: %w", err)
	}

	var newBalance float64
	var entryType domain.EntryType
	if req.Side == domain.SideBuy {
		newBalance = portfolio.CashBalance - cost
		entryType = domain.EntryTradeBuy
		if err := s.positionRepo.UpsertTx(ctx, tx, req.PortfolioID, req.Symbol, req.Quantity, fillPrice); err != nil {
			return nil, fmt.Errorf("upsert position: %w", err)
		}
	} else {
		newBalance = portfolio.CashBalance + cost
		entryType = domain.EntryTradeSell
		pos, err := s.positionRepo.GetBySymbolTx(ctx, tx, req.PortfolioID, req.Symbol)
		if err != nil {
			return nil, fmt.Errorf("get position for sell: %w", err)
		}
		newQty := pos.Quantity - req.Quantity
		if newQty == 0 {
			if err := s.positionRepo.DeleteTx(ctx, tx, req.PortfolioID, req.Symbol); err != nil {
				return nil, fmt.Errorf("delete position: %w", err)
			}
		} else {
			if err := s.positionRepo.UpdateQtyTx(ctx, tx, req.PortfolioID, req.Symbol, newQty); err != nil {
				return nil, fmt.Errorf("update position qty: %w", err)
			}
		}
	}

	if err := s.portfolioRepo.UpdateCashBalanceTx(ctx, tx, req.PortfolioID, newBalance); err != nil {
		return nil, fmt.Errorf("update cash balance: %w", err)
	}

	if err := s.orderRepo.UpdateStatusTx(ctx, tx, req.ID, domain.StatusFilled, fillPrice, req.Quantity); err != nil {
		return nil, fmt.Errorf("update order status: %w", err)
	}

	amountSign := -cost
	if req.Side == domain.SideSell {
		amountSign = cost
	}
	entry := domain.LedgerEntry{
		PortfolioID:  req.PortfolioID,
		OrderID:      &req.ID,
		EntryType:    entryType,
		Amount:       amountSign,
		BalanceAfter: newBalance,
	}
	if err := s.ledgerRepo.InsertTx(ctx, tx, &entry); err != nil {
		return nil, fmt.Errorf("insert ledger entry: %w", err)
	}

	if err := tx.Commit(); err != nil {
		return nil, fmt.Errorf("commit transaction: %w", err)
	}

	req.Status = domain.StatusFilled
	req.FillPrice = &fillPrice
	req.FilledQty = req.Quantity
	now := time.Now()
	req.FilledAt = &now

	return &req, nil
}
