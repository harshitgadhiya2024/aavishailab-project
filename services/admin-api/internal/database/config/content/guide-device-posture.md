---
kind: guide
slug: device-posture
title: Device posture checks
excerpt: Disk encryption, firewall, OS patch level and antivirus, checked continuously on every Mac, Windows and Linux device.
category: Devices and agent
tags: device posture, encryption, filevault, bitlocker, luks, patching
author: Aavishield team
seo_title: Device Posture and Compliance Checks
seo_description: What Aavishield checks on every device, how often, and how to find the laptops that fall short.
order: 30
published: 2026-10-20
---
Device Posture tells you which devices meet your security baseline and which do not.

## What is checked

| Check | What it looks for |
| --- | --- |
| Disk encryption | FileVault, BitLocker or LUKS |
| Firewall | The operating system firewall is on |
| Patch level | The operating system is up to date |
| Antivirus | Antivirus is present |

## How often

Continuously. The agent reports posture regularly, so the console shows the current state.

## Fixing problems

Aavishield highlights non-compliant devices and what needs fixing, so IT can follow up. It does not change device settings itself.

## Why it helps

- Show encryption and patch status for every device in an audit, instead of collecting screenshots.
- Find the laptop with its firewall switched off before it becomes an incident.
- Check new devices meet your baseline as soon as they enroll.
