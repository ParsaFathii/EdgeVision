# EdgeVision — App Screenshots

The PNG files in this directory are real captures of the running application —
the Next.js dashboard on `:3000` with the engine service on `:3003` and at
least one active stream session. They are captured headlessly with an
automated browser (Playwright / agent-browser) at a **1440×900** viewport,
dark theme, Persian (`fa-IR`) locale. No mockups or composites.

The PNGs themselves are committed by the release process (they are generated
from a live dev instance, so they are not part of any source task).

| File | Shows |
| --- | --- |
| `overview.png` | نمای کلی — health chip, KPI cards, active streams, recent events, quick-start |
| `streams.png` | استریم‌های زنده — stream list with status badges and the create dialog |
| `stream-detail-live.png` | جزئیات استریم — live session: LiveScene renderer with detection boxes, ROI and crossing line, live metric cards, detection feed |
| `detections.png` | کاوشگر تشخیص — filters (label, confidence), confidence bars, paginated table |
| `events.png` | رویدادها — type filters, Persian event sentences, expandable JSON payloads |
| `analytics.png` | تحلیل‌ها — per-class chart, FPS history chart, session table |
| `models.png` | مدل‌ها — model registry cards with the active-model switch |
| `sessions.png` | نشست‌ها — session history with states, durations and totals |
| `settings.png` | تنظیمات — default pipeline sliders, display preferences, about panel |

Capture tool note: Playwright / agent-browser, 1440×900, waiting for socket
connection and at least one live frame before each shot.

© 2026 Parsa Fathi — Apache-2.0.
