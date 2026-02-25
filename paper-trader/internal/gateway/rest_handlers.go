package gateway

import (
	"encoding/json"
	"log/slog"
	"net/http"

	"github.com/google/uuid"
	"golang.org/x/crypto/bcrypt"
	"github.com/yourorg/paper-trader/internal/auth"
	"github.com/yourorg/paper-trader/internal/domain"
	"github.com/yourorg/paper-trader/internal/execution"
	pgRepo "github.com/yourorg/paper-trader/internal/repository/postgres"
)

type Handlers struct {
	userRepo      *pgRepo.UserRepo
	portfolioRepo *pgRepo.PortfolioRepo
	positionRepo  *pgRepo.PositionRepo
	orderRepo     *pgRepo.OrderRepo
	ledgerRepo    *pgRepo.LedgerRepo
	orderSvc      *execution.OrderService
	jwtSvc        *auth.JWTService
	logger        *slog.Logger
}

func NewHandlers(
	userRepo *pgRepo.UserRepo,
	portfolioRepo *pgRepo.PortfolioRepo,
	positionRepo *pgRepo.PositionRepo,
	orderRepo *pgRepo.OrderRepo,
	ledgerRepo *pgRepo.LedgerRepo,
	orderSvc *execution.OrderService,
	jwtSvc *auth.JWTService,
	logger *slog.Logger,
) *Handlers {
	return &Handlers{
		userRepo:      userRepo,
		portfolioRepo: portfolioRepo,
		positionRepo:  positionRepo,
		orderRepo:     orderRepo,
		ledgerRepo:    ledgerRepo,
		orderSvc:      orderSvc,
		jwtSvc:        jwtSvc,
		logger:        logger,
	}
}

type registerRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

type authResponse struct {
	Token     string            `json:"token"`
	User      *domain.User      `json:"user"`
	Portfolio *domain.Portfolio `json:"portfolio"`
}

func (h *Handlers) Register(w http.ResponseWriter, r *http.Request) {
	var req registerRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if req.Email == "" || req.Password == "" {
		writeError(w, http.StatusBadRequest, "email and password are required")
		return
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(req.Password), 12)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}
	user := &domain.User{
		Email:        req.Email,
		PasswordHash: string(hash),
	}
	if err := h.userRepo.Create(r.Context(), user); err != nil {
		writeError(w, http.StatusConflict, "email already registered")
		return
	}
	portfolio := &domain.Portfolio{
		UserID:      user.ID,
		Name:        "Paper Portfolio",
		CashBalance: 100000.0,
	}
	if err := h.portfolioRepo.Create(r.Context(), portfolio); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to create portfolio")
		return
	}
	token, err := h.jwtSvc.Sign(user.ID, portfolio.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to sign token")
		return
	}
	writeJSON(w, http.StatusCreated, authResponse{Token: token, User: user, Portfolio: portfolio})
}

func (h *Handlers) Login(w http.ResponseWriter, r *http.Request) {
	var req registerRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	user, err := h.userRepo.GetByEmail(r.Context(), req.Email)
	if err != nil {
		writeError(w, http.StatusUnauthorized, "invalid credentials")
		return
	}
	if err := bcrypt.CompareHashAndPassword([]byte(user.PasswordHash), []byte(req.Password)); err != nil {
		writeError(w, http.StatusUnauthorized, "invalid credentials")
		return
	}
	portfolio, err := h.portfolioRepo.GetByUserID(r.Context(), user.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to load portfolio")
		return
	}
	token, err := h.jwtSvc.Sign(user.ID, portfolio.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to sign token")
		return
	}
	writeJSON(w, http.StatusOK, authResponse{Token: token, User: user, Portfolio: portfolio})
}

func (h *Handlers) GetPortfolio(w http.ResponseWriter, r *http.Request) {
	portfolioID := auth.PortfolioIDFromCtx(r.Context())
	portfolio, err := h.portfolioRepo.GetByID(r.Context(), portfolioID)
	if err != nil {
		writeError(w, http.StatusNotFound, "portfolio not found")
		return
	}
	writeJSON(w, http.StatusOK, portfolio)
}

func (h *Handlers) GetPositions(w http.ResponseWriter, r *http.Request) {
	portfolioID := auth.PortfolioIDFromCtx(r.Context())
	positions, err := h.positionRepo.GetByPortfolioID(r.Context(), portfolioID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to fetch positions")
		return
	}
	writeJSON(w, http.StatusOK, positions)
}

func (h *Handlers) GetOrders(w http.ResponseWriter, r *http.Request) {
	portfolioID := auth.PortfolioIDFromCtx(r.Context())
	orders, err := h.orderRepo.GetByPortfolioID(r.Context(), portfolioID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to fetch orders")
		return
	}
	writeJSON(w, http.StatusOK, orders)
}

func (h *Handlers) GetLedger(w http.ResponseWriter, r *http.Request) {
	portfolioID := auth.PortfolioIDFromCtx(r.Context())
	entries, err := h.ledgerRepo.GetByPortfolioID(r.Context(), portfolioID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to fetch ledger")
		return
	}
	writeJSON(w, http.StatusOK, entries)
}

type createOrderRequest struct {
	Symbol     string           `json:"symbol"`
	Side       domain.OrderSide `json:"side"`
	OrderType  domain.OrderType `json:"order_type"`
	Quantity   float64          `json:"quantity"`
	LimitPrice *float64         `json:"limit_price,omitempty"`
}

func (h *Handlers) CreateOrder(w http.ResponseWriter, r *http.Request) {
	portfolioID := auth.PortfolioIDFromCtx(r.Context())
	var req createOrderRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	order := domain.Order{
		PortfolioID: portfolioID,
		Symbol:      req.Symbol,
		Side:        req.Side,
		OrderType:   req.OrderType,
		Quantity:    req.Quantity,
		LimitPrice:  req.LimitPrice,
	}
	result, err := h.orderSvc.SubmitAndExecute(r.Context(), order)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, result)
}

func (h *Handlers) GetOrder(w http.ResponseWriter, r *http.Request) {
	idStr := r.PathValue("id")
	id, err := uuid.Parse(idStr)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid order id")
		return
	}
	order, err := h.orderRepo.GetByID(r.Context(), id)
	if err != nil {
		writeError(w, http.StatusNotFound, "order not found")
		return
	}
	writeJSON(w, http.StatusOK, order)
}

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(v)
}

func writeError(w http.ResponseWriter, code int, msg string) {
	writeJSON(w, code, map[string]string{"error": msg})
}
