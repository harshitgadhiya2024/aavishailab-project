---
kind: guide
slug: agent-updates-and-offline-devices
title: Agent updates and offline devices
excerpt: The agent updates itself, keeps enforcing policy offline, and cannot be removed without admin approval.
category: Devices and agent
tags: agent, updates, offline, uninstall
author: Aavishield team
seo_title: Agent Updates, Offline Devices and Uninstalling
seo_description: How the Aavishield agent updates, what happens when a laptop is offline, and how uninstalls are approved and recorded.
order: 31
published: 2026-10-20
---
## Automatic updates

Native installers support automatic updates. You never need to reinstall the agent to get a new version.

## When a device is offline

The agent keeps enforcing the **last signed policy** it received. Events are stored and reported when the device reconnects.

## Policy changes

When an admin changes policy, devices pick it up on their next policy pull. Every policy bundle is signed with Ed25519 and verified on the device before it is enforced.

## Uninstalling

Uninstalling requires admin approval, and the uninstall is recorded in the console. An employee cannot quietly remove protection.
