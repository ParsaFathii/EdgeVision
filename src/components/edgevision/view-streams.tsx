// EdgeVision — داشبورد تحلیل بلادرنگ
// Copyright © 2026 Parsa Fathi — Apache-2.0

// استریم‌های زنده — شبکهٔ کارت‌ها با شروع/توقف/جزئیات/حذف + افزودن استریم.

'use client';

import { useState } from 'react';
import {
  Eye,
  Loader2,
  Play,
  Plus,
  Radio,
  Square,
  Trash2,
} from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import { useFmt } from '@/hooks/edgevision/use-num';
import { usePolling } from '@/hooks/edgevision/use-polling';
import { api, errMessageFa } from '@/lib/edgevision/api';
import { jalali, sceneLabelFa } from '@/lib/edgevision/format';
import type { Settings, StreamWithSession } from '@/lib/edgevision/types';
import { SessionStateBadge, StreamStatusBadge } from './shared/badges';
import { Lift, PageHeader } from './shared/cards';
import { EmptyState, ErrorView, LoadingView } from './shared/state-views';
import { btn } from './shared/styles';
import type { Nav } from './shared/nav';
import { StreamEditor } from './stream-editor';

const ACTIVE_STATES = ['RUNNING', 'STARTING', 'DEGRADED'];

function isActive(s: StreamWithSession): boolean {
  if (s.activeSession && ACTIVE_STATES.includes(s.activeSession.state)) return true;
  return s.status === 'RUNNING' || s.status === 'STARTING';
}

