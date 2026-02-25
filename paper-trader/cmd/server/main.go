package main

import (
	"context"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/joho/godotenv"
	"github.com/yourorg/paper-trader/internal/auth"
	"github.com/yourorg/paper-trader/internal/execution"
	"github.com/yourorg/paper-trader/internal/gateway"
	"github.com/yourorg/paper-trader/internal/ingestion"
	pgRepo "github.com/yourorg/paper-trader/internal/repository/postgres"
	redisRepo "github.com/yourorg/paper-trader/internal/repository/redis"
)

func main() {
	_ = godotenv.Load()

	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))

	dbURL := os.Getenv("DATABASE_URL")
	redisURL := os.Getenv("REDIS_URL")
	alpacaKey := os.Getenv("ALPACA_API_KEY")
	alpacaSecret := os.Getenv("ALPACA_API_SECRET")
	jwtSecret := os.Getenv("JWT_SECRET")
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	db, err := pgRepo.Connect(dbURL)
	if err != nil {
		logger.Error("failed to connect to database", "err", err)
		os.Exit(1)
	}
	logger.Info("database connected")

	if err := pgRepo.RunMigrations(dbURL, "migrations"); err != nil {
		logger.Error("failed to run migrations", "err", err)
		os.Exit(1)
	}
	logger.Info("migrations applied")

	redisClient, err := redisRepo.Connect(redisURL)
	if err != nil {
		logger.Error("failed to connect to redis", "err", err)
		os.Exit(1)
	}
	logger.Info("redis connected")

	userRepo := pgRepo.NewUserRepo(db)
	portfolioRepo := pgRepo.NewPortfolioRepo(db)
	positionRepo := pgRepo.NewPositionRepo(db)
	orderRepo := pgRepo.NewOrderRepo(db)
	ledgerRepo := pgRepo.NewLedgerRepo(db)
	priceRepo := redisRepo.NewPriceRepo(redisClient)

	jwtSvc := auth.NewJWTService(jwtSecret)

	orderSvc := execution.NewOrderService(db, portfolioRepo, positionRepo, orderRepo, ledgerRepo, priceRepo)

	hub := gateway.NewHub(priceRepo, logger)

	alpacaClient := ingestion.NewAlpacaClient(alpacaKey, alpacaSecret, priceRepo, logger)

	handlers := gateway.NewHandlers(
		userRepo, portfolioRepo, positionRepo, orderRepo, ledgerRepo,
		orderSvc, jwtSvc, logger,
	)
	router := gateway.NewRouter(handlers, hub, jwtSvc)

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	go hub.Run(ctx)
	go alpacaClient.Run(ctx)

	srv := &http.Server{
		Addr:         ":" + port,
		Handler:      router,
		ReadTimeout:  15 * time.Second,
		WriteTimeout: 15 * time.Second,
		IdleTimeout:  60 * time.Second,
	}

	go func() {
		logger.Info("server starting", "port", port)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			logger.Error("server error", "err", err)
		}
	}()

	<-ctx.Done()
	logger.Info("shutting down")

	shutdownCtx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	if err := srv.Shutdown(shutdownCtx); err != nil {
		logger.Error("shutdown error", "err", err)
	}
	logger.Info("server stopped")
}
