// Package geoip resolves an IP address to a country. It handles private/
// reserved ranges natively, and — when a country CSV is provided (a free
// db-ip.com / ip2location LITE export) — resolves public IPv4 addresses via a
// sorted range table + binary search. Pure stdlib.
package geoip

import (
	"bufio"
	"encoding/binary"
	"net"
	"os"
	"sort"
	"strings"
)

type Result struct {
	IP          string `json:"ip"`
	IsPrivate   bool   `json:"is_private"`
	CountryCode string `json:"country_code"`
	Country     string `json:"country"`
}

type ipRange struct {
	start, end uint32
	code, name string
}

type Resolver struct {
	ranges []ipRange // sorted by start
}

// New loads a range CSV if csvPath is set. Lines: startIP,endIP,code,name.
// A missing/unreadable file yields a resolver that still handles private
// ranges (public IPs -> unknown), rather than failing to start.
func New(csvPath string) *Resolver {
	r := &Resolver{}
	if csvPath == "" {
		return r
	}
	f, err := os.Open(csvPath)
	if err != nil {
		return r
	}
	defer f.Close()

	sc := bufio.NewScanner(f)
	sc.Buffer(make([]byte, 0, 64*1024), 1024*1024)
	for sc.Scan() {
		line := strings.TrimSpace(sc.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		parts := splitCSV(line)
		if len(parts) < 3 {
			continue
		}
		start, ok1 := ipv4ToUint(parts[0])
		end, ok2 := ipv4ToUint(parts[1])
		if !ok1 || !ok2 || end < start {
			continue
		}
		name := ""
		if len(parts) >= 4 {
			name = parts[3]
		}
		r.ranges = append(r.ranges, ipRange{start, end, parts[2], name})
	}
	sort.Slice(r.ranges, func(i, j int) bool { return r.ranges[i].start < r.ranges[j].start })
	return r
}

func (r *Resolver) Count() int { return len(r.ranges) }

func (r *Resolver) Lookup(ipStr string) Result {
	res := Result{IP: ipStr}
	ip := net.ParseIP(strings.TrimSpace(ipStr))
	if ip == nil {
		return res
	}
	if ip.IsLoopback() || ip.IsPrivate() || ip.IsLinkLocalUnicast() || isCGNAT(ip) {
		res.IsPrivate = true
		return res
	}
	v4 := ip.To4()
	if v4 == nil {
		return res // IPv6 public not covered by the v4 CSV
	}
	n := binary.BigEndian.Uint32(v4)

	// Binary search for the last range whose start <= n, then verify end >= n.
	i := sort.Search(len(r.ranges), func(i int) bool { return r.ranges[i].start > n })
	if i > 0 {
		rg := r.ranges[i-1]
		if n >= rg.start && n <= rg.end {
			res.CountryCode = rg.code
			res.Country = rg.name
		}
	}
	return res
}

// 100.64.0.0/10 — carrier-grade NAT, effectively private for our purposes.
func isCGNAT(ip net.IP) bool {
	v4 := ip.To4()
	if v4 == nil {
		return false
	}
	return v4[0] == 100 && v4[1] >= 64 && v4[1] <= 127
}

func ipv4ToUint(s string) (uint32, bool) {
	ip := net.ParseIP(strings.TrimSpace(s))
	if ip == nil {
		return 0, false
	}
	v4 := ip.To4()
	if v4 == nil {
		return 0, false
	}
	return binary.BigEndian.Uint32(v4), true
}

func splitCSV(line string) []string {
	parts := strings.Split(line, ",")
	for i := range parts {
		parts[i] = strings.Trim(strings.TrimSpace(parts[i]), `"`)
	}
	return parts
}
