// EdgeVision — کلاینت موبایل
// Copyright © 2026 Parsa Fathi — Apache-2.0

import 'package:flutter/material.dart';

import '../api/client.dart';
import '../utils/persian.dart';
import '../utils/theme.dart';
import '../ws/ws_service.dart';

// — — — نمای‌های وضعیت مشترک (بارگذاری/خطا/خالی) — — —

/// نمای «در حال دریافت».
class LoadingView extends StatelessWidget {
  const LoadingView({super.key, this.label = 'در حال دریافت…'});

  final String label;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          const CircularProgressIndicator(strokeWidth: 2.5),
          const SizedBox(height: 14),
          Text(
            label,
            style: const TextStyle(color: EvColors.textMedium, fontSize: 13),
          ),
        ],
      ),
    );
  }
}

/// نمای خطا با دکمهٔ «تلاش دوباره».
class ErrorView extends StatelessWidget {
  const ErrorView({super.key, required this.message, required this.onRetry});

  final String message;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(Icons.cloud_off, size: 40, color: EvColors.danger),
            const SizedBox(height: 12),
            Text(
              message,
              textAlign: TextAlign.center,
              style: const TextStyle(
                color: EvColors.textHigh,
                fontSize: 14,
                fontWeight: FontWeight.w600,
              ),
            ),
            const SizedBox(height: 16),
            OutlinedButton.icon(
              onPressed: onRetry,
              icon: const Icon(Icons.refresh, size: 18),
              label: const Text('تلاش دوباره'),
            ),
          ],
        ),
      ),
    );
  }
}

/// نمای «موردی یافت نشد» / حالت خالی.
class EmptyView extends StatelessWidget {
  const EmptyView({
    super.key,
    required this.message,
    this.hint,
    this.icon = Icons.inbox_outlined,
  });

  final String message;
  final String? hint;
  final IconData icon;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(icon, size: 40, color: EvColors.textLow),
            const SizedBox(height: 12),
            Text(
              message,
              textAlign: TextAlign.center,
              style: const TextStyle(
                color: EvColors.textMedium,
                fontSize: 14,
                fontWeight: FontWeight.w600,
              ),
            ),
            if (hint != null) ...[
              const SizedBox(height: 6),
              Text(
                hint!,
                textAlign: TextAlign.center,
                style: const TextStyle(color: EvColors.textLow, fontSize: 12),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

/// تبدیر هر خطای API/شبکه به پیام فارسی نمایشی (با جزئیات سرور).
String errorMessage(Object error) {
  if (error is ApiException) {
    if (error.details.isNotEmpty) {
      return '${error.message}:\n${error.details.join('؛ ')}';
    }
    return error.message;
  }
  return 'خطای پیش‌بینی‌نشده رخ داد';
}

// — — — نشان‌ها و تراشه‌ها — — —

/// نقطهٔ رنگی وضعیت.
class _Dot extends StatelessWidget {
  const _Dot({required this.color, required this.on});

  final Color color;
  final bool on;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: 8,
      height: 8,
      decoration: BoxDecoration(
        shape: BoxShape.circle,
        color: on ? color : EvColors.textLow,
      ),
    );
  }
}

/// تراشهٔ وضعیت عمومی با نقطهٔ رنگی.
class StatusChip extends StatelessWidget {
  const StatusChip({
    super.key,
    required this.label,
    required this.color,
    this.on = true,
  });

  factory StatusChip.forHealth(bool ok) => StatusChip(
        label: ok ? 'سالم' : 'ناقص',
        color: ok ? EvColors.ok : EvColors.danger,
      );

  factory StatusChip.forWs(WsStatus status) {
    return switch (status) {
      WsStatus.connected => const StatusChip(label: 'بلادرنگ متصل', color: EvColors.ok),
      WsStatus.connecting => const StatusChip(label: 'در حال اتصال', color: EvColors.warn),
      WsStatus.reconnecting => const StatusChip(label: 'اتصال مجدد…', color: EvColors.warn),
      WsStatus.disconnected => const StatusChip(label: 'بلادرنگ قطع', color: EvColors.danger),
    };
  }

