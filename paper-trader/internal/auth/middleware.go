package auth

import (
	"context"
	"net/http"
	"strings"

	"github.com/google/uuid"
)

type contextKey string

const (
	contextKeyUserID      contextKey = "userID"
	contextKeyPortfolioID contextKey = "portfolioID"
)

func Middleware(jwtSvc *JWTService) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			header := r.Header.Get("Authorization")
			if !strings.HasPrefix(header, "Bearer ") {
				http.Error(w, `{"error":"unauthorized"}`, http.StatusUnauthorized)
				return
			}
			tokenStr := strings.TrimPrefix(header, "Bearer ")
			claims, err := jwtSvc.Parse(tokenStr)
			if err != nil {
				http.Error(w, `{"error":"unauthorized"}`, http.StatusUnauthorized)
				return
			}
			ctx := context.WithValue(r.Context(), contextKeyUserID, claims.UserID)
			ctx = context.WithValue(ctx, contextKeyPortfolioID, claims.PortfolioID)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

func UserIDFromCtx(ctx context.Context) uuid.UUID {
	v, _ := ctx.Value(contextKeyUserID).(uuid.UUID)
	return v
}

func PortfolioIDFromCtx(ctx context.Context) uuid.UUID {
	v, _ := ctx.Value(contextKeyPortfolioID).(uuid.UUID)
	return v
}
