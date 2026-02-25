package ingestion

import (
	"context"
	"encoding/json"
	"log/slog"
	"time"

	"github.com/gorilla/websocket"
	"github.com/yourorg/paper-trader/internal/domain"
	redisrepo "github.com/yourorg/paper-trader/internal/repository/redis"
)

const alpacaWSURL = "wss://stream.data.alpaca.markets/v2/iex"

var defaultSymbols = []string{"AAPL", "TSLA", "MSFT", "NVDA", "SPY"}

type AlpacaClient struct {
	apiKey    string
	apiSecret string
	priceRepo *redisrepo.PriceRepo
	logger    *slog.Logger
}

func NewAlpacaClient(key, secret string, repo *redisrepo.PriceRepo, logger *slog.Logger) *AlpacaClient {
	return &AlpacaClient{
		apiKey:    key,
		apiSecret: secret,
		priceRepo: repo,
		logger:    logger,
	}
}

func (c *AlpacaClient) Run(ctx context.Context) {
	backoff := time.Second
	maxBackoff := 60 * time.Second
	for {
		select {
		case <-ctx.Done():
			return
		default:
		}
		err := c.connect(ctx)
		if err == nil {
			backoff = time.Second
			continue
		}
		c.logger.Error("alpaca ws disconnected", "err", err, "retrying_in", backoff)
		select {
		case <-ctx.Done():
			return
		case <-time.After(backoff):
		}
		backoff *= 2
		if backoff > maxBackoff {
			backoff = maxBackoff
		}
	}
}

type alpacaMsg struct {
	T  string  `json:"T"`
	S  string  `json:"S"`
	P  float64 `json:"p"`
	Sz float64 `json:"s"`
	Ts string  `json:"t"`
}

func (c *AlpacaClient) connect(ctx context.Context) error {
	conn, _, err := websocket.DefaultDialer.DialContext(ctx, alpacaWSURL, nil)
	if err != nil {
		return err
	}
	defer func() {
		conn.WriteMessage(websocket.CloseMessage,
			websocket.FormatCloseMessage(websocket.CloseNormalClosure, ""))
		conn.Close()
	}()

	if _, _, err := conn.ReadMessage(); err != nil {
		return err
	}

	authMsg, _ := json.Marshal(map[string]string{
		"action": "auth",
		"key":    c.apiKey,
		"secret": c.apiSecret,
	})
	if err := conn.WriteMessage(websocket.TextMessage, authMsg); err != nil {
		return err
	}

	_, authResp, err := conn.ReadMessage()
	if err != nil {
		return err
	}
	var authMsgs []alpacaMsg
	if err := json.Unmarshal(authResp, &authMsgs); err != nil {
		return err
	}
	if len(authMsgs) == 0 || authMsgs[0].T != "success" {
		c.logger.Warn("alpaca auth failed", "response", string(authResp))
		return nil
	}

	subMsg, _ := json.Marshal(map[string]interface{}{
		"action": "subscribe",
		"trades": defaultSymbols,
	})
	if err := conn.WriteMessage(websocket.TextMessage, subMsg); err != nil {
		return err
	}

	if _, _, err := conn.ReadMessage(); err != nil {
		return err
	}

	c.logger.Info("alpaca ws connected and subscribed")

	for {
		select {
		case <-ctx.Done():
			return nil
		default:
		}
		conn.SetReadDeadline(time.Now().Add(90 * time.Second))
		_, data, err := conn.ReadMessage()
		if err != nil {
			return err
		}
		var msgs []json.RawMessage
		if err := json.Unmarshal(data, &msgs); err != nil {
			continue
		}
		for _, raw := range msgs {
			var msg alpacaMsg
			if err := json.Unmarshal(raw, &msg); err != nil {
				continue
			}
			if msg.T != "t" {
				continue
			}
			ts, err := time.Parse(time.RFC3339Nano, msg.Ts)
			if err != nil {
				ts = time.Now()
			}
			tick := domain.PriceTick{
				Symbol:    msg.S,
				Price:     msg.P,
				Size:      msg.Sz,
				Timestamp: ts,
			}
			if err := c.priceRepo.Publish(ctx, tick); err != nil {
				c.logger.Error("failed to publish price tick", "err", err)
			}
		}
	}
}