  factory StatusChip.forStreamStatus(String status) {
    return switch (status) {
      'RUNNING' => const StatusChip(label: 'در حال اجرا', color: EvColors.ok),
      'STARTING' => const StatusChip(label: 'راه‌اندازی', color: EvColors.warn),
      'STOPPING' => const StatusChip(label: 'در حال توقف', color: EvColors.warn),
      'ERROR' => const StatusChip(label: 'خطا', color: EvColors.danger),
      _ => const StatusChip(label: 'غیرفعال', color: EvColors.textLow, on: false),
    };
  }

  factory StatusChip.forSessionState(String state) {
    return switch (state) {
      'RUNNING' => const StatusChip(label: 'در حال اجرا', color: EvColors.ok),
      'DEGRADED' => const StatusChip(label: 'افت کارایی', color: EvColors.warn),
      'STARTING' => const StatusChip(label: 'در حال شروع', color: EvColors.warn),
      'STOPPING' => const StatusChip(label: 'در حال توقف', color: EvColors.warn),
      'ERROR' => const StatusChip(label: 'خطا', color: EvColors.danger),
      'STOPPED' => const StatusChip(label: 'پایان‌یافته', color: EvColors.textLow, on: false),
      _ => StatusChip(label: state, color: EvColors.textLow, on: false),
    };
  }

  final String label;
  final Color color;
  final bool on;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(
        color: EvColors.surfaceAlt,
        borderRadius: BorderRadius.circular(999),
        border: Border.all(color: EvColors.outline),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          _Dot(color: color, on: on),
          const SizedBox(width: 6),
          Text(
            label,
            style: TextStyle(
              color: on ? EvColors.textHigh : EvColors.textLow,
              fontSize: 11,
              fontWeight: FontWeight.w600,
            ),
          ),
        ],
      ),
    );
  }
}

/// تراشهٔ نوع رویداد با رنگ شدت.
class EventTypeChip extends StatelessWidget {
  const EventTypeChip({super.key, required this.type});

  final String type;

  @override
  Widget build(BuildContext context) {
    final (label, color) = switch (type) {
      'LINE_CROSS' => ('عبور از خط', EvColors.accent),
      'ROI_ENTER' => ('ورود به ناحیه', EvColors.ok),
      'ROI_EXIT' => ('خروج از ناحیه', EvColors.warn),
      'SESSION_END' => ('پایان نشست', EvColors.textLow),
      'ERROR' => ('خطا', EvColors.danger),
      'STATE_CHANGE' => ('تغییر وضعیت', EvColors.textMedium),
      _ => (type, EvColors.textMedium),
    };
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(
        color: EvColors.surfaceAlt,
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: EvColors.outline),
      ),
      child: Text(
        label,
        style: TextStyle(color: color, fontSize: 11, fontWeight: FontWeight.w700),
      ),
    );
  }
}

// — — — کارت‌ها و کاشی‌ها — — —

/// کارت پایه با عنوان و بدنه.
class PanelCard extends StatelessWidget {
  const PanelCard({super.key, required this.title, required this.child, this.trailing});

  final String title;
  final Widget child;
  final Widget? trailing;

  @override
  Widget build(BuildContext context) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              children: [
                Expanded(
                  child: Text(
                    title,
                    style: const TextStyle(
                      color: EvColors.textHigh,
                      fontSize: 14,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ),
                if (trailing != null) trailing!,
              ],
            ),
            const SizedBox(height: 12),
            child,
          ],
        ),
      ),
    );
  }
}

/// کاشی KPI — عنوان، مقدار درشت و زیرنویس.
class KpiTile extends StatelessWidget {
  const KpiTile({
    super.key,
    required this.label,
    required this.value,
    this.sub,
    this.accent = false,
  });

  final String label;
  final String value;
  final String? sub;
  final bool accent;

