// EdgeVision — داشبورد تحلیل بلادرنگ
// Copyright © 2026 Parsa Fathi — Apache-2.0

// حالت‌های مشترک همهٔ نماها: بارگذاری، خطا + تلاش دوباره، خالی بودن.

'use client';

import type { ReactNode } from 'react';
import { CloudOff, Inbox, RotateCw, TriangleAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { btn } from './styles';

export function LoadingView({ label = 'در حال بارگذاری…' }: { label?: string }) {
  return (
    <div className="space-y-4" role="status" aria-label={label}>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Card key={i} className="border-zinc-800 bg-zinc-900/70">
            <CardContent className="space-y-3 p-4">
              <Skeleton className="h-4 w-24 bg-zinc-800" />
              <Skeleton className="h-8 w-16 bg-zinc-800" />
              <Skeleton className="h-3 w-32 bg-zinc-800/70" />
            </CardContent>
          </Card>
        ))}
      </div>
      <Card className="border-zinc-800 bg-zinc-900/70">
        <CardContent className="space-y-3 p-4">
          <Skeleton className="h-[220px] w-full bg-zinc-800/70" />
        </CardContent>
      </Card>
      <p className="text-center text-sm text-zinc-500">{label}</p>
    </div>
  );
}

export function ErrorView({
  message,
  onRetry,
  hint,
}: {
  message: string;
  onRetry?: () => void;
  hint?: ReactNode;
}) {
  return (
    <Card className="border-zinc-800 bg-zinc-900/70" role="alert">
      <CardContent className="flex flex-col items-center gap-4 p-8 text-center">
        <div className="flex size-12 items-center justify-center rounded-full border border-rose-900/60 bg-rose-950/40">
          <CloudOff className="size-6 text-rose-400" aria-hidden="true" />
        </div>
        <div className="space-y-1">
          <p className="font-medium text-zinc-100">داده‌ها دریافت نشد</p>
          <p className="text-sm text-zinc-400">{message}</p>
          {hint}
        </div>
        {onRetry && (
          <Button onClick={onRetry} variant="outline" className={`min-h-11 ${btn.outline}`}>
            <RotateCw className="size-4" aria-hidden="true" />
            تلاش دوباره
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

export function EmptyState({
  icon: Icon = Inbox,
  title,
  description,
  action,
}: {
  icon?: typeof Inbox;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <Card className="border-dashed border-zinc-800 bg-zinc-900/40">
      <CardContent className="flex flex-col items-center gap-4 p-10 text-center">
        <div className="flex size-12 items-center justify-center rounded-full border border-zinc-700 bg-zinc-800/60">
          <Icon className="size-6 text-zinc-400" aria-hidden="true" />
        </div>
        <div className="max-w-md space-y-1">
          <p className="font-medium text-zinc-200">{title}</p>
          {description && <p className="text-sm leading-6 text-zinc-500">{description}</p>}
        </div>
        {action}
      </CardContent>
    </Card>
  );
}

/** نوار «در انتظار…» برای بخش‌هایی که هنوز دادهٔ زنده دریافت نکرده‌اند. */
export function WaitingHint({ text }: { text: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-8 text-sm text-zinc-500">
      <TriangleAlert className="size-4 text-amber-500/70" aria-hidden="true" />
      {text}
    </div>
  );
}
