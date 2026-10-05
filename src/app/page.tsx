// EdgeVision — داشبورد تحلیل بلادرنگ
// Copyright © 2026 Parsa Fathi — Apache-2.0

// پوستهٔ اپ — ناوبری کناری، نوار بالا (سلامت، اتصال، ساعت جلالی) و پانویس چسبان.

'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  BarChart3,
  BellRing,
  Boxes,
  Crosshair,
  History,
  LayoutDashboard,
  Menu,
  MonitorPlay,
  Radio,
  ScanLine,
  Settings,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { cn } from '@/lib/utils';
import { api } from '@/lib/edgevision/api';
import { useDisplayPrefs } from '@/lib/edgevision/prefs';
import { useSocketStatus } from '@/lib/edgevision/socket';
import { usePolling } from '@/hooks/edgevision/use-polling';
import { ViewAnalytics } from '@/components/edgevision/view-analytics';
import { ViewDetections } from '@/components/edgevision/view-detections';
import { ViewEvents } from '@/components/edgevision/view-events';
import { ViewModels } from '@/components/edgevision/view-models';
import { ViewOverview } from '@/components/edgevision/view-overview';
import { ViewSessions } from '@/components/edgevision/view-sessions';
import { ViewSettings } from '@/components/edgevision/view-settings';
import { ViewStreamDetail } from '@/components/edgevision/view-stream-detail';
import { ViewStreams } from '@/components/edgevision/view-streams';
import { EmptyState } from '@/components/edgevision/shared/state-views';
import { btn } from '@/components/edgevision/shared/styles';
import type { ViewId } from '@/components/edgevision/shared/nav';

const NAV_ITEMS: { id: ViewId; label: string; icon: LucideIcon }[] = [
  { id: 'overview', label: 'نمای کلی', icon: LayoutDashboard },
  { id: 'streams', label: 'استریم‌های زنده', icon: Radio },
  { id: 'stream-detail', label: 'جزئیات استریم', icon: MonitorPlay },
  { id: 'detections', label: 'کاوشگر تشخیص', icon: Crosshair },
  { id: 'events', label: 'رویدادها', icon: BellRing },
  { id: 'analytics', label: 'تحلیل‌ها', icon: BarChart3 },
  { id: 'models', label: 'مدل‌ها', icon: Boxes },
  { id: 'sessions', label: 'نشست‌ها', icon: History },
  { id: 'settings', label: 'تنظیمات', icon: Settings },
];

const VALID_VIEWS = new Set<string>(NAV_ITEMS.map((i) => i.id));

const VIEW_STORAGE_KEY = 'edgevision:view';
const STREAM_STORAGE_KEY = 'edgevision:stream';

function NavButton({
  item,
  active,
  disabled,
  subtitle,
  onClick,
}: {
  item: { id: ViewId; label: string; icon: LucideIcon };
  active: boolean;
  disabled?: boolean;
  subtitle?: string | null;
  onClick: () => void;
}) {
  const Icon = item.icon;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-current={active ? 'page' : undefined}
      aria-disabled={disabled}
      className={cn(
        'flex min-h-11 w-full items-center gap-3 rounded-md px-3 py-2 text-start text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40',
        active
          ? 'bg-emerald-500/10 font-medium text-emerald-400'
          : 'text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200',
        disabled && 'cursor-not-allowed opacity-50 hover:bg-transparent hover:text-zinc-400',
      )}
    >
      <Icon className="size-4 shrink-0" aria-hidden="true" />
      <span className="min-w-0 flex-1">
        <span className="block truncate leading-5">{item.label}</span>
        {subtitle && (
          <span className="block truncate text-[11px] leading-4 text-zinc-600">{subtitle}</span>
        )}
      </span>
    </button>
  );
}

