"use client";

import { Cpu, Eye, LockSimple, ShieldCheck } from "@phosphor-icons/react";
import { StatChartPanel, type StatChartData } from "./kit";

/*
 * The large overview panel at the top of each feature page. Demo data for
 * a 40-device company; weekly series add up to the totals they sit under.
 */

const WEEK = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const DLP: StatChartData = {
  context: "Last 7 days · 40 devices",
  left: {
    label: "Uploads and messages scanned",
    big: 18640,
    split: [{ label: "Findings", value: 86 }, { label: "High risk", value: 9 }],
    rows: [
      { label: "Salary data", value: "21 findings" },
      { label: "API keys", value: "17 findings" },
      { label: "PAN and Aadhaar", value: "14 findings" },
    ],
    foot: { left: <><Eye size={14} /> Monitor-only</>, right: "Never blocks work" },
  },
  right: {
    label: "Findings this week",
    big: 86,
    trend: { text: "8%", down: true, good: true },
    main: [14, 11, 16, 12, 15, 10, 8],
    second: [2, 1, 2, 1, 2, 1, 0],
    labels: WEEK,
    legend: ["Findings", "High risk 9"],
  },
};

const APPS: StatChartData = {
  context: "All devices · 40",
  left: {
    label: "Apps installed",
    big: 212,
    split: [{ label: "Blocked apps", value: 6 }, { label: "Devices", value: 40 }],
    rows: [
      { label: "AnyDesk", value: "App block" },
      { label: "uTorrent", value: "App block" },
      { label: "Personal sync app", value: "Network block" },
    ],
    foot: { left: <><Cpu size={14} /> macOS · Windows · Linux</>, right: "One policy" },
  },
  right: {
    label: "Blocked launches",
    big: 143,
    trend: { text: "18%", down: true, good: true },
    main: [28, 24, 22, 21, 19, 17, 12],
    labels: WEEK,
    legend: ["Blocked launches"],
  },
};

const VPN: StatChartData = {
  context: "Last 7 days · 40 devices",
  left: {
    label: "Bypass attempts blocked",
    big: 57,
    split: [{ label: "VPN apps", value: 31 }, { label: "Extensions", value: 26 }],
    rows: [
      { label: "NordVPN", value: "14 blocked" },
      { label: "Proxy extension", value: "11 blocked" },
      { label: "ProtonVPN installer", value: "9 blocked" },
    ],
    foot: { left: <><ShieldCheck size={14} /> On by default</>, right: "No setup" },
  },
  right: {
    label: "Attempts this week",
    big: 57,
    trend: { text: "30%", down: true, good: true },
    main: [12, 10, 9, 8, 7, 6, 5],
    labels: WEEK,
    legend: ["Bypass attempts"],
  },
};

const MALWARE: StatChartData = {
  context: "Last 7 days · 40 devices",
  left: {
    label: "Downloads scanned",
    big: 9415,
    split: [{ label: "Blocked", value: 23 }, { label: "Risk 80+", value: 18 }],
    rows: [
      { label: "invoice_0932.zip", value: "Risk 94" },
      { label: "crack-setup.exe", value: "Risk 91" },
      { label: "Q4-report.xlsm", value: "Risk 82" },
    ],
    foot: { left: <><LockSimple size={14} /> Scanned in flight</>, right: "Never reaches disk" },
  },
  right: {
    label: "Malicious files blocked",
    big: 23,
    trend: { text: "15%", down: true, good: true },
    main: [4, 3, 5, 3, 4, 2, 2],
    labels: WEEK,
    legend: ["Blocked downloads"],
  },
};

const POSTURE: StatChartData = {
  context: "All devices · 40",
  left: {
    label: "Posture score",
    big: 92,
    suffix: " / 100",
    split: [{ label: "Compliant", value: 36 }, { label: "Need a fix", value: 4 }],
    rows: [
      { label: "Firewall off", value: "2 devices" },
      { label: "OS updates pending", value: "1 device" },
      { label: "Disk encryption off", value: "1 device" },
    ],
    foot: { left: <><ShieldCheck size={14} /> FileVault · BitLocker · LUKS</>, right: "Checked continuously" },
  },
  right: {
    label: "Compliant devices",
    big: 36,
    suffix: " / 40",
    trend: { text: "+5", down: false, good: true },
    main: [31, 32, 32, 33, 34, 35, 36],
    labels: WEEK,
    legend: ["Compliant devices"],
  },
};

const ACTIVITY: StatChartData = {
  context: "Today · monitored devices",
  left: {
    label: "Monitored devices",
    big: 12,
    suffix: " / 40",
    split: [{ label: "Active time", value: 6, suffix: "h 10m" }, { label: "Idle time", value: 1, suffix: "h 32m" }],
    rows: [
      { label: "VS Code", value: "3h 51m" },
      { label: "Figma", value: "2h 14m" },
      { label: "Slack", value: "1h 05m" },
    ],
    foot: { left: <><Eye size={14} /> Opt-in per device</>, right: "Screenshots blurred" },
  },
  right: {
    label: "Active now",
    big: 9,
    suffix: " / 12",
    main: [8, 11, 12, 10, 7, 11, 12, 10, 9],
    labels: ["9", "10", "11", "12", "1", "2", "3", "4", "5"],
    legend: ["Active devices by hour"],
  },
};

export const DlpOverview = () => <StatChartPanel data={DLP} />;
export const AppControlOverview = () => <StatChartPanel data={APPS} />;
export const VpnOverview = () => <StatChartPanel data={VPN} />;
export const MalwareOverview = () => <StatChartPanel data={MALWARE} />;
export const PostureOverview = () => <StatChartPanel data={POSTURE} />;
export const ActivityOverview = () => <StatChartPanel data={ACTIVITY} />;
