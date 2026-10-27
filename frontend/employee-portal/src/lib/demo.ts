/**
 * Local preview data so marketing can capture the employee portal
 * without admin-api. Turned on with NEXT_PUBLIC_DEMO_DATA=1.
 */

export const isDemo = process.env.NEXT_PUBLIC_DEMO_DATA === "1";

export const DEMO_SESSION = {
  expires: "2099-12-31T23:59:59.999Z",
  accessToken: "",
  user: {
    id: "emp-aisha",
    email: "aisha.qureshi@northwindlabs.com",
    name: "Aisha Qureshi",
    first_name: "Aisha",
    last_name: "Qureshi",
    org_name: "Northwind Labs",
  },
};

function pathOf(url?: string) {
  if (!url) return "";
  try {
    if (url.startsWith("http")) return new URL(url).pathname;
  } catch { /* relative */ }
  return url.split("?")[0];
}

export function resolveDemo(config: { method?: string; url?: string }): unknown {
  const path = pathOf(config.url);
  if (path.includes("/portal/installers")) {
    return {
      version: "1.4.2",
      packages: {
        macos: { filename: "Aavishield-1.4.2.pkg", url: "#", version: "1.4.2", size: 48_230_016, sha256: "a3f1c9" },
        windows: { filename: "Aavishield-1.4.2.msi", url: "#", version: "1.4.2", size: 52_428_800, sha256: "b7e204" },
        linux: { filename: "aavishield_1.4.2_amd64.deb", url: "#", version: "1.4.2", size: 41_943_040, sha256: "c11d88" },
      },
    };
  }
  if (path.includes("/portal/devices")) return { data: [] };
  if (path.includes("/portal/notifications")) return { data: [] };
  if (path.includes("/portal/me")) return DEMO_SESSION.user;
  if ((config.method || "get").toLowerCase() === "get") return { data: [] };
  return { ok: true };
}
