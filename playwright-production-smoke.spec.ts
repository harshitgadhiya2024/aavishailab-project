import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

const API = process.env.E2E_API_URL || "https://aavishield-api.aavishailab.com";
const AI = process.env.E2E_AI_URL || "https://aavishield-ai.aavishailab.com";
const COMPANY = process.env.E2E_COMPANY_URL || "https://aavishield-app.aavishailab.com";
const EMPLOYEE = process.env.E2E_EMPLOYEE_URL || "https://aavishield-employee.aavishailab.com";
const SUPERADMIN = process.env.E2E_SUPERADMIN_URL || "https://aavishield-admin.aavishailab.com";

const COMPANY_ADMIN = { email: "admin@acme.com", password: "Admin@123" };
const EMPLOYEE_USER = { email: "employee@acme.com", password: "Employee@123" };
const SUPERADMIN_USER = { email: "superadmin@aavishield.com", password: "SuperAdmin@123" };

async function apiLogin(request: APIRequestContext, email: string, password: string, panel: "company" | "superadmin") {
  const res = await request.post(`${API}/api/v1/auth/login`, {
    data: { email, password, panel },
  });
  expect(res.ok(), `${panel} API login failed: ${res.status()} ${await res.text()}`).toBeTruthy();
  const body = await res.json();
  expect(body.access_token).toBeTruthy();
  return body;
}

async function portalLogin(request: APIRequestContext) {
  const res = await request.post(`${API}/api/v1/portal/login`, {
    data: EMPLOYEE_USER,
  });
  expect(res.ok(), `portal API login failed: ${res.status()} ${await res.text()}`).toBeTruthy();
  const body = await res.json();
  expect(body.access_token).toBeTruthy();
  return body;
}

function authHeaders(token: string, orgId?: string) {
  return {
    Authorization: `Bearer ${token}`,
    ...(orgId ? { "x-org-id": orgId } : {}),
  };
}

async function expectJsonOK(res: any, label: string) {
  expect(res.ok(), `${label} failed: ${res.status()} ${await res.text()}`).toBeTruthy();
  const ct = res.headers()["content-type"] || "";
  expect(ct, `${label} returned non-json content-type ${ct}`).toContain("application/json");
  return res.json();
}

async function loginCompanyUI(page: Page) {
  await page.goto(`${COMPANY}/login`);
  await page.locator('input[type="email"]').fill(COMPANY_ADMIN.email);
  await page.locator('input[type="password"]').fill(COMPANY_ADMIN.password);
  await page.locator('input[type="checkbox"]').check();
  await page.getByRole("button", { name: /^sign in$/i }).click();
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 20_000 });
  await expect(page.getByText(/Aavishield|Dashboard/i).first()).toBeVisible();
}

async function loginEmployeeUI(page: Page) {
  await page.goto(`${EMPLOYEE}/login`);
  await page.locator('input[type="email"]').fill(EMPLOYEE_USER.email);
  await page.locator('input[type="password"]').fill(EMPLOYEE_USER.password);
  await page.locator('input[type="checkbox"]').check();
  await page.getByRole("button", { name: /^sign in$/i }).click();
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 20_000 });
  await expect(page.getByText(/Security|Dashboard|Aavishield/i).first()).toBeVisible();
}

async function loginSuperadminUI(page: Page) {
  await page.goto(`${SUPERADMIN}/login`);
  await page.locator('input[type="email"]').fill(SUPERADMIN_USER.email);
  await page.locator('input[type="password"]').fill(SUPERADMIN_USER.password);
  await page.getByRole("button", { name: /^sign in$/i }).click();
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 20_000 });
  await expect(page.getByText(/Aavishield|Dashboard|Super/i).first()).toBeVisible();
}

test.describe.configure({ mode: "serial" });

// ──────────────────────────────────────────────
//  Test 1: Public tunnel health
// ──────────────────────────────────────────────
test("public tunnel health and CORS/WebSocket reachability", async ({ request }) => {
  test.setTimeout(30_000);
  await expectJsonOK(await request.get(`${API}/health`), "admin-api health");
  await expectJsonOK(await request.get(`${AI}/health`), "ai-service health");

  const preflight = await request.fetch(`${API}/api/v1/auth/me`, {
    method: "OPTIONS",
    headers: {
      Origin: COMPANY,
      "Access-Control-Request-Method": "GET",
      "Access-Control-Request-Headers": "authorization,x-org-id",
    },
  });
  expect(preflight.status(), "CORS preflight should be accepted").toBe(204);
  expect(preflight.headers()["access-control-allow-origin"]).toBe(COMPANY);

  const ws = await request.get(`${API}/ws`, {
    headers: {
      Connection: "Upgrade",
      Upgrade: "websocket",
      "Sec-WebSocket-Key": "SGVsbG8sIHdvcmxkIQ==",
      "Sec-WebSocket-Version": "13",
    },
  });
  expect([400, 401, 426], `WebSocket route should be reachable, got ${ws.status()}`).toContain(ws.status());
});

