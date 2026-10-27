import { chromium } from "playwright";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.resolve(__dirname, "../public/images/product");
const dash = "http://localhost:1002";
const portal = "http://localhost:1003";

const initLight = () => {
  try { sessionStorage.removeItem("aavishield-open-assistant"); } catch {}
  try { localStorage.removeItem("aavishield-assistant-session"); } catch {}
  try { localStorage.setItem("aavishield-notifications-seen", String(Date.now())); } catch {}
  try { localStorage.setItem("aavishield-theme", "light"); } catch {}
};

const initDark = () => {
  try { sessionStorage.removeItem("aavishield-open-assistant"); } catch {}
  try { localStorage.removeItem("aavishield-assistant-session"); } catch {}
  try { localStorage.setItem("aavishield-notifications-seen", String(Date.now())); } catch {}
  try { localStorage.setItem("aavishield-theme", "dark"); } catch {}
};

const initAssistant = () => {
  initLight();
  try { sessionStorage.setItem("aavishield-open-assistant", "1"); } catch {}
};

async function shot(page, file, { escape = true } = {}) {
  if (escape) await page.keyboard.press("Escape").catch(() => {});
  await page.waitForTimeout(700);
  await page.screenshot({
    path: path.join(outDir, file),
    type: "jpeg",
    quality: 90,
    animations: "disabled",
  });
  console.log("wrote", file);
}

async function open(page, url, waitText) {
  await page.goto(url, { waitUntil: "networkidle", timeout: 60000 });
  if (waitText) {
    await page.getByText(waitText, { exact: false }).first().waitFor({ timeout: 25000 }).catch(() => {
      console.warn("missing", waitText, "on", url);
    });
  }
}

const browser = await chromium.launch({ channel: "chrome", headless: true });

async function newPage(theme) {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
    colorScheme: theme === "dark" ? "dark" : "light",
  });
  await page.addInitScript(theme === "dark" ? initDark : theme === "ai" ? initAssistant : initLight);
  return page;
}

const light = await newPage("light");

await open(light, `${dash}/dashboard`, "23 of 24");
await shot(light, "overview-latest.jpg");
await shot(light, "overview.jpg");

await light.locator("main.dash").evaluate((el) => { el.scrollTop = 720; });
await light.waitForTimeout(400);
await shot(light, "overview-scroll.jpg");
await light.locator("main.dash").evaluate((el) => { el.scrollTop = 0; });

await open(light, `${dash}/dashboard/dlp`, "Aisha Qureshi");
await shot(light, "dlp-latest.jpg");
await shot(light, "dlp.jpg");

await open(light, `${dash}/dashboard/swg`, "URL checker");
await shot(light, "web-gateway.jpg");
const input = light.locator('input[placeholder*="example.com"]');
await input.fill("https://instagram.com/reels");
await light.getByRole("button", { name: /check/i }).click();
await light.getByText("Blocked").first().waitFor({ timeout: 10000 });
await shot(light, "url-checker-latest.jpg");

await open(light, `${dash}/dashboard/applications`, "uTorrent");
await shot(light, "applications-latest.jpg");
await shot(light, "applications.jpg");

await open(light, `${dash}/dashboard/categories`, "Gambling");
await shot(light, "categories.jpg");

await open(light, `${dash}/dashboard/activity`, "Aisha Qureshi");
await shot(light, "activity-latest.jpg");
await shot(light, "activity.jpg");

await light.getByRole("button", { name: "DLP" }).click();
await light.getByText("Aisha Qureshi").first().waitFor({ timeout: 15000 });
await shot(light, "activity-dlp.jpg");

await light.getByRole("button", { name: "Downloads" }).click();
await light.getByText("Malware Detection").first().waitFor({ timeout: 15000 }).catch(() => {});
await shot(light, "activity-downloads.jpg");

await light.getByRole("button", { name: "Device posture" }).click();
await light.getByText("Posture check").first().waitFor({ timeout: 15000 }).catch(() => {});
await shot(light, "activity-posture.jpg");

await open(light, `${dash}/dashboard/reports`, "Executive summary");
await light.getByText("Incidents over time").first().waitFor({ timeout: 20000 });
await shot(light, "reports.jpg");

await open(light, `${dash}/dashboard/reports?report=devices`, "Device compliance");
await light.getByText("NW-DANIEL-LT08").first().waitFor({ timeout: 20000 });
await shot(light, "reports-compliance.jpg");

await open(light, `${dash}/dashboard/reports?report=employee-risk`, "Employee risk");
await light.getByText("Farhan Ali").first().waitFor({ timeout: 20000 });
await shot(light, "reports-risk.jpg");

await open(light, `${dash}/dashboard/employees`, "Aisha Qureshi");
await shot(light, "employees.jpg");

await open(light, `${dash}/dashboard/teams`, "Engineering");
await shot(light, "teams.jpg");

await open(light, `${dash}/dashboard/devices`, "NW-AISHA");
await shot(light, "devices.jpg");

await open(light, `${dash}/dashboard/screenshots`, "Tracked");
await light.getByText("VS Code").first().waitFor({ timeout: 20000 }).catch(() => {});
await shot(light, "screenshots.jpg");

await open(light, `${dash}/dashboard/access-requests`, "instagram.com");
await shot(light, "access-requests.jpg");

await open(light, `${dash}/dashboard/settings#notifications`, "Email notifications");
await light.getByText("Email notifications").first().waitFor({ timeout: 15000 });
await shot(light, "settings.jpg");

await open(light, `${dash}/login`, "Sign in");
await shot(light, "login.jpg");

await open(light, `${portal}/login`, "Sign in");
await shot(light, "portal-login.jpg");

await open(light, `${portal}/dashboard/download`, "Install Aavishield");
await light.getByText("Aavishield-1.4.2").first().waitFor({ timeout: 15000 }).catch(() => {});
await shot(light, "portal-download.jpg");

await light.close();

const dark = await newPage("dark");
await open(dark, `${dash}/dashboard`, "23 of 24");
await shot(dark, "overview-dark.jpg");

await open(dark, `${dash}/dashboard/dlp`, "Aisha Qureshi");
await shot(dark, "dlp-dark.jpg");

await open(dark, `${dash}/dashboard/swg`, "URL checker");
await shot(dark, "web-gateway-dark.jpg");

await open(dark, `${dash}/dashboard/activity`, "Aisha Qureshi");
await shot(dark, "activity-dark.jpg");

await open(dark, `${dash}/dashboard/reports`, "Incidents over time");
await shot(dark, "reports-dark.jpg");

await open(dark, `${dash}/dashboard/screenshots`, "Tracked");
await shot(dark, "screenshots-dark.jpg");
await dark.close();

const ai = await newPage("ai");
await open(ai, `${dash}/dashboard`, "23 of 24");
await ai.getByText("What needs my attention today?").first().waitFor({ timeout: 15000 }).catch(() => {});
await ai.getByTitle("Larger").click().catch(() => {});
await ai.waitForTimeout(400);
await shot(ai, "ai-assistant.jpg", { escape: false });
await ai.close();

await browser.close();
console.log("done");
