package execution

import (
	"fmt"

	"github.com/yourorg/paper-trader/internal/domain"
)

func validateOrderRequest(req *domain.Order) error {
	if req.Quantity <= 0 {
		return fmt.Errorf("quantity must be greater than zero")
	}
	if req.Symbol == "" {
		return fmt.Errorf("symbol is required")
	}
	switch req.Side {
	case domain.SideBuy, domain.SideSell:
	default:
		return fmt.Errorf("invalid order side: %s", req.Side)
	}
	switch req.OrderType {
	case domain.TypeMarket, domain.TypeLimit, domain.TypeStop, domain.TypeStopLimit:
	default:
		return fmt.Errorf("invalid order type: %s", req.OrderType)
	}
	return nil
}
