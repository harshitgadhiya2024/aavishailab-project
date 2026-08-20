package handlers

import (
	_ "embed"

	"github.com/gin-gonic/gin"
)

//go:embed assets/aavishield-agent.py
var embeddedAgentScript []byte

// ServeAgentScript handles GET /agent/aavishield-agent.py
func ServeAgentScript(c *gin.Context) {
	c.Header("Content-Type", "text/x-python; charset=utf-8")
	c.Header("Content-Disposition", `inline; filename="aavishield-agent.py"`)
	c.Data(200, "text/x-python; charset=utf-8", embeddedAgentScript)
}
