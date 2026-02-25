package gateway

import (
	"context"
	"encoding/json"
	"log/slog"

	redisRepo "github.com/yourorg/paper-trader/internal/repository/redis"
)

type subscription struct {
	client *Client
	symbol string
}

type Hub struct {
	clients      map[*Client]bool
	subs         map[string]map[*Client]bool
	redisCancels map[string]context.CancelFunc

	register    chan *Client
	unregister  chan *Client
	subscribe   chan subscription
	unsubscribe chan subscription

	priceRepo *redisRepo.PriceRepo
	logger    *slog.Logger
}

func NewHub(priceRepo *redisRepo.PriceRepo, logger *slog.Logger) *Hub {
	return &Hub{
		clients:      make(map[*Client]bool),
		subs:         make(map[string]map[*Client]bool),
		redisCancels: make(map[string]context.CancelFunc),
		register:     make(chan *Client, 64),
		unregister:   make(chan *Client, 64),
		subscribe:    make(chan subscription, 64),
		unsubscribe:  make(chan subscription, 64),
		priceRepo:    priceRepo,
		logger:       logger,
	}
}

func (h *Hub) Run(ctx context.Context) {
	for {
		select {
		case <-ctx.Done():
			return
		case client := <-h.register:
			h.clients[client] = true
		case client := <-h.unregister:
			if _, ok := h.clients[client]; ok {
				delete(h.clients, client)
				for sym, clients := range h.subs {
					if _, ok := clients[client]; ok {
						delete(clients, client)
						if len(clients) == 0 {
							if cancel, ok := h.redisCancels[sym]; ok {
								cancel()
								delete(h.redisCancels, sym)
							}
							delete(h.subs, sym)
						}
					}
				}
				close(client.send)
			}
		case sub := <-h.subscribe:
			if _, ok := h.subs[sub.symbol]; !ok {
				h.subs[sub.symbol] = make(map[*Client]bool)
				subCtx, cancel := context.WithCancel(ctx)
				h.redisCancels[sub.symbol] = cancel
				go h.pumpRedis(subCtx, sub.symbol)
			}
			h.subs[sub.symbol][sub.client] = true
		case sub := <-h.unsubscribe:
			if clients, ok := h.subs[sub.symbol]; ok {
				delete(clients, sub.client)
				if len(clients) == 0 {
					if cancel, ok := h.redisCancels[sub.symbol]; ok {
						cancel()
						delete(h.redisCancels, sub.symbol)
					}
					delete(h.subs, sub.symbol)
				}
			}
		}
	}
}

func (h *Hub) pumpRedis(ctx context.Context, symbol string) {
	pubsub := h.priceRepo.Subscribe(ctx, symbol)
	defer pubsub.Close()

	ch := pubsub.Channel()
	for {
		select {
		case <-ctx.Done():
			return
		case msg, ok := <-ch:
			if !ok {
				return
			}
			data, err := json.Marshal(json.RawMessage(msg.Payload))
			if err != nil {
				continue
			}
			h.fanOut(symbol, data)
		}
	}
}

func (h *Hub) fanOut(symbol string, data []byte) {
	clients, ok := h.subs[symbol]
	if !ok {
		return
	}
	for client := range clients {
		select {
		case client.send <- data:
		default:
		}
	}
}