  @override
  Widget build(BuildContext context) {
    return Card(
      color: accent ? const Color(0xFF14211F) : EvColors.surface,
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              label,
              style: const TextStyle(color: EvColors.textMedium, fontSize: 12),
            ),
            const SizedBox(height: 6),
            Text(
              value,
              style: TextStyle(
                color: accent ? EvColors.accent : EvColors.textHigh,
                fontSize: 22,
                fontWeight: FontWeight.w800,
                fontFeatures: const [FontFeature.tabularFigures()],
              ),
            ),
            if (sub != null) ...[
              const SizedBox(height: 4),
              Text(
                sub!,
                style: const TextStyle(color: EvColors.textLow, fontSize: 11),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

/// سطر «عنوان: مقدار» با فاصلهٔ مساوی.
class InfoRow extends StatelessWidget {
  const InfoRow(this.label, this.value, {super.key, this.color});

  final String label;
  final String value;
  final Color? color;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Row(
        children: [
          Expanded(
            child: Text(label, style: const TextStyle(color: EvColors.textMedium, fontSize: 13)),
          ),
          Text(
            value,
            style: TextStyle(
              color: color ?? EvColors.textHigh,
              fontSize: 13,
              fontWeight: FontWeight.w600,
            ),
          ),
        ],
      ),
    );
  }
}

// — — — نوار صفحه‌بندی — — —

/// نوار صفحه‌بندی: قبلی/بعدی + «صفحهٔ X از Y» + مجموع.
class PagerBar extends StatelessWidget {
  const PagerBar({
    super.key,
    required this.page,
    required this.totalPages,
    required this.total,
    required this.onChanged,
  });

  final int page;
  final int totalPages;
  final int total;
  final void Function(int page) onChanged;

  @override
  Widget build(BuildContext context) {
    final hasPrev = page > 1 && totalPages > 0;
    final hasNext = page < totalPages;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 10),
      child: Row(
        children: [
          Expanded(
            child: Text(
              total > 0
                  ? 'صفحهٔ ${faNumber(page)} از ${faNumber(totalPages)} — ${faNumber(total)} ردیف'
                  : 'ردیفی برای نمایش نیست',
              style: const TextStyle(color: EvColors.textLow, fontSize: 12),
            ),
          ),
          IconButton(
            onPressed: hasPrev ? () => onChanged(page - 1) : null,
            icon: const Icon(Icons.chevron_right),
            tooltip: 'صفحهٔ قبل',
          ),
          IconButton(
            onPressed: hasNext ? () => onChanged(page + 1) : null,
            icon: const Icon(Icons.chevron_left),
            tooltip: 'صفحهٔ بعد',
          ),
        ],
      ),
    );
  }
}

/// مبدل ردیف رویداد API به جملهٔ فارسی طبیعی.
String eventSentence({
  required String type,
  String? label,
  int? trackId,
  Object? payload,
}) {
  final who = trackId != null
      ? '${classLabelFa(label)} (مسیر ${faNumber(trackId)})'
      : classLabelFa(label);
  switch (type) {
    case 'LINE_CROSS':
      final map = payload is Map<String, dynamic> ? payload : <String, dynamic>{};
      final dir = directionLabelFa(map['direction'] is String ? map['direction'] as String : null);
      return '$who از خط عبور کرد — جهت $dir';
    case 'ROI_ENTER':
      return '$who وارد ناحیهٔ پایش شد';
    case 'ROI_EXIT':
      return '$who از ناحیهٔ پایش خارج شد';
    case 'SESSION_END':
      return 'نشست پایان یافت — دلیل: ${_reasonOf(payload)}';
    case 'ERROR':
      return 'خطا در پردازش — دلیل: ${_reasonOf(payload)}';
    case 'STATE_CHANGE':
      return 'وضعیت نشست تغییر کرد';
    default:
      return 'رویداد $type';
  }
}

String _reasonOf(Object? payload) {
  if (payload is Map<String, dynamic>) {
    final reason = payload['reason'];
    if (reason is String && reason.isNotEmpty) return reason;
  }
  return 'نامشخص';
}
