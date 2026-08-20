-- Aavishield PostgreSQL Schema
-- Auto-run on first container start

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ─── Enums ───────────────────────────────────────────────────────────────────

CREATE TYPE user_role AS ENUM ('superadmin', 'org_admin', 'analyst', 'read_only');
CREATE TYPE user_status AS ENUM ('active', 'inactive', 'suspended', 'pending');
CREATE TYPE policy_action AS ENUM ('block', 'allow', 'alert', 'log');
CREATE TYPE policy_type AS ENUM ('url_category', 'domain', 'application', 'usb', 'dlp', 'time_based', 'process');
CREATE TYPE event_action AS ENUM ('blocked', 'allowed', 'alerted', 'logged');
CREATE TYPE event_type AS ENUM ('web_request', 'dns_query', 'app_launch', 'usb_insert', 'file_op', 'process_start', 'login', 'logout', 'policy_violation');
CREATE TYPE org_status AS ENUM ('active', 'inactive', 'suspended', 'trial');
CREATE TYPE plan_type AS ENUM ('trial', 'starter', 'professional', 'enterprise');

-- ─── Organizations (Tenants) ──────────────────────────────────────────────────

CREATE TABLE organizations (
    id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name         VARCHAR(255) NOT NULL,
    slug         VARCHAR(100) UNIQUE NOT NULL,
    domain       VARCHAR(255),
    logo_url     TEXT,
    status       org_status NOT NULL DEFAULT 'trial',
    plan         plan_type NOT NULL DEFAULT 'trial',
    max_users    INTEGER NOT NULL DEFAULT 50,
    trial_ends_at TIMESTAMPTZ,
    settings     JSONB DEFAULT '{}',
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── Users ────────────────────────────────────────────────────────────────────

CREATE TABLE users (
    id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_id        UUID REFERENCES organizations(id) ON DELETE CASCADE,
    email         VARCHAR(255) NOT NULL,
    password_hash VARCHAR(255),
    first_name    VARCHAR(100) NOT NULL DEFAULT '',
    last_name     VARCHAR(100) NOT NULL DEFAULT '',
    role          user_role NOT NULL DEFAULT 'analyst',
    status        user_status NOT NULL DEFAULT 'active',
    avatar_url    TEXT,
    phone         VARCHAR(50),
    department    VARCHAR(100),
    job_title     VARCHAR(150),
    last_login_at TIMESTAMPTZ,
    settings      JSONB DEFAULT '{}',
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(email, org_id)
);

-- Superadmin users have NULL org_id
CREATE UNIQUE INDEX users_superadmin_email_idx ON users(email) WHERE org_id IS NULL;

-- ─── Refresh Tokens ───────────────────────────────────────────────────────────

CREATE TABLE refresh_tokens (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash  VARCHAR(255) NOT NULL UNIQUE,
    expires_at  TIMESTAMPTZ NOT NULL,
    device_info TEXT,
    ip_address  INET,
    revoked     BOOLEAN NOT NULL DEFAULT false,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── Teams ────────────────────────────────────────────────────────────────────

CREATE TABLE teams (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_id      UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    name        VARCHAR(150) NOT NULL,
    description TEXT,
    color       VARCHAR(20) DEFAULT '#0048A0',
    created_by  UUID REFERENCES users(id),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(org_id, name)
);

-- ─── Employees ────────────────────────────────────────────────────────────────

CREATE TABLE employees (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_id          UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    user_id         UUID REFERENCES users(id) ON DELETE SET NULL,
    employee_id     VARCHAR(100),
    first_name      VARCHAR(100) NOT NULL,
    last_name       VARCHAR(100) NOT NULL,
    email           VARCHAR(255) NOT NULL,
    phone           VARCHAR(50),
    department      VARCHAR(100),
    job_title       VARCHAR(150),
    team_id         UUID REFERENCES teams(id) ON DELETE SET NULL,
    status          user_status NOT NULL DEFAULT 'active',
    risk_score      DECIMAL(5,2) DEFAULT 0.00,
    avatar_url      TEXT,
    device_count    INTEGER DEFAULT 0,
    last_active_at  TIMESTAMPTZ,
    metadata        JSONB DEFAULT '{}',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(org_id, email)
);

-- ─── Devices ─────────────────────────────────────────────────────────────────

CREATE TABLE devices (
    id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_id           UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    employee_id      UUID REFERENCES employees(id) ON DELETE SET NULL,
    hostname         VARCHAR(255) NOT NULL,
    os_type          VARCHAR(50),
    os_version       VARCHAR(100),
    agent_version    VARCHAR(50),
    mac_address      VARCHAR(50),
    ip_address       INET,
    status           VARCHAR(50) DEFAULT 'online',
    last_seen_at     TIMESTAMPTZ,
    posture_score    INTEGER DEFAULT 100,
    enrolled_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    metadata         JSONB DEFAULT '{}',
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── Policies ─────────────────────────────────────────────────────────────────

CREATE TABLE policies (
    id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_id       UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    name         VARCHAR(255) NOT NULL,
    description  TEXT,
    type         policy_type NOT NULL,
    action       policy_action NOT NULL DEFAULT 'block',
    priority     INTEGER NOT NULL DEFAULT 100,
    enabled      BOOLEAN NOT NULL DEFAULT true,
    rules        JSONB NOT NULL DEFAULT '{}',
    targets      JSONB NOT NULL DEFAULT '{"scope":"all"}',
    rego_bundle  TEXT,
    version      INTEGER NOT NULL DEFAULT 1,
    created_by   UUID REFERENCES users(id),
    updated_by   UUID REFERENCES users(id),
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── Policy Assignments ───────────────────────────────────────────────────────

CREATE TABLE policy_assignments (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    policy_id       UUID NOT NULL REFERENCES policies(id) ON DELETE CASCADE,
    org_id          UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    target_type     VARCHAR(50) NOT NULL, -- 'all', 'team', 'employee', 'department'
    target_id       UUID,
    target_value    VARCHAR(255),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── URL Categories ───────────────────────────────────────────────────────────

CREATE TABLE url_categories (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name        VARCHAR(100) NOT NULL UNIQUE,
    slug        VARCHAR(100) NOT NULL UNIQUE,
    description TEXT,
    risk_level  INTEGER DEFAULT 0, -- 0=safe, 1=low, 2=medium, 3=high, 4=critical
    color       VARCHAR(20) DEFAULT '#gray'
);

-- ─── Domain Rules (SWG) ───────────────────────────────────────────────────────

CREATE TABLE domain_rules (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_id      UUID REFERENCES organizations(id) ON DELETE CASCADE, -- NULL = global
    domain      VARCHAR(255) NOT NULL,
    action      policy_action NOT NULL DEFAULT 'block',
    category    VARCHAR(100),
    reason      TEXT,
    source      VARCHAR(100) DEFAULT 'manual', -- 'manual', 'threat_intel', 'ai'
    expires_at  TIMESTAMPTZ,
    enabled     BOOLEAN NOT NULL DEFAULT true,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── Activity Events ──────────────────────────────────────────────────────────

CREATE TABLE activity_events (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_id          UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    employee_id     UUID REFERENCES employees(id) ON DELETE SET NULL,
    device_id       UUID REFERENCES devices(id) ON DELETE SET NULL,
    event_type      event_type NOT NULL,
    action          event_action NOT NULL DEFAULT 'logged',
    target          TEXT,
    target_domain   VARCHAR(255),
    category        VARCHAR(100),
    process_name    VARCHAR(255),
    policy_id       UUID REFERENCES policies(id) ON DELETE SET NULL,
    policy_name     VARCHAR(255),
    risk_score      DECIMAL(5,2) DEFAULT 0.00,
    ai_explanation  TEXT,
    ip_address      INET,
    geo_country     VARCHAR(10),
    geo_city        VARCHAR(100),
    metadata        JSONB DEFAULT '{}',
    timestamp       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── AI Chat Sessions ─────────────────────────────────────────────────────────

CREATE TABLE ai_chat_sessions (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_id      UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title       VARCHAR(255) DEFAULT 'New Chat',
    model       VARCHAR(100),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE ai_chat_messages (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    session_id  UUID NOT NULL REFERENCES ai_chat_sessions(id) ON DELETE CASCADE,
    role        VARCHAR(20) NOT NULL, -- 'user', 'assistant', 'system', 'tool'
    content     TEXT NOT NULL,
    tool_calls  JSONB,
    tool_name   VARCHAR(100),
    tokens_used INTEGER DEFAULT 0,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── Audit Logs ───────────────────────────────────────────────────────────────

CREATE TABLE audit_logs (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_id      UUID REFERENCES organizations(id) ON DELETE CASCADE,
    user_id     UUID REFERENCES users(id) ON DELETE SET NULL,
    action      VARCHAR(100) NOT NULL,
    resource    VARCHAR(100) NOT NULL,
    resource_id UUID,
    changes     JSONB,
    ip_address  INET,
    user_agent  TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── Indexes ──────────────────────────────────────────────────────────────────

CREATE INDEX idx_users_org_id ON users(org_id);
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_employees_org_id ON employees(org_id);
CREATE INDEX idx_employees_team_id ON employees(team_id);
CREATE INDEX idx_employees_status ON employees(status);
CREATE INDEX idx_employees_email ON employees(email);
CREATE INDEX idx_teams_org_id ON teams(org_id);
CREATE INDEX idx_policies_org_id ON policies(org_id);
CREATE INDEX idx_policies_type ON policies(type);
CREATE INDEX idx_policies_enabled ON policies(enabled);
CREATE INDEX idx_activity_events_org_id ON activity_events(org_id);
CREATE INDEX idx_activity_events_employee_id ON activity_events(employee_id);
CREATE INDEX idx_activity_events_timestamp ON activity_events(timestamp DESC);
CREATE INDEX idx_activity_events_action ON activity_events(action);
CREATE INDEX idx_activity_events_event_type ON activity_events(event_type);
CREATE INDEX idx_domain_rules_domain ON domain_rules(domain);
CREATE INDEX idx_domain_rules_org_id ON domain_rules(org_id);
CREATE INDEX idx_refresh_tokens_user_id ON refresh_tokens(user_id);
CREATE INDEX idx_refresh_tokens_token_hash ON refresh_tokens(token_hash);
CREATE INDEX idx_audit_logs_org_id ON audit_logs(org_id);
CREATE INDEX idx_audit_logs_user_id ON audit_logs(user_id);

-- ─── Updated At Trigger ───────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_organizations_updated_at BEFORE UPDATE ON organizations FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER update_employees_updated_at BEFORE UPDATE ON employees FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER update_teams_updated_at BEFORE UPDATE ON teams FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER update_policies_updated_at BEFORE UPDATE ON policies FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER update_devices_updated_at BEFORE UPDATE ON devices FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ─── Seed Data ────────────────────────────────────────────────────────────────

-- Default superadmin
INSERT INTO users (id, email, password_hash, first_name, last_name, role, status)
VALUES (
    uuid_generate_v4(),
    'superadmin@aavishield.com',
    crypt('SuperAdmin@123', gen_salt('bf')),
    'Super',
    'Admin',
    'superadmin',
    'active'
) ON CONFLICT DO NOTHING;

-- Demo organization
INSERT INTO organizations (id, name, slug, domain, status, plan, max_users)
VALUES (
    '11111111-1111-1111-1111-111111111111',
    'Acme Corporation',
    'acme',
    'acme.com',
    'active',
    'professional',
    500
) ON CONFLICT DO NOTHING;

-- Demo org admin
INSERT INTO users (id, org_id, email, password_hash, first_name, last_name, role, status)
VALUES (
    uuid_generate_v4(),
    '11111111-1111-1111-1111-111111111111',
    'admin@acme.com',
    crypt('Admin@123', gen_salt('bf')),
    'John',
    'Smith',
    'org_admin',
    'active'
) ON CONFLICT DO NOTHING;

-- URL categories
INSERT INTO url_categories (name, slug, risk_level, color) VALUES
    ('Social Media', 'social_media', 2, '#f97316'),
    ('Gambling', 'gambling', 3, '#ef4444'),
    ('Adult Content', 'adult_content', 4, '#dc2626'),
    ('Malware', 'malware', 4, '#991b1b'),
    ('Phishing', 'phishing', 4, '#7f1d1d'),
    ('News & Media', 'news_media', 0, '#22c55e'),
    ('Business', 'business', 0, '#3b82f6'),
    ('Technology', 'technology', 0, '#6366f1'),
    ('Gaming', 'gaming', 1, '#f59e0b'),
    ('Streaming', 'streaming', 1, '#8b5cf6'),
    ('Productivity', 'productivity', 0, '#10b981'),
    ('Finance', 'finance', 0, '#14b8a6'),
    ('Healthcare', 'healthcare', 0, '#06b6d4'),
    ('Education', 'education', 0, '#0ea5e9'),
    ('Shopping', 'shopping', 0, '#84cc16'),
    ('Torrent', 'torrent', 3, '#f43f5e'),
    ('VPN & Proxy', 'vpn_proxy', 3, '#e11d48'),
    ('Hacking Tools', 'hacking_tools', 4, '#be123c'),
    ('Unknown', 'unknown', 1, '#6b7280')
ON CONFLICT DO NOTHING;

-- Global blocked domains
INSERT INTO domain_rules (domain, action, category, reason, source) VALUES
    ('instagram.com', 'block', 'social_media', 'Social media', 'manual'),
    ('www.instagram.com', 'block', 'social_media', 'Social media', 'manual'),
    ('web.whatsapp.com', 'block', 'social_media', 'Social media', 'manual'),
    ('facebook.com', 'block', 'social_media', 'Social media', 'manual'),
    ('www.facebook.com', 'block', 'social_media', 'Social media', 'manual'),
    ('tiktok.com', 'block', 'social_media', 'Social media', 'manual'),
    ('twitter.com', 'block', 'social_media', 'Social media', 'manual'),
    ('x.com', 'block', 'social_media', 'Social media', 'manual')
ON CONFLICT DO NOTHING;