// ──────────────────────────────────────────────
//  Test 2: Authenticated backend APIs
// ──────────────────────────────────────────────
test("authenticated backend feature APIs respond with expected decisions", async ({ request }) => {
  test.setTimeout(60_000);
  const company = await apiLogin(request, COMPANY_ADMIN.email, COMPANY_ADMIN.password, "company");
  const headers = authHeaders(company.access_token, company.user?.org_id);

  await expectJsonOK(await request.get(`${API}/api/v1/auth/me`, { headers }), "auth me");
  await expectJsonOK(await request.get(`${API}/api/v1/devices`, { headers }), "devices list");
  await expectJsonOK(await request.get(`${API}/api/v1/access-requests?status=pending`, { headers }), "access requests");
  await expectJsonOK(await request.get(`${API}/api/v1/settings/mitm`, { headers }), "MITM settings");
  await expectJsonOK(await request.get(`${API}/api/v1/swg/categories`, { headers }), "SWG categories");
  await expectJsonOK(await request.get(`${API}/api/v1/swg/stats`, { headers }), "SWG stats");

  const swgCheck = await expectJsonOK(
    await request.post(`${API}/api/v1/swg/check`, { headers, data: { url: "https://instagram.com/" } }),
    "SWG check",
  );
  expect(JSON.stringify(swgCheck).toLowerCase()).toContain("instagram");

  const threat = await expectJsonOK(
    await request.get(`${API}/api/v1/swg/threat-lookup?domain=instagram.com`, { headers }),
    "threat lookup",
  );
  expect(threat.kind || threat.indicator).toBeTruthy();

  const dlp = await expectJsonOK(
    await request.post(`${API}/api/v1/dlp/test`, {
      headers,
      data: {
        text: "Customer card 4111 1111 1111 1111, SSN 123-45-6789, secret api_key=sk_test_value",
        filename: "sensitive.txt",
        content_type: "text/plain",
      },
    }),
    "DLP test",
  );
  expect(JSON.stringify(dlp).toLowerCase()).toMatch(/score|action|detector|finding|risk/);

  const casb = await expectJsonOK(
    await request.post(`${API}/api/v1/casb/app-control`, {
      headers,
      data: { app: "Dropbox", category: "cloud_storage", activity: "upload", sanctioned: false, risk_score: 75 },
    }),
    "CASB app control",
  );
  expect(["allow", "alert", "block"]).toContain(casb.action);

  const shadow = await expectJsonOK(await request.get(`${API}/api/v1/shadow-it/apps?limit=10`, { headers }), "Shadow IT apps");
  expect(Array.isArray(shadow.apps)).toBeTruthy();

  const activity = await expectJsonOK(await request.get(`${API}/api/v1/activity?limit=5`, { headers }), "activity list");
  expect(Array.isArray(activity.data || activity.events)).toBeTruthy();

  const employee = await portalLogin(request);
  const portalHeaders = authHeaders(employee.access_token);
  await expectJsonOK(await request.get(`${API}/api/v1/portal/me`, { headers: portalHeaders }), "portal me");
  await expectJsonOK(await request.get(`${API}/api/v1/portal/devices`, { headers: portalHeaders }), "portal devices");
  await expectJsonOK(await request.get(`${API}/api/v1/portal/activity?limit=5`, { headers: portalHeaders }), "portal activity");
  await expectJsonOK(await request.get(`${API}/api/v1/portal/access-requests`, { headers: portalHeaders }), "portal access requests");

  const installer = await request.get(`${API}/api/v1/portal/download/macos`, { headers: portalHeaders });
  expect(installer.ok(), `macOS installer generation failed: ${installer.status()} ${await installer.text()}`).toBeTruthy();
  expect(installer.headers()["content-disposition"] || "").toMatch(/aavishield-install\.command/i);
});

