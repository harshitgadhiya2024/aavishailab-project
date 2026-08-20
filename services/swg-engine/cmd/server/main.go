package main

import (
	"log"
	"os"

	"github.com/aavishield/swg-engine/internal/dns"
	"github.com/aavishield/swg-engine/internal/policy"
	"github.com/aavishield/swg-engine/internal/proxy"
	"github.com/gin-gonic/gin"
	"github.com/joho/godotenv"
)

func main() {
	if os.Getenv("APP_ENV") != "production" {
		_ = godotenv.Load("../../.env")
		_ = godotenv.Load(".env")
	}

	adminAPIURL := os.Getenv("ADMIN_API_URL")
	if adminAPIURL == "" {
		adminAPIURL = "http://localhost:6000"
	}

	// Policy cache — refreshes from admin API
	policyCache := policy.NewCache(adminAPIURL)
	if err := policyCache.Refresh(); err != nil {
		log.Printf("Warning: Could not load initial policies: %v", err)
	}
	go policyCache.StartAutoRefresh(30) // refresh every 30 seconds

	// DNS filter server
	dnsPort := os.Getenv("SWG_DNS_PORT")
	if dnsPort == "" {
		dnsPort = "6053"
	}
	dnsServer := dns.NewServer(policyCache, dnsPort)
	go func() {
		log.Printf("🔵 DNS filter server listening on :%s/udp", dnsPort)
		if err := dnsServer.Start(); err != nil {
			log.Printf("DNS server error: %v", err)
		}
	}()

	// HTTP proxy
	proxyPort := os.Getenv("SWG_PROXY_PORT")
	if proxyPort == "" {
		proxyPort = "6080"
	}
	httpProxy := proxy.NewHTTPProxy(policyCache, adminAPIURL)
	go func() {
		log.Printf("🔵 HTTP proxy server listening on :%s", proxyPort)
		if err := httpProxy.Start(proxyPort); err != nil {
			log.Printf("Proxy error: %v", err)
		}
	}()

	// Management API
	port := os.Getenv("SWG_ENGINE_PORT")
	if port == "" {
		port = "6001"
	}

	r := gin.New()
	r.Use(gin.Logger(), gin.Recovery())

	r.GET("/health", func(c *gin.Context) {
		c.JSON(200, gin.H{"status": "healthy", "service": "swg-engine"})
	})

	r.POST("/reload", func(c *gin.Context) {
		if err := policyCache.Refresh(); err != nil {
			c.JSON(500, gin.H{"error": err.Error()})
			return
		}
		c.JSON(200, gin.H{"message": "Policies reloaded"})
	})

	r.GET("/stats", func(c *gin.Context) {
		c.JSON(200, policyCache.Stats())
	})

	log.Printf("🚀 SWG Engine management API on :%s", port)
	if err := r.Run(":" + port); err != nil {
		log.Fatalf("Failed to start SWG engine: %v", err)
	}
}
