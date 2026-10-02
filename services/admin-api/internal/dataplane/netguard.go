package dataplane

import (
	"context"
	"errors"
	"fmt"
	"net"
	"net/http"
	"os"
	"syscall"
	"time"
)

// A company types in a hostname and admin-api connects to it. Left unguarded
// that is a server-side request forgery primitive: "host: 169.254.169.254"
// reads cloud instance metadata, "host: postgres, port: 6432" probes
// Aavishield's own database, "redis:6379" its cache. Every connection this
// package makes — SQL, MongoDB, object storage — therefore goes through a
// dialer that refuses non-public addresses.
//
// The check runs in the dialer's Control hook, on the address actually being
// connected to after DNS resolution, so a hostname that resolves to a public
// IP at validation time and a private one at connect time (DNS rebinding)
// is still refused.
//
// DATA_RESIDENCY_ALLOW_PRIVATE_NETWORKS=true lifts the restriction, for local
// development and for self-hosted deployments of Aavishield that legitimately
// reach a company's database over a private link.

func allowPrivateNetworks() bool {
	return os.Getenv("DATA_RESIDENCY_ALLOW_PRIVATE_NETWORKS") == "true"
}

var blockedNets = func() []*net.IPNet {
	var out []*net.IPNet
	for _, cidr := range []string{
		"0.0.0.0/8",      // "this" network
		"10.0.0.0/8",     // private
		"100.64.0.0/10",  // carrier-grade NAT
		"127.0.0.0/8",    // loopback
		"169.254.0.0/16", // link-local — cloud metadata endpoints live here
		"172.16.0.0/12",  // private — Docker's default bridge networks
		"192.0.0.0/24",   // IETF protocol assignments
		"192.168.0.0/16", // private
		"198.18.0.0/15",  // benchmarking
		"224.0.0.0/4",    // multicast
		"240.0.0.0/4",    // reserved
		"::/128",         // unspecified
		"::1/128",        // loopback
		"fc00::/7",       // unique local
		"fe80::/10",      // link-local
		"ff00::/8",       // multicast
		"64:ff9b::/96",   // NAT64 — can embed any of the IPv4 ranges above
	} {
		_, n, _ := net.ParseCIDR(cidr)
		out = append(out, n)
	}
	return out
}()

// publicIP reports whether ip is safe to connect to.
func publicIP(ip net.IP) bool {
	if v4 := ip.To4(); v4 != nil {
		ip = v4
	}
	for _, n := range blockedNets {
		if n.Contains(ip) {
			return false
		}
	}
	return true
}

// ErrPrivateAddress is returned when a company's host resolves to an address
// Aavishield refuses to connect to.
type ErrPrivateAddress struct{ Addr string }

func (e ErrPrivateAddress) Error() string {
	return fmt.Sprintf("%s is a private or internal address — Aavishield can only reach servers on the public internet. Expose the server on a public address (restricted to Aavishield's IPs) or use a tunnel", e.Addr)
}

func guardControl(_, address string, _ syscall.RawConn) error {
	if allowPrivateNetworks() {
		return nil
	}
	host, _, err := net.SplitHostPort(address)
	if err != nil {
		host = address
	}
	ip := net.ParseIP(host)
	if ip == nil || !publicIP(ip) {
		return ErrPrivateAddress{Addr: host}
	}
	return nil
}

// guardedDialer is the net.Dialer every outbound connection to a company's
// infrastructure uses.
func guardedDialer() *net.Dialer {
	return &net.Dialer{
		Timeout:   10 * time.Second,
		KeepAlive: 30 * time.Second,
		Control:   guardControl,
	}
}

// guardedDialContext matches the signature most drivers accept.
func guardedDialContext(ctx context.Context, network, addr string) (net.Conn, error) {
	return guardedDialer().DialContext(ctx, network, addr)
}

// guardedHTTPClient is for object storage. Redirects are refused: an S3
// endpoint has no reason to send us elsewhere, and following one would be a
// way around the address check for anything that isn't a fresh dial.
func guardedHTTPClient() *http.Client {
	transport := &http.Transport{
		Proxy:                 nil,
		DialContext:           guardedDialContext,
		ForceAttemptHTTP2:     true,
		MaxIdleConns:          20,
		MaxIdleConnsPerHost:   10,
		IdleConnTimeout:       90 * time.Second,
		TLSHandshakeTimeout:   10 * time.Second,
		ResponseHeaderTimeout: 30 * time.Second,
	}
	return &http.Client{
		Timeout:   60 * time.Second,
		Transport: transport,
		CheckRedirect: func(*http.Request, []*http.Request) error {
			return http.ErrUseLastResponse
		},
	}
}

// checkHostResolvable gives the settings form an early, readable answer
// before any driver is involved: does the host resolve, and is it public?
func checkHostResolvable(ctx context.Context, host string) error {
	if allowPrivateNetworks() {
		return nil
	}
	if ip := net.ParseIP(host); ip != nil {
		if !publicIP(ip) {
			return ErrPrivateAddress{Addr: host}
		}
		return nil
	}
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	addrs, err := net.DefaultResolver.LookupIPAddr(ctx, host)
	if err != nil {
		return fmt.Errorf("could not resolve %s: check the hostname", host)
	}
	for _, a := range addrs {
		if !publicIP(a.IP) {
			return ErrPrivateAddress{Addr: host + " (" + a.IP.String() + ")"}
		}
	}
	return nil
}

func asPrivate(err error, target *ErrPrivateAddress) bool { return errors.As(err, target) }
