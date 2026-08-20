package handlers

import (
	"encoding/json"
	"log"
	"net/http"
	"sync"

	"github.com/aavishield/admin-api/internal/auth"
	"github.com/aavishield/admin-api/internal/middleware"
	"github.com/aavishield/admin-api/internal/models"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/gorilla/websocket"
)

var upgrader = websocket.Upgrader{
	// Same allowlist as the HTTP CORS policy (middleware.AllowedOrigins) —
	// this used to accept any Origin unconditionally, which let any
	// arbitrary website open a WebSocket to this API and ride the visitor's
	// browser session/cookies to read their org's live activity feed.
	CheckOrigin: func(r *http.Request) bool {
		return middleware.OriginAllowed(r.Header.Get("Origin"))
	},
	ReadBufferSize:  1024,
	WriteBufferSize: 1024,
}

type WSMessage struct {
	Type    string `json:"type"`
	Payload any    `json:"payload"`
}

type WSClient struct {
	conn  *websocket.Conn
	orgID string
	// employeeID is non-nil only for Employee Portal connections. Those
	// clients must only ever receive activity events for their OWN employee
	// record — company-dashboard/superadmin connections (employeeID nil)
	// see every event in the org, same as before.
	employeeID *uuid.UUID
	send       chan []byte
}

// WebSocketHub manages all WebSocket connections per org
type WebSocketHub struct {
	mu      sync.RWMutex
	clients map[string]map[*WSClient]bool // orgID → clients
}

func NewWebSocketHub() *WebSocketHub {
	return &WebSocketHub{
		clients: make(map[string]map[*WSClient]bool),
	}
}

func (h *WebSocketHub) Register(client *WSClient) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.clients[client.orgID] == nil {
		h.clients[client.orgID] = make(map[*WSClient]bool)
	}
	h.clients[client.orgID][client] = true
}

func (h *WebSocketHub) Unregister(client *WSClient) {
	h.mu.Lock()
	defer h.mu.Unlock()
	clients, ok := h.clients[client.orgID]
	if !ok {
		return
	}
	if _, present := clients[client]; !present {
		// Already unregistered by another goroutine (reader/writer both
		// defer-call Unregister on disconnect) — don't double-close send.
		return
	}
	delete(clients, client)
	if len(clients) == 0 {
		delete(h.clients, client.orgID)
	}
	close(client.send)
}

func (h *WebSocketHub) BroadcastToOrg(orgID string, msgType string, payload any) {
	msg := WSMessage{Type: msgType, Payload: payload}
	data, _ := json.Marshal(msg)

	h.mu.RLock()
	clients := h.clients[orgID]
	h.mu.RUnlock()

	for client := range clients {
		select {
		case client.send <- data:
		default:
			// Client buffer full — unregister
			h.Unregister(client)
		}
	}
}

// BroadcastActivityEvent delivers an activity_event to org clients, but scopes
// it down for Employee Portal connections: those only ever see their own
// employee's events. Company-dashboard/superadmin connections (no employeeID)
// keep seeing every event in the org.
func (h *WebSocketHub) BroadcastActivityEvent(event models.ActivityEvent) {
	msg := WSMessage{Type: "activity_event", Payload: event}
	data, _ := json.Marshal(msg)

	h.mu.RLock()
	clients := h.clients[event.OrgID.String()]
	h.mu.RUnlock()

	for client := range clients {
		if client.employeeID != nil {
			if event.EmployeeID == nil || *client.employeeID != *event.EmployeeID {
				continue
			}
		}
		select {
		case client.send <- data:
		default:
			h.Unregister(client)
		}
	}
}

// Serve handles WS connection upgrades GET /ws
func (h *WebSocketHub) Serve(c *gin.Context) {
	// Authenticate via token query param (WS can't set headers easily)
	token := c.Query("token")
	if token == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "token required"})
		return
	}

	claims, err := auth.ParseAccessToken(token)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid token"})
		return
	}

	orgID := ""
	if claims.OrgID != nil {
		orgID = claims.OrgID.String()
	} else {
		orgID = "superadmin"
	}

	conn, err := upgrader.Upgrade(c.Writer, c.Request, nil)
	if err != nil {
		log.Printf("WebSocket upgrade error: %v", err)
		return
	}

	client := &WSClient{
		conn:       conn,
		orgID:      orgID,
		employeeID: claims.EmployeeID,
		send:       make(chan []byte, 256),
	}

	h.Register(client)

	// Send connected message
	client.send <- mustMarshal(WSMessage{
		Type:    "connected",
		Payload: map[string]string{"org_id": orgID, "status": "connected"},
	})

	// Writer goroutine
	go func() {
		defer func() {
			conn.Close()
			h.Unregister(client)
		}()
		for msg := range client.send {
			if err := conn.WriteMessage(websocket.TextMessage, msg); err != nil {
				return
			}
		}
	}()

	// Reader goroutine (ping/pong keepalive)
	go func() {
		defer func() {
			conn.Close()
			h.Unregister(client)
		}()
		conn.SetPongHandler(func(string) error { return nil })
		for {
			_, _, err := conn.ReadMessage()
			if err != nil {
				return
			}
		}
	}()
}

func mustMarshal(v any) []byte {
	b, _ := json.Marshal(v)
	return b
}