export function ViewStreams({ nav }: { nav: Nav }) {
  const { toast } = useToast();
  const fmt = useFmt();
  const streams = usePolling(() => api.streams(), { intervalMs: 5000 });
  const settings = usePolling(() => api.settings(), {});

  const [busyId, setBusyId] = useState<string | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [stopTarget, setStopTarget] = useState<StreamWithSession | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<StreamWithSession | null>(null);

  const startStream = async (s: StreamWithSession) => {
    setBusyId(s.id);
    try {
      await api.startStream(s.id);
      toast({ title: 'پردازش آغاز شد', description: `پردازش استریم «${s.name}» آغاز شد.` });
      streams.refresh();
    } catch (err) {
      toast({ title: 'شروع پردازش ممکن نشد', description: errMessageFa(err), variant: 'destructive' });
      streams.refresh();
    } finally {
      setBusyId(null);
    }
  };

  const stopStream = async (s: StreamWithSession) => {
    setStopTarget(null);
    setBusyId(s.id);
    try {
      await api.stopStream(s.id);
      toast({ title: 'پردازش متوقف شد', description: `نشست استریم «${s.name}» متوقف شد.` });
      streams.refresh();
    } catch (err) {
      toast({ title: 'توقف پردازش ممکن نشد', description: errMessageFa(err), variant: 'destructive' });
      streams.refresh();
    } finally {
      setBusyId(null);
    }
  };

  const deleteStream = async (s: StreamWithSession) => {
    setDeleteTarget(null);
    setBusyId(s.id);
    try {
      await api.deleteStream(s.id);
      toast({ title: 'استریم حذف شد', description: `استریم «${s.name}» و تاریخچه‌اش حذف شد.` });
      streams.refresh();
    } catch (err) {
      toast({ title: 'حذف ممکن نشد', description: errMessageFa(err), variant: 'destructive' });
      streams.refresh();
    } finally {
      setBusyId(null);
    }
  };

  if (streams.loading) {
    return (
      <div className="space-y-6">
        <PageHeader title="استریم‌های زنده" description="منابع ویدئویی ثبت‌شده و وضعیت اجرای آن‌ها" />
        <LoadingView />
      </div>
    );
  }

  if (!streams.data && streams.error) {
    return (
      <div className="space-y-6">
        <PageHeader title="استریم‌های زنده" />
        <ErrorView message={streams.error} onRetry={streams.refresh} />
      </div>
    );
  }

  const items = streams.data?.items ?? [];

  if (items.length === 0) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="استریم‌های زنده"
          description="منابع ویدئویی ثبت‌شده و وضعیت اجرای آن‌ها"
          actions={
            <Button onClick={() => setEditorOpen(true)} className={`min-h-11 ${btn.primary}`}>
              <Plus className="size-4" aria-hidden="true" />
              افزودن استریم
            </Button>
          }
        />
        <EmptyState
          icon={Radio}
          title="هنوز هیچ استریمی ثبت نشده است"
          description="اولین منبع ویدئویی خود را اضافه کنید."
          action={
            <Button onClick={() => setEditorOpen(true)} className={`min-h-11 ${btn.primary}`}>
              <Plus className="size-4" aria-hidden="true" />
              افزودن استریم
            </Button>
          }
        />
        <StreamEditor
          open={editorOpen}
          onOpenChange={setEditorOpen}
          mode="create"
          defaults={(settings.data as Settings | null) ?? null}
          onSaved={() => streams.refresh()}
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="استریم‌های زنده"
        description={`منابع ویدئویی ثبت‌شده و وضعیت اجرای آن‌ها — ${fmt.num(items.length)} استریم`}
        actions={
          <Button onClick={() => setEditorOpen(true)} className={`min-h-11 ${btn.primary}`}>
            <Plus className="size-4" aria-hidden="true" />
            افزودن استریم
          </Button>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {items.map((s) => {
          const busy = busyId === s.id;
          const active = isActive(s);
          return (
            <Lift key={s.id} className="h-full">
              <Card className="flex h-full flex-col border-zinc-800 bg-zinc-900/70 transition-colors hover:border-zinc-700">
                <CardContent className="flex flex-1 flex-col gap-3 p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <h3 className="truncate font-medium text-zinc-100">{s.name}</h3>
                      <p className="mt-1 text-xs text-zinc-500">
                        صحنهٔ {sceneLabelFa(s.scene)} · {fmt.num(s.width)}×{fmt.num(s.height)} ·{' '}
                        {fmt.num(s.targetFps)} فریم بر ثانیه
                      </p>
                    </div>
                    <StreamStatusBadge status={s.status} />
                  </div>

                  <p className="text-xs text-zinc-500">ثبت‌شده در {jalali(s.createdAt)}</p>

                  {s.activeSession ? (
                    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-950/50 px-2.5 py-2">
                      <SessionStateBadge state={s.activeSession.state} />
                      <span className="tnum text-xs text-zinc-500">
                        {fmt.num(s.activeSession.framesProcessed)} فریم پردازش‌شده
                      </span>
                    </div>
                  ) : (
                    <div className="rounded-lg border border-dashed border-zinc-800 px-2.5 py-2 text-xs text-zinc-600">
                      نشست فعالی ندارد
                    </div>
                  )}

                  <div className="mt-auto flex flex-wrap items-center gap-2 pt-1">
                    {active ? (
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={busy}
                        onClick={() => setStopTarget(s)}
                        aria-label={`توقف پردازش ${s.name}`}
                        className={`min-h-11 ${btn.outline}`}
                      >
                        {busy ? (
                          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                        ) : (
                          <Square className="size-4" aria-hidden="true" />
                        )}
                        توقف پردازش
                      </Button>
                    ) : (
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={busy}
                        onClick={() => startStream(s)}
                        aria-label={`شروع پردازش ${s.name}`}
                        className={`min-h-11 ${btn.primary}`}
                      >
                        {busy ? (
                          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                        ) : (
                          <Play className="size-4" aria-hidden="true" />
                        )}
                        شروع پردازش
                      </Button>
                    )}
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => nav.navigate('stream-detail', { streamId: s.id, streamName: s.name })}
                      aria-label={`جزئیات ${s.name}`}
                      className={`min-h-11 ${btn.outline}`}
                    >
                      <Eye className="size-4" aria-hidden="true" />
                      جزئیات
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={busy}
                      onClick={() => setDeleteTarget(s)}
                      aria-label={`حذف ${s.name}`}
                      className={`min-h-11 min-w-11 ${btn.ghost} hover:text-rose-300`}
                    >
                      <Trash2 className="size-4" aria-hidden="true" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </Lift>
          );
        })}
      </div>

      <StreamEditor
        open={editorOpen}
        onOpenChange={setEditorOpen}
        mode="create"
        defaults={(settings.data as Settings | null) ?? null}
        onSaved={() => streams.refresh()}
      />

      <AlertDialog open={stopTarget !== null} onOpenChange={(o) => !o && setStopTarget(null)}>
        <AlertDialogContent className="border-zinc-800 bg-zinc-950">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-zinc-50">توقف پردازش</AlertDialogTitle>
            <AlertDialogDescription className="text-zinc-400">
              نشست فعال این استریم متوقف شود؟ داده‌های ثبت‌شده حفظ می‌شوند اما پایش زنده قطع خواهد شد.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2">
            <AlertDialogCancel className={`min-h-11 ${btn.outline}`}>انصراف</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => stopTarget && stopStream(stopTarget)}
              className={`min-h-11 ${btn.danger}`}
            >
              توقف پردازش
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
      >
        <AlertDialogContent className="border-zinc-800 bg-zinc-950">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-zinc-50">حذف استریم</AlertDialogTitle>
            <AlertDialogDescription className="text-zinc-400">
              این استریم و همه تاریخچه‌اش حذف شود؟ این کار برگشت‌پذیر نیست.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2">
            <AlertDialogCancel className={`min-h-11 ${btn.outline}`}>انصراف</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteTarget && deleteStream(deleteTarget)}
              className={`min-h-11 ${btn.danger}`}
            >
              حذف قطعی
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
