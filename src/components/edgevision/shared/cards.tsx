// EdgeVision — داشبورد تحلیل بلادرنگ
// Copyright © 2026 Parsa Fathi — Apache-2.0

// کارت شاخص (KPI) + کارت سنجهٔ زنده + کارت بخش با عنوان.

'use client';

import type { ReactNode } from 'react';
import { motion } from 'framer-motion';
import type { LucideIcon } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';

/** حرکت ظریف هاور: یک پیکسل بالا + روشن‌تر شدن لبه. */
export function Lift({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <motion.div
      whileHover={{ y: -1 }}
      transition={{ duration: 0.15, ease: 'easeOut' }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

export function StatCard({
  icon: Icon,
  label,
  value,
  sub,
  tone = 'default',
}: {
  icon: LucideIcon;
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  tone?: 'default' | 'live' | 'warn';
}) {
  const iconTone =
    tone === 'live'
      ? 'border-emerald-900/60 bg-emerald-950/40 text-emerald-400'
      : tone === 'warn'
        ? 'border-amber-900/60 bg-amber-950/40 text-amber-400'
        : 'border-zinc-700/80 bg-zinc-800/60 text-zinc-400';
  return (
    <Lift>
      <Card className="group h-full border-zinc-800 bg-zinc-900/70 transition-colors hover:border-zinc-700">
        <CardContent className="flex items-start justify-between gap-3 p-4">
          <div className="min-w-0 space-y-1.5">
            <p className="text-sm text-zinc-400">{label}</p>
            <p className="tnum text-2xl font-semibold leading-none text-zinc-50">{value}</p>
            {sub && <p className="truncate text-xs text-zinc-500">{sub}</p>}
          </div>
          <div className={cn('flex size-9 shrink-0 items-center justify-center rounded-lg border', iconTone)}>
            <Icon className="size-4.5" aria-hidden="true" />
          </div>
        </CardContent>
      </Card>
    </Lift>
  );
}

/** کارت سنجهٔ زندهٔ فشرده (شبکهٔ سنجه‌های جزئیات استریم و نمای کلی). */
export function MetricCard({
  label,
  value,
  sub,
  warn,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  warn?: boolean;
}) {
  return (
    <div
      className={cn(
        'rounded-lg border bg-zinc-900/60 p-3',
        warn ? 'border-amber-900/50' : 'border-zinc-800',
      )}
    >
      <p className="text-xs text-zinc-500">{label}</p>
      <p className={cn('tnum mt-1 text-lg font-semibold leading-none', warn ? 'text-amber-300' : 'text-zinc-100')}>
        {value}
      </p>
      {sub && <p className="tnum mt-1 text-[11px] text-zinc-500">{sub}</p>}
    </div>
  );
}

export function SectionCard({
  title,
  description,
  action,
  children,
  className,
  contentClassName,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  contentClassName?: string;
}) {
  return (
    <Card className={cn('border-zinc-800 bg-zinc-900/70', className)}>
      <CardHeader className="flex-row items-center justify-between space-y-0 pb-3">
        <div className="space-y-0.5">
          <CardTitle className="text-base font-medium text-zinc-100">{title}</CardTitle>
          {description && <p className="text-xs text-zinc-500">{description}</p>}
        </div>
        {action}
      </CardHeader>
      <CardContent className={contentClassName}>{children}</CardContent>
    </Card>
  );
}

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold text-zinc-50">{title}</h1>
        {description && <p className="mt-1 text-sm text-zinc-500">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
