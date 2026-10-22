---
kind: guide
slug: web-filtering
title: Block websites by category or domain
excerpt: How the Web Gateway applies your policy to every request, in every browser, on any network, and how to test a URL first.
category: Policies and controls
tags: web gateway, web filtering, categories, url checker
author: Aavishield team
seo_title: Web Filtering by Category and Domain
seo_description: Block social media, gambling, AI tools and more by category, add custom allow and block lists, and test any URL before it is visited.
order: 10
published: 2026-10-20
---
The Web Gateway applies your category and domain policy to every request a device makes, in every browser and on any network.

## Category blocking

Switch categories on per policy, for example:

- Social media
- AI tools
- Gambling
- Sensitive banking or government sites

## Custom allow and block lists

Admins can add any domain to a custom allow or block list. Devices pick up the change on their next policy pull.

## Test a URL first

Not sure what a rule will do? The **URL checker** in the console shows what would happen to a URL and which policy decides it, before anyone visits it.

## Everything is logged

Both allowed and blocked visits are recorded against the employee and device that made them.

## How it works under the hood

The agent runs a local HTTPS proxy with a per-organisation certificate, so it can apply web policy and inspect uploads for DLP. The certificate authority key is stored encrypted, and sensitive services that break under inspection are passed through untouched.

## Related

- [Personal VPN and proxy blocking](/knowledge-hub/vpn-and-proxy-blocking)
- [How DLP works](/knowledge-hub/how-dlp-works)
