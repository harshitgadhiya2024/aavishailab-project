.PHONY: help up down restart rebuild logs ps build test test-api lint migrate migrate-down seed clean health shell api-logs db-shell redis-cli \
        dev-infra dev-api dev-swg dev-ai dev-superadmin dev-company dev-employee

SHELL := /bin/bash
COMPOSE := docker compose

# ─── Help ─────────────────────────────────────────────────────────────────────
help:
	@echo ""
	@printf "\033[38;5;208m\033[1m  AAVISHIELD\033[0m\n"
	@printf "\033[38;5;208m  ──────────\033[0m\n"
	@echo ""
	@echo "  Zero Trust Security Platform — Dev Commands"
	@echo "  ============================================="
	@echo ""
	@echo "  Infrastructure:"
	@echo "    make up              Start all services (waits for healthy)"
	@echo "    make down            Stop all services"
	@echo "    make restart         Restart all (or: make restart s=admin-api)"
	@echo "    make rebuild         Rebuild images + recreate (or: make rebuild s=admin-api)"
	@echo "    make health          Show health of every container"
	@echo "    make logs            Tail all logs (or: make logs s=admin-api)"
	@echo "    make ps              Show running containers"
	@echo "    make build           Build all images"
	@echo "    make clean           Remove containers + volumes"
	@echo ""
	@echo "  Development:"
	@echo "    make dev-infra       Start only infrastructure (postgres, redis)"
	@echo "    make dev-api         Run admin-api locally (hot-reload)"
	@echo "    make dev-superadmin  Run superadmin frontend locally"
	@echo "    make dev-company     Run company dashboard locally"
	@echo "    make dev-employee    Run employee portal locally"
	@echo ""
	@echo "  Database:"
	@echo "    make migrate         Run all migrations"
	@echo "    make migrate-down    Rollback last migration"
	@echo "    make seed            Seed development data"
	@echo ""
	@echo "  Testing & Quality:"
	@echo "    make test            Run all tests"
	@echo "    make test-api        Run admin-api tests only"
	@echo "    make lint            Run all linters"
	@echo ""

# ─── Infrastructure ────────────────────────────────────────────────────────────
# --wait blocks until every container's healthcheck passes, so a successful
# `make up` means the stack is actually serving — not just that it started.
# The timeout is generous because a first boot has ClamAV pulling signature DBs.
WAIT := --wait --wait-timeout 600

up:
	@cp -n .env.example .env 2>/dev/null && echo "✅ Created .env from .env.example" || true
	$(COMPOSE) up -d $(WAIT)
	@$(MAKE) --no-print-directory urls

down:
	$(COMPOSE) down

restart:
	$(COMPOSE) restart $(s)

# Rebuild images and recreate containers, waiting for health.
# Whole stack:      make rebuild
# Single service:   make rebuild s=admin-api
rebuild:
	@cp -n .env.example .env 2>/dev/null || true
	@cp scripts/agent/aavishield-agent.py services/admin-api/internal/handlers/assets/aavishield-agent.py
	$(COMPOSE) build $(s)
	$(COMPOSE) up -d $(WAIT) $(s)
	@$(MAKE) --no-print-directory urls

# Published host ports (left side of each compose `ports:` mapping).
urls:
	@echo ""
	@echo "✅ Aavishield is running:"
	@echo "   🔵 Superadmin:         http://localhost:5001"
	@echo "   🔵 Company Dashboard:  http://localhost:5002"
	@echo "   🔵 Employee Portal:    http://localhost:5003"
	@echo "   🔵 Admin API:          http://localhost:7100"
	@echo "   🔵 SWG Engine:         http://localhost:7001"
	@echo "   🔵 AI Service:         http://localhost:7002"
	@echo "   🟢 Grafana:            http://localhost:7300  (admin/admin)"
	@echo "   🟢 Prometheus:         http://localhost:7090"
	@echo "   🟢 PostgreSQL:         localhost:7432"
	@echo "   🟢 Redis:              localhost:7379"
	@echo ""

logs:
	$(COMPOSE) logs -f --tail=100 $(s)

ps:
	$(COMPOSE) ps

build:
	@cp scripts/agent/aavishield-agent.py services/admin-api/internal/handlers/assets/aavishield-agent.py
	$(COMPOSE) build --parallel

clean:
	$(COMPOSE) down -v --remove-orphans
	@echo "✅ All containers and volumes removed"

# ─── Dev (local hot-reload) ────────────────────────────────────────────────────
dev-infra:
	$(COMPOSE) up -d postgres redis
	@echo "✅ Infrastructure running (postgres + redis)"

dev-api:
	@cp -n .env.example .env 2>/dev/null || true
	cd services/admin-api && \
		export $$(cat ../../.env | grep -v '^#' | xargs) && \
		go run ./cmd/server/main.go

dev-ai:
	cd services/ai-service && \
		pip install -r requirements.txt -q && \
		uvicorn app.main:app --reload --port 6002

dev-superadmin:
	cd frontend/superadmin && \
		cp -n ../../.env .env.local 2>/dev/null || true && \
		pnpm dev --port 1001

dev-company:
	cd frontend/company-dashboard && \
		cp -n ../../.env .env.local 2>/dev/null || true && \
		pnpm dev --port 1002

dev-employee:
	cd frontend/employee-portal && \
		cp -n ../../.env .env.local 2>/dev/null || true && \
		pnpm dev --port 1003

# ─── Database ───────────────────────────────────────────────────────────────────
migrate:
	$(COMPOSE) exec admin-api ./admin-api migrate up

migrate-down:
	$(COMPOSE) exec admin-api ./admin-api migrate down 1

seed:
	$(COMPOSE) exec admin-api ./admin-api seed

db-shell:
	$(COMPOSE) exec postgres psql -U aavishield -p 6432 aavishield

redis-cli:
	$(COMPOSE) exec redis redis-cli -a $$(grep REDIS_PASSWORD .env | cut -d= -f2)

# ─── Testing ────────────────────────────────────────────────────────────────────
# Go tests run on the host toolchain: the service images are alpine/distroless
# runtime layers holding only the compiled binary, so `compose run … go test`
# has no compiler to invoke.
GO_SERVICES := services/admin-api services/posture-service \
               services/shadowit-service services/threatintel-service

test:
	@for d in $(GO_SERVICES); do \
		echo "→ $$d"; (cd $$d && go test ./... -count=1) || exit 1; \
	done
	@echo "✅ Go tests passed"

test-api:
	cd services/admin-api && go test ./... -v -race -count=1

lint:
	@echo "Linting Go services..."
	@for d in $(GO_SERVICES); do \
		echo "→ $$d"; (cd $$d && go vet ./...) || true; \
	done
	@echo "Linting frontends..."
	cd frontend/superadmin && pnpm lint || true
	cd frontend/company-dashboard && pnpm lint || true
	cd frontend/employee-portal && pnpm lint || true

# ─── Utilities ──────────────────────────────────────────────────────────────────
shell:
	$(COMPOSE) exec $(s) sh

api-logs:
	$(COMPOSE) logs -f admin-api

# Reads Docker's own healthcheck state — every service defines one, so this
# covers the full stack rather than the three HTTP endpoints it used to poll.
health:
	@$(COMPOSE) ps --format "table {{.Name}}\t{{.Status}}"
	@echo ""
	@bad=$$($(COMPOSE) ps --format '{{.Name}} {{.Health}}' | grep -v ' healthy$$' || true); \
	if [ -n "$$bad" ]; then echo "❌ not healthy:"; echo "$$bad"; exit 1; \
	else echo "✅ all services healthy"; fi
