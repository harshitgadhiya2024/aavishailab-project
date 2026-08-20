// Package store holds the in-memory threat-intel reputation sets (domains,
// IPs, file hashes), refreshed from feeds. Thread-safe; a lookup is O(1).
// Kept in memory (not a DB) so the service stays stateless-per-replica and
// horizontally scalable — each replica syncs the same public feeds.
package store

import (
	"strings"
	"sync"
)

// Entry describes why an indicator is flagged.
type Entry struct {
	Source   string // urlhaus, openphish, feodotracker, malwarebazaar
	Category string // malware, phishing, botnet
}

type Store struct {
	mu      sync.RWMutex
	domains map[string]Entry
	ips     map[string]Entry
	hashes  map[string]Entry
}

func New() *Store {
	return &Store{
		domains: map[string]Entry{},
		ips:     map[string]Entry{},
		hashes:  map[string]Entry{},
	}
}

func normDomain(d string) string {
	d = strings.ToLower(strings.TrimSpace(strings.TrimSuffix(d, ".")))
	return strings.TrimPrefix(d, "www.")
}

// ReplaceDomains atomically swaps the domain set for one source (so a failed
// mid-sync fetch never leaves a half-populated set).
func (s *Store) SetDomain(d string, e Entry) {
	s.mu.Lock()
	s.domains[normDomain(d)] = e
	s.mu.Unlock()
}

func (s *Store) SetIP(ip string, e Entry) {
	s.mu.Lock()
	s.ips[strings.TrimSpace(ip)] = e
	s.mu.Unlock()
}

func (s *Store) SetHash(h string, e Entry) {
	s.mu.Lock()
	s.hashes[strings.ToLower(strings.TrimSpace(h))] = e
	s.mu.Unlock()
}

func (s *Store) LookupDomain(d string) (Entry, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	e, ok := s.domains[normDomain(d)]
	return e, ok
}

func (s *Store) LookupIP(ip string) (Entry, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	e, ok := s.ips[strings.TrimSpace(ip)]
	return e, ok
}

func (s *Store) LookupHash(h string) (Entry, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	e, ok := s.hashes[strings.ToLower(strings.TrimSpace(h))]
	return e, ok
}

type Counts struct {
	Domains int `json:"domains"`
	IPs     int `json:"ips"`
	Hashes  int `json:"hashes"`
}

func (s *Store) Counts() Counts {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return Counts{Domains: len(s.domains), IPs: len(s.ips), Hashes: len(s.hashes)}
}