function NavList({
  view,
  streamId,
  streamName,
  onNavigate,
}: {
  view: ViewId;
  streamId: string | null;
  streamName: string | null;
  onNavigate: (v: ViewId) => void;
}) {
  return (
    <nav className="flex-1 space-y-1 overflow-y-auto p-3 thin-scroll" aria-label="ناوبری اصلی">
      {NAV_ITEMS.map((item) => (
        <NavButton
          key={item.id}
          item={item}
          active={view === item.id}
          disabled={item.id === 'stream-detail' && !streamId && view !== 'stream-detail'}
          subtitle={item.id === 'stream-detail' && streamId ? streamName : null}
          onClick={() => onNavigate(item.id)}
        />
      ))}
    </nav>
  );
}

function HealthChip() {
  const health = usePolling(() => api.health(), { intervalMs: 10000 });
  let dot = 'bg-zinc-600';
  let text = 'در حال بررسی…';
  let title = 'وضعیت سلامت سرویس';
  if (health.data) {
    if (health.data.status === 'ok') {
      dot = 'bg-emerald-400';
      text = 'سلامت: سالم';
      title = health.data.engine ? 'موتور پردازش در دسترس است' : 'سرویس پردازش در دسترس نیست';
    } else {
      dot = 'bg-amber-400';
      text = 'سلامت: افت سرویس';
      title = health.data.engineBinary
        ? 'سرویس با افت کیفیت پاسخ می‌دهد'
        : 'سرویس پردازش در دسترس نیست';
    }
  } else if (health.error) {
    dot = 'bg-rose-500';
    text = 'سرور در دسترس نیست';
    title = health.error;
  }
  return (
    <span
      title={title}
      className="flex items-center gap-1.5 rounded-md border border-zinc-800 bg-zinc-900/70 px-2 py-1 text-[11px] text-zinc-300"
    >
      <span className={cn('size-1.5 rounded-full', dot)} aria-hidden="true" />
      {text}
      <span className="sr-only">وضعیت سلامت سرویس: {text}</span>
    </span>
  );
}

function SocketChip() {
  const { status } = useSocketStatus();
  const map: Record<string, { dot: string; text: string }> = {
    connected: { dot: 'bg-emerald-400', text: 'متصل' },
    connecting: { dot: 'bg-amber-400 animate-pulse', text: 'در حال اتصال…' },
    reconnecting: { dot: 'bg-amber-400 animate-pulse', text: 'در حال اتصال مجدد…' },
    disconnected: { dot: 'bg-rose-500', text: 'اتصال برقرار نشد' },
  };
  const s = map[status] ?? map.connecting;
  return (
    <span
      title="وضعیت اتصال بلادرنگ (WebSocket)"
      className="flex items-center gap-1.5 rounded-md border border-zinc-800 bg-zinc-900/70 px-2 py-1 text-[11px] text-zinc-300"
    >
      <span className={cn('size-1.5 rounded-full', s.dot)} aria-hidden="true" />
      {s.text}
      <span className="sr-only">وضعیت اتصال بلادرنگ: {s.text}</span>
    </span>
  );
}

function Clock() {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    const tick = () => setNow(new Date());
    const first = setTimeout(tick, 0);
    const id = setInterval(tick, 1000);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, []);
  const time = now
    ? new Intl.DateTimeFormat('fa-IR-u-ca-persian', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
      }).format(now)
    : '--:--:--';
  const date = now
    ? new Intl.DateTimeFormat('fa-IR-u-ca-persian', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
      }).format(now)
    : '…';
  return (
    <div className="hidden flex-col items-end leading-tight md:flex" aria-live="off">
      <span className="tnum text-sm font-medium text-zinc-200">{time}</span>
      <span className="text-[11px] text-zinc-500">{date}</span>
    </div>
  );
}

