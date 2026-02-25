package redis

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/redis/go-redis/v9"
	"github.com/yourorg/paper-trader/internal/domain"
)

type PriceRepo struct {
	client *redis.Client
}

func NewPriceRepo(client *redis.Client) *PriceRepo {
	return &PriceRepo{client: client}
}

func (r *PriceRepo) Publish(ctx context.Context, tick domain.PriceTick) error {
	data, err := json.Marshal(tick)
	if err != nil {
		return err
	}
	pipe := r.client.Pipeline()
	pipe.Publish(ctx, "prices."+tick.Symbol, data)
	pipe.Set(ctx, "last_price:"+tick.Symbol, data, 60*time.Second)
	_, err = pipe.Exec(ctx)
	return err
}

func (r *PriceRepo) GetLastPrice(ctx context.Context, symbol string) (*domain.PriceTick, error) {
	val, err := r.client.Get(ctx, "last_price:"+symbol).Result()
	if err != nil {
		if errors.Is(err, redis.Nil) {
			return nil, nil
		}
		return nil, fmt.Errorf("redis get last price: %w", err)
	}
	var tick domain.PriceTick
	if err := json.Unmarshal([]byte(val), &tick); err != nil {
		return nil, err
	}
	return &tick, nil
}

func (r *PriceRepo) Subscribe(ctx context.Context, symbol string) *redis.PubSub {
	return r.client.Subscribe(ctx, "prices."+symbol)
}
