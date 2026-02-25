package gateway

import (
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/cors"
	"github.com/yourorg/paper-trader/internal/auth"
)

func NewRouter(h *Handlers, hub *Hub, jwtSvc *auth.JWTService) http.Handler {
	r := chi.NewRouter()

	r.Use(middleware.RequestID)
	r.Use(middleware.RealIP)
	r.Use(middleware.Logger)
	r.Use(middleware.Recoverer)
	r.Use(cors.Handler(cors.Options{
		AllowedOrigins:   []string{"http://localhost:5174"},
		AllowedMethods:   []string{"GET", "POST", "PUT", "DELETE", "OPTIONS"},
		AllowedHeaders:   []string{"Accept", "Authorization", "Content-Type"},
		AllowCredentials: true,
		MaxAge:           300,
	}))

	r.Post("/api/auth/register", h.Register)
	r.Post("/api/auth/login", h.Login)

	r.Route("/api", func(r chi.Router) {
		r.Use(auth.Middleware(jwtSvc))
		r.Get("/portfolio", h.GetPortfolio)
		r.Get("/positions", h.GetPositions)
		r.Get("/orders", h.GetOrders)
		r.Post("/orders", h.CreateOrder)
		r.Get("/orders/{id}", h.GetOrder)
		r.Get("/ledger", h.GetLedger)
	})

	r.Get("/ws", ServeWS(hub, h.logger))

	return r
}
