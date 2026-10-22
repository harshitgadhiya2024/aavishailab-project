---
kind: guide
slug: how-we-protect-your-data
title: How we protect your data
excerpt: Signed policy, per-company isolation, encrypted keys, signed links and data residency. The safeguards built into Aavishield.
category: Security and trust
tags: security, ed25519, isolation, data residency, signed links
author: Aavishield team
seo_title: How Aavishield Protects Your Data
seo_description: Signed Ed25519 policy, per-organisation isolation, encrypted certificate keys, short-lived signed links and data residency.
order: 50
published: 2026-10-20
---
Aavishield sees sensitive traffic on your devices, so it has to earn trust first. These safeguards are built in from day one.

## Signed policy

Policy bundles are signed with **Ed25519** and verified on the device before they are enforced. An agent only ever enforces policy that came from your console.

## Isolated per company

Every organisation's policy, devices and findings are scoped to that organisation and never mixed.

## Encrypted keys

Per-organisation certificate authority keys are stored encrypted at rest.

## Short-lived signed links

Screenshots and files are served only through short-lived signed links, visible to admins of the same organisation.

## Internal services

Internal scanning services only accept requests carrying a shared secret, and are never open to the internet.

## Data residency

You can keep employee data in your own database and storage bucket, set from Settings.

## Your data is yours

Personal data is never sold or used for advertising. Access is restricted to what is needed to operate and support the service.

## Reporting a vulnerability

Email info@aavishailab.com with details. We will acknowledge your report and keep you updated while we investigate.
