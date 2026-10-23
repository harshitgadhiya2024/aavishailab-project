import { createElement, type ComponentType, type ReactElement } from "react";
import type { ModuleSlug } from "@/lib/content";
import { shots, type Shot, type ShotKey } from "@/lib/shots";
import { ActivityOverview, AppControlOverview, DlpOverview, MalwareOverview, PostureOverview, VpnOverview } from "./overviews";
import {
  AccessRequestsPanel,
  ActivityDlpPanel,
  ActivityDownloadsPanel,
  ActivityPanel,
  ActivityPosturePanel,
  AppAttemptsPanel,
  AppsPanel,
  AssistantPanel,
  CompliancePanel,
  DevicesPanel,
  DlpIncidentPanel,
  DownloadPanel,
  EmployeesPanel,
  InventoryPanel,
  MaliciousSitesPanel,
  MalwareScanPanel,
  MonitoringPanel,
  MonitoringSettingsPanel,
  OverviewPanel,
  PostureRingPanel,
  ReportsPanel,
  RiskPanel,
  ScreenshotGridPanel,
  SettingsPanel,
  SignInPanel,
  TeamsPanel,
  VpnAttemptsPanel,
} from "./screens";
import { CategoryPanel, PolicyPanel, UrlCheckPanel, WebGatewayOverview } from "./web-gateway";

/*
 * Which product panel stands in for each console screenshot. Every section
 * that shows a screen gets its panel automatically; only the Product tour
 * and the landing page's console section keep the real screenshots (they
 * pass `real`). Dark-mode captures map to the same panel as the light ones.
 */
const BY_SHOT: Partial<Record<ShotKey, ComponentType>> = {
  overview: OverviewPanel,
  overviewScroll: OverviewPanel,
  overviewDark: OverviewPanel,
  dlp: DlpIncidentPanel,
  dlpDark: DlpIncidentPanel,
  webGateway: PolicyPanel,
  webGatewayDark: PolicyPanel,
  urlChecker: UrlCheckPanel,
  categories: CategoryPanel,
  applications: AppsPanel,
  activity: ActivityPanel,
  activityDark: ActivityPanel,
  activityDlp: ActivityDlpPanel,
  activityDownloads: ActivityDownloadsPanel,
  activityPosture: ActivityPosturePanel,
  reports: ReportsPanel,
  reportsDark: ReportsPanel,
  reportsCompliance: CompliancePanel,
  reportsRisk: RiskPanel,
  employees: EmployeesPanel,
  teams: TeamsPanel,
  screenshots: MonitoringPanel,
  screenshotsDark: MonitoringPanel,
  accessRequests: AccessRequestsPanel,
  settings: SettingsPanel,
  ai: AssistantPanel,
  devices: DevicesPanel,
  login: SignInPanel,
  portalLogin: SignInPanel,
  portalDownload: DownloadPanel,
};

const keyBySrc = new Map(Object.entries(shots).map(([k, v]) => [v.src, k as ShotKey]));

/** The panel that replaces a screenshot, if there is one, ready to render. */
export function panelForShot(shot: Shot): ReactElement | undefined {
  const key = keyBySrc.get(shot.src);
  const C = key ? BY_SHOT[key] : undefined;
  return C ? createElement(C) : undefined;
}

/** The large overview at the top of each feature page. */
const SHOWCASE: Record<ModuleSlug, ComponentType> = {
  "web-gateway": WebGatewayOverview,
  "data-loss-prevention": DlpOverview,
  "application-control": AppControlOverview,
  "vpn-control": VpnOverview,
  "malware-scanning": MalwareOverview,
  "device-posture": PostureOverview,
  "activity-monitoring": ActivityOverview,
};

/**
 * Per-page replacements for "screen by screen" splits where the same screen
 * appears twice or a filtered view tells the story better. Indexes match
 * the gallery in lib/module-shots.ts; anything not listed uses the screen's
 * own panel.
 */
const GALLERY: Partial<Record<ModuleSlug, (ComponentType | undefined)[]>> = {
  "application-control": [InventoryPanel, AppsPanel, AppAttemptsPanel],
  "vpn-control": [undefined, undefined, VpnAttemptsPanel],
  "malware-scanning": [undefined, undefined, MaliciousSitesPanel],
  "activity-monitoring": [MonitoringPanel, ScreenshotGridPanel, MonitoringSettingsPanel],
};

/** A focused widget per control for the Platform page cards, so no two look alike. */
const CARD: Record<ModuleSlug, ComponentType> = {
  "web-gateway": UrlCheckPanel,
  "data-loss-prevention": DlpIncidentPanel,
  "application-control": AppsPanel,
  "vpn-control": VpnAttemptsPanel,
  "malware-scanning": MalwareScanPanel,
  "device-posture": PostureRingPanel,
  "activity-monitoring": MonitoringPanel,
};

export const moduleCard = (slug: ModuleSlug): ReactElement => createElement(CARD[slug]);

export const moduleShowcase = (slug: ModuleSlug): ReactElement => createElement(SHOWCASE[slug]);

/** The override for the i-th split on a feature page, if any. */
export function moduleGalleryPanel(slug: ModuleSlug, i: number): ReactElement | undefined {
  const C = GALLERY[slug]?.[i];
  return C ? createElement(C) : undefined;
}