export default function EdgeVisionApp() {
  const [view, setView] = useState<ViewId>('overview');
  const [streamId, setStreamId] = useState<string | null>(null);
  const [streamName, setStreamName] = useState<string | null>(null);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  const prefs = useDisplayPrefs();

  useEffect(() => {
    prefs.hydrate();
  }, [prefs]);

  // بازیابی نما/استریم از نشانی صفحه یا حافظهٔ مرورگر
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const fromUrl = params.get('view');
    let nextView: ViewId | null = null;
    if (fromUrl && VALID_VIEWS.has(fromUrl)) {
      nextView = fromUrl as ViewId;
    } else {
      const saved = window.localStorage.getItem(VIEW_STORAGE_KEY);
      if (saved && VALID_VIEWS.has(saved)) nextView = saved as ViewId;
    }
    const streamParam = params.get('stream') ?? window.localStorage.getItem(STREAM_STORAGE_KEY);
    // اعمال با یک تیک تأخیر تا رندر اولیه با سرور هم‌خوان بماند.
    const apply = () => {
      if (streamParam && streamParam.trim() !== '') setStreamId(streamParam);
      if (nextView) setView(nextView);
      setHydrated(true);
    };
    const t = setTimeout(apply, 0);
    return () => clearTimeout(t);
  }, []);

  const navigate = useCallback(
    (nextView: ViewId, opts?: { streamId?: string; streamName?: string }) => {
      setView(nextView);
      setMobileNavOpen(false);
      if (opts?.streamId !== undefined) {
        setStreamId(opts.streamId || null);
        try {
          if (opts.streamId) window.localStorage.setItem(STREAM_STORAGE_KEY, opts.streamId);
          else window.localStorage.removeItem(STREAM_STORAGE_KEY);
        } catch {
          /* حافظهٔ مرورگر در دسترس نیست */
        }
      }
      if (opts?.streamName !== undefined) setStreamName(opts.streamName);
      try {
        window.localStorage.setItem(VIEW_STORAGE_KEY, nextView);
      } catch {
        /* بی‌خیال */
      }
      const q = new URLSearchParams();
      if (nextView !== 'overview') q.set('view', nextView);
      const activeStream = opts?.streamId !== undefined ? opts.streamId : streamId;
      if (nextView === 'stream-detail' && activeStream) q.set('stream', activeStream);
      const qs = q.toString();
      window.history.replaceState(null, '', qs ? `/?${qs}` : '/');
    },
    [streamId],
  );

  const nav = useMemo(() => ({ navigate }), [navigate]);

  const renderView = () => {
    switch (view) {
      case 'overview':
        return <ViewOverview nav={nav} />;
      case 'streams':
        return <ViewStreams nav={nav} />;
      case 'stream-detail':
        return streamId ? (
          <ViewStreamDetail key={streamId} streamId={streamId} nav={nav} />
        ) : (
          <EmptyState
            icon={MonitorPlay}
            title="هنوز استریمی انتخاب نشده است"
            description="از فهرست استریم‌ها، استریم مورد نظر را باز کنید تا صحنهٔ زنده و سنجه‌هایش را این‌جا ببینید."
          />
        );
      case 'detections':
        return <ViewDetections nav={nav} />;
      case 'events':
        return <ViewEvents nav={nav} />;
      case 'analytics':
        return <ViewAnalytics nav={nav} />;
      case 'models':
        return <ViewModels />;
      case 'sessions':
        return <ViewSessions nav={nav} />;
      case 'settings':
        return <ViewSettings />;
      default:
        return <ViewOverview nav={nav} />;
    }
  };

  const viewKey = view === 'stream-detail' ? `stream-detail-${streamId}` : view;

  return (
    <div className="flex min-h-screen flex-col bg-zinc-950 text-zinc-100">
      <div className="flex flex-1">
        {/* ناوبری کناری — دسکتاپ */}
        <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-e border-zinc-800 bg-zinc-950 lg:flex">
          <div className="flex h-14 items-center gap-2.5 border-b border-zinc-800 px-4">
            <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-emerald-600">
              <ScanLine className="size-4 text-zinc-950" aria-hidden="true" />
            </div>
            <div className="min-w-0 leading-tight">
              <p className="truncate text-sm font-semibold text-zinc-50" dir="ltr">EdgeVision</p>
              <p className="truncate text-[10px] text-zinc-500">تحلیل ویدئوی بلادرنگ</p>
            </div>
          </div>
          <NavList
            view={view}
            streamId={streamId}
            streamName={streamName}
            onNavigate={(v) => navigate(v)}
          />
          <div className="border-t border-zinc-800 px-4 py-3 text-[10px] leading-5 text-zinc-600">
            نسخهٔ ۱٫۰٫۰ · مجوز Apache-2.0
            <br />
            © ۲۰۲۶ پارسا فتحی
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          {/* نوار بالا */}
          <header className="sticky top-0 z-40 border-b border-zinc-800 bg-zinc-950/90 backdrop-blur">
            <div className="flex h-14 items-center gap-3 px-4 sm:px-6">
              <Button
                variant="ghost"
                size="sm"
                className={`size-11 shrink-0 p-0 lg:hidden ${btn.ghost}`}
                onClick={() => setMobileNavOpen(true)}
                aria-label="باز کردن منوی ناوبری"
              >
                <Menu className="size-5" aria-hidden="true" />
              </Button>

              <div className="flex min-w-0 items-center gap-2.5 lg:hidden">
                <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-emerald-600">
                  <ScanLine className="size-4 text-zinc-950" aria-hidden="true" />
                </div>
                <div className="min-w-0 leading-tight">
                  <p className="truncate text-sm font-semibold text-zinc-50" dir="ltr">EdgeVision</p>
                  <p className="truncate text-[10px] text-zinc-500">پلتفرم تحلیل ویدئوی بلادرنگ</p>
                </div>
              </div>

              <p className="hidden min-w-0 truncate text-sm text-zinc-500 lg:block">
                پلتفرم تحلیل ویدئوی بلادرنگ
              </p>

              <div className="ms-auto flex items-center gap-2">
                <SocketChip />
                <HealthChip />
                <Clock />
              </div>
            </div>
          </header>

          {/* محتوای نما */}
          <main className="flex-1" id="main-content">
            <div
              className={cn(
                'mx-auto w-full max-w-7xl px-4 sm:px-6',
                hydrated ? (prefs.compact ? 'py-4' : 'py-6') : 'py-6',
              )}
            >
              <AnimatePresence mode="wait" initial={false}>
                <motion.div
                  key={viewKey}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  transition={{ duration: 0.15, ease: 'easeOut' }}
                >
                  {renderView()}
                </motion.div>
              </AnimatePresence>
            </div>
          </main>

          {/* پانویس چسبان */}
          <footer
            className="mt-auto border-t border-zinc-800 bg-zinc-950"
            style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}
          >
            <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-center gap-x-2 gap-y-1 px-4 py-3 text-center text-[11px] leading-5 text-zinc-600 sm:px-6">
              <span dir="ltr" className="font-medium text-zinc-500">EdgeVision</span>
              <span aria-hidden="true">—</span>
              <span>© ۲۰۲۶ پارسا فتحی</span>
              <span aria-hidden="true">·</span>
              <span>مجوز Apache-2.0</span>
              <span aria-hidden="true">·</span>
              <span className="tnum">نسخه ۱٫۰٫۰</span>
            </div>
          </footer>
        </div>
      </div>

      {/* ناوبری موبایل */}
      <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
        <SheetContent side="right" className="w-72 border-zinc-800 bg-zinc-950 p-0">
          <SheetHeader className="border-b border-zinc-800">
            <SheetTitle className="flex items-center gap-2.5 text-zinc-50">
              <span className="flex size-8 items-center justify-center rounded-lg bg-emerald-600">
                <ScanLine className="size-4 text-zinc-950" aria-hidden="true" />
              </span>
              <span dir="ltr">EdgeVision</span>
            </SheetTitle>
            <SheetDescription className="text-zinc-500">پلتفرم تحلیل ویدئوی بلادرنگ</SheetDescription>
          </SheetHeader>
          <NavList
            view={view}
            streamId={streamId}
            streamName={streamName}
            onNavigate={(v) => navigate(v)}
          />
          <div className="border-t border-zinc-800 px-4 py-3 text-[10px] leading-5 text-zinc-600">
            نسخهٔ ۱٫۰٫۰ · مجوز Apache-2.0
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