// ──────────────────────────────────────────────
//  Test 3: Company dashboard – page navigation
// ──────────────────────────────────────────────
test("company dashboard browser navigation covers major feature pages", async ({ page }) => {
  test.setTimeout(180_000);
  await loginCompanyUI(page);
  const pages = [
    ["/dashboard", /Dashboard|Security/i],
    ["/dashboard/employees", /Employees/i],
    ["/dashboard/teams", /Teams/i],
    ["/dashboard/policies", /Policies/i],
    ["/dashboard/access-requests", /Access Requests/i],
    ["/dashboard/activity", /Security Activity|Blocked Activity/i],
    ["/dashboard/swg", /Web Gateway|SWG/i],
    ["/dashboard/dlp", /Data Loss Prevention|DLP/i],
    ["/dashboard/shadow-it", /Shadow IT/i],
    ["/dashboard/casb", /CASB/i],
    ["/dashboard/devices", /Devices/i],
    ["/dashboard/reports", /Reports/i],
    ["/dashboard/settings", /Settings/i],
    ["/dashboard/ai-assistant", /AI Assistant/i],
  ] as const;

  for (const [path, heading] of pages) {
    await page.goto(`${COMPANY}${path}`);
    await expect(page.locator("body")).toContainText(heading, { timeout: 15_000 });
    await expect(page.locator("body")).not.toContainText(/Application error|Unhandled Runtime Error|Internal Server Error/i);
  }

  await page.goto(`${COMPANY}/dashboard/swg`);
  await page.getByPlaceholder("https://example.com/path").fill("https://instagram.com/");
  await page.getByRole("button", { name: /^check$/i }).click();
  await expect(page.locator("body")).toContainText(/Blocked|Allowed/i, { timeout: 15_000 });

  await page.goto(`${COMPANY}/dashboard/dlp`);
  await page.getByPlaceholder(/Paste content to scan/i).fill("Card 4111 1111 1111 1111 with SSN 123-45-6789 and api_key=sk_test_value");
  await Promise.all([
    page.waitForResponse((r) => r.url().includes("dlp"), { timeout: 20_000 }).catch(() => null),
    page.getByRole("button", { name: /scan sample/i }).click(),
  ]);
  await expect(page.locator("body")).toContainText(/Score|Decision|Blocked|Allowed|Risk/i, { timeout: 25_000 });

  await page.goto(`${COMPANY}/dashboard/casb`);
  await page.getByPlaceholder("App (optional)").fill("Dropbox");
  await Promise.all([
    page.waitForResponse((r) => r.url().includes("casb") || r.url().includes("app-control"), { timeout: 20_000 }).catch(() => null),
    page.getByRole("button", { name: /evaluate/i }).click(),
  ]);
  // result renders as a badge span — check the badge span directly, not raw body text
  // (body text concatenates button + badge without spaces, breaking word-boundary regex)
  await expect(page.locator("span").filter({ hasText: /^(allow|alert|block)$/i }).first()).toBeVisible({ timeout: 25_000 });
  await Promise.all([
    page.waitForResponse((r) => r.url().includes("casb") || r.url().includes("oob"), { timeout: 20_000 }).catch(() => null),
    page.getByRole("button", { name: /scan shares/i }).click(),
  ]);
  await expect(page.locator("body")).toContainText(/Scanned|risky shares|No risky/i, { timeout: 25_000 });
});

// ──────────────────────────────────────────────
//  Test 4: Employee portal navigation
// ──────────────────────────────────────────────
test("employee portal browser navigation covers core employee flows", async ({ page, request }) => {
  test.setTimeout(150_000);
  await loginEmployeeUI(page);
  const pages = [
    ["/dashboard", /Dashboard|Security/i],
    ["/dashboard/activity", /Security Activity|Blocked Activity/i],
    ["/dashboard/devices", /Devices|Device/i],
    ["/dashboard/download", /Download|Agent|Installer/i],
  ] as const;

  for (const [path, heading] of pages) {
    await page.goto(`${EMPLOYEE}${path}`);
    await expect(page.locator("body")).toContainText(heading, { timeout: 15_000 });
    await expect(page.locator("body")).not.toContainText(/Application error|Unhandled Runtime Error|Internal Server Error/i);
  }

  await page.goto(`${EMPLOYEE}/dashboard/download`);
  // Select macOS platform card
  await page.locator("button").filter({ hasText: /macOS/i }).first().click();
  // Wait for the install steps section to appear (confirms OS was selected)
  await expect(page.locator("body")).toContainText(/Setup steps for macOS|Download the .command/i, { timeout: 10_000 });
  const nativeDownload = page.getByRole("link", { name: /Download (PKG|EXE|DEB)/i });
  const hasNativePackage = await nativeDownload.waitFor({ state: "visible", timeout: 10_000 })
    .then(() => true)
    .catch(() => false);
  if (hasNativePackage) {
    const href = await nativeDownload.getAttribute("href");
    expect(href).toMatch(/\/agent\/packages\/.+\.(pkg|exe|deb)$/i);
    const packagePath = new URL(href!).pathname;
    const packageResponse = await request.get(`${API}${packagePath}`);
    expect(packageResponse.ok(), `native package download failed: ${packageResponse.status()}`).toBeTruthy();
  } else {
    await page.getByRole("button", { name: /Download for macOS/i }).click();
    await expect(page.getByText("Downloaded", { exact: true })).toBeVisible({ timeout: 60_000 });
  }
});

// ──────────────────────────────────────────────
//  Test 5: Superadmin login & dashboard
// ──────────────────────────────────────────────
test("superadmin browser login and dashboard load", async ({ page }) => {
  test.setTimeout(60_000);
  await loginSuperadminUI(page);
  await page.goto(`${SUPERADMIN}/dashboard`);
  await expect(page.locator("body")).toContainText(/Dashboard|Organizations|Super/i);
  await expect(page.locator("body")).not.toContainText(/Application error|Unhandled Runtime Error|Internal Server Error/i);
});
