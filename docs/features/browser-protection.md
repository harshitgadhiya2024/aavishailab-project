# Browser protection on activation

A browser that was already running when protection turns on keeps every
connection it already had open — a reload reuses them, so pointing the
system proxy at the agent doesn't bring those connections under
inspection. In practice this meant Web Gateway and DLP silently did
nothing on any tab open before install (or before working hours started,
or before a Disconnect ended), until the browser was manually quit and
reopened.

There is no way to make another process drop its own sockets, so the fix
is: when the agent turns the system proxy on **from fully off** — install,
login, working hours starting, a Disconnect ending — it closes every
browser running at that moment and tells the person why, via a desktop
notification. It is not reopened automatically; the next time the person
opens it, every connection goes through the agent.

- Covered: Chrome, Edge, Brave, Safari, Firefox, Arc, Opera, Vivaldi,
  Chromium, Comet.
- Only a browser's own main process is matched — its helper/renderer
  processes go down with it, and an app merely built on a browser engine
  (Microsoft Teams, Slack, VS Code) is never touched.
- SIGTERM first (the same signal Quit sends, so the browser keeps its
  session); anything still alive after 3 seconds is killed.
- Covering a newly added network connection (e.g. plugging in Ethernet)
  does **not** close anything — this only fires on the off→on transition,
  since every other connection was already covered.

This single fix closed the false-negative gap in both
[web-gateway.md](web-gateway.md) and [dlp.md](dlp.md) — it was one root
cause, not two separate bugs.
