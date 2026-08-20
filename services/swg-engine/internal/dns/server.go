package dns

import (
	"fmt"
	"log"
	"net"
	"strings"

	"github.com/aavishield/swg-engine/internal/policy"
)

// Simple DNS filter server (UDP) that intercepts queries and blocks known bad domains
// In production: use CoreDNS with a custom plugin instead

type Server struct {
	cache *policy.PolicyCache
	port  string
}

func NewServer(cache *policy.PolicyCache, port string) *Server {
	return &Server{cache: cache, port: port}
}

func (s *Server) Start() error {
	addr := ":" + s.port
	conn, err := net.ListenPacket("udp", addr)
	if err != nil {
		return fmt.Errorf("DNS listen error: %w", err)
	}
	defer conn.Close()

	log.Printf("DNS filter server listening on %s/udp", addr)
	buf := make([]byte, 1500)

	for {
		n, src, err := conn.ReadFrom(buf)
		if err != nil {
			continue
		}
		go s.handleQuery(conn, src, buf[:n])
	}
}

func (s *Server) handleQuery(conn net.PacketConn, src net.Addr, msg []byte) {
	if len(msg) < 12 {
		return
	}

	// Parse domain from DNS wire format (simplified)
	domain := parseDNSDomain(msg[12:])
	if domain == "" {
		// Forward upstream
		s.forwardUpstream(conn, src, msg)
		return
	}

	domain = strings.ToLower(strings.TrimSuffix(domain, "."))

	// Check policy (no org context at DNS level — check global rules)
	rule := s.cache.CheckDomain(domain, "")
	if rule != nil && rule.Action == "block" {
		log.Printf("DNS BLOCK: %s (reason: %s)", domain, rule.Reason)
		// Send NXDOMAIN response
		resp := buildNXDomainResponse(msg)
		_, _ = conn.WriteTo(resp, src)
		return
	}

	// Forward to upstream DNS
	s.forwardUpstream(conn, src, msg)
}

func (s *Server) forwardUpstream(conn net.PacketConn, src net.Addr, msg []byte) {
	upstream := "8.8.8.8:53"
	upConn, err := net.Dial("udp", upstream)
	if err != nil {
		return
	}
	defer upConn.Close()

	_, _ = upConn.Write(msg)
	resp := make([]byte, 4096)
	n, err := upConn.Read(resp)
	if err != nil {
		return
	}

	_, _ = conn.WriteTo(resp[:n], src)
}

// parseDNSDomain extracts the queried domain from a DNS question section
func parseDNSDomain(data []byte) string {
	var labels []string
	i := 0
	for i < len(data) {
		length := int(data[i])
		if length == 0 {
			break
		}
		if i+1+length > len(data) {
			return ""
		}
		labels = append(labels, string(data[i+1:i+1+length]))
		i += 1 + length
	}
	return strings.Join(labels, ".")
}

// buildNXDomainResponse builds a minimal NXDOMAIN DNS response
func buildNXDomainResponse(query []byte) []byte {
	if len(query) < 2 {
		return nil
	}
	resp := make([]byte, len(query))
	copy(resp, query)
	// Set QR=1 (response), AA=1, RCODE=3 (NXDOMAIN)
	resp[2] = 0x81 // QR=1, Opcode=0, AA=1, TC=0, RD=1
	resp[3] = 0x83 // RA=1, RCODE=3 (NXDOMAIN)
	// Zero out answer count
	resp[6] = 0
	resp[7] = 0
	return resp
}
