// EdgeVision — کلاینت موبایل
// Copyright © 2026 Parsa Fathi — Apache-2.0

import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';

import '../api/models.dart';
import '../main.dart';
import '../utils/persian.dart';
import '../utils/theme.dart';
import 'shared.dart';

const List<String> _eventTypes = [
  'LINE_CROSS',
  'ROI_ENTER',
  'ROI_EXIT',
  'SESSION_END',
  'ERROR',
  'STATE_CHANGE',
];

/// پردهٔ «رویدادها» — فیلتر نوع/استریم/زمان و صفحه‌بندی.
class EventsScreen extends StatefulWidget {
  const EventsScreen({super.key});

  @override
  State<EventsScreen> createState() => _EventsScreenState();
}

class _EventsScreenState extends State<EventsScreen> {
  AppState? _app;
  List<StreamItem>? _streams;

  String? _type;
  String? _streamId;
  DateTime? _from;
  DateTime? _to;
  int _page = 1;

  Future<Paged<EventItem>>? _future;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (_app == null) {
      _app = AppScope.of(context);
      _fetch();
      unawaited(_loadStreams());
    }
  }

  Future<void> _loadStreams() async {
    try {
      final streams = await _app!.api.streams();
      if (mounted) setState(() => _streams = streams);
    } on Object {
      // فیلتر استریم اختیاری است — خرابی فهرست استریم‌ها مهار می‌شود.
    }
  }

  void _fetch() {
    setState(() {
      _future = _app!.api.events(
        type: _type,
        streamId: _streamId,
        from: _from,
        to: _to,
        page: _page,
        pageSize: 25,
      );
    });
  }

  void _changePage(int page) {
    _page = page;
    _fetch();
  }

  Future<void> _pickDate({required bool isFrom}) async {
    final now = DateTime.now();
    final picked = await showDatePicker(
      context: context,
      initialDate: isFrom ? (_from ?? now.subtract(const Duration(days: 1))) : (_to ?? now),
      firstDate: DateTime(now.year - 2),
      lastDate: now.add(const Duration(days: 1)),
      helpText: isFrom ? 'از تاریخ' : 'تا تاریخ',
    );
    if (picked == null) return;
    setState(() {
      if (isFrom) {
        _from = DateTime(picked.year, picked.month, picked.day);
      } else {
        _to = DateTime(picked.year, picked.month, picked.day, 23, 59, 59);
      }
      _page = 1;
    });
    _fetch();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Column(
        children: [
          _filterBar(),
          Expanded(
            child: FutureBuilder<Paged<EventItem>>(
              future: _future,
              builder: (context, snapshot) {
                if (snapshot.connectionState != ConnectionState.done) {
                  return const LoadingView();
                }
                if (snapshot.hasError) {
                  return ErrorView(
                    message: errorMessage(snapshot.error!),
                    onRetry: _fetch,
                  );
                }
                final data = snapshot.data!;
                if (data.items.isEmpty) {
                  return const EmptyView(
                    message: 'رویدادی مطابق فیلترها یافت نشد',
                    hint: 'فیلترها را تغییر دهید یا محدودهٔ زمانی را گسترده‌تر کنید',
                    icon: Icons.bolt_outlined,
                  );
                }
                return RefreshIndicator(
                  onRefresh: () async => _fetch(),
                  child: ListView.separated(
                    physics: const AlwaysScrollableScrollPhysics(),
                    padding: const EdgeInsets.fromLTRB(14, 8, 14, 8),
                    itemCount: data.items.length,
                    separatorBuilder: (_, __) => const SizedBox(height: 8),
                    itemBuilder: (context, i) =>
                        _eventCard(data.items[i], _streams ?? const <StreamItem>[]),
                  ),
                );
              },
            ),
          ),
          FutureBuilder<Paged<EventItem>>(
            future: _future,
            builder: (context, snapshot) {
              final data = snapshot.data;
              if (snapshot.connectionState != ConnectionState.done || data == null) {
                return const SizedBox.shrink();
              }
              return PagerBar(
                page: data.page,
                totalPages: data.totalPages,
                total: data.total,
                onChanged: _changePage,
              );
            },
          ),
        ],
      ),
    );
  }

  Widget _filterBar() {
    return Padding(
      padding: const EdgeInsets.fromLTRB(14, 10, 14, 6),
      child: Column(
        children: [
          Row(
            children: [
              Expanded(
                child: DropdownButtonFormField<String?>(
                  initialValue: _type,
                  isExpanded: true,
                  decoration: const InputDecoration(
                    labelText: 'نوع رویداد',
                    isDense: true,
                  ),
                  items: [
                    const DropdownMenuItem<String?>(value: null, child: Text('همهٔ انواع')),
                    for (final t in _eventTypes)
                      DropdownMenuItem<String?>(value: t, child: Text(eventTypeFa(t))),
                  ],
                  onChanged: (v) {
                    setState(() {
                      _type = v;
                      _page = 1;
                    });
                    _fetch();
                  },
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: DropdownButtonFormField<String?>(
                  initialValue: _streamId,
                  isExpanded: true,
                  decoration: const InputDecoration(
                    labelText: 'استریم',
                    isDense: true,
                  ),
                  items: [
                    const DropdownMenuItem<String?>(value: null, child: Text('همهٔ استریم‌ها')),
                    for (final s in (_streams ?? const <StreamItem>[]))
                      DropdownMenuItem<String?>(value: s.id, child: Text(s.name, maxLines: 1, overflow: TextOverflow.ellipsis)),
                  ],
                  onChanged: (v) {
                    setState(() {
                      _streamId = v;
                      _page = 1;
                    });
                    _fetch();
                  },
                ),
              ),
            ],
          ),
          const SizedBox(height: 8),
          Row(
            children: [
              Expanded(
                child: _dateChip(
                  label: _from == null ? 'از تاریخ' : 'از ${faDateShort(_from!)}',
                  icon: Icons.calendar_today_outlined,
                  onTap: () => unawaited(_pickDate(isFrom: true)),
                  onClear: _from == null ? null : () => _clearDate(true),
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: _dateChip(
                  label: _to == null ? 'تا تاریخ' : 'تا ${faDateShort(_to!)}',
                  icon: Icons.calendar_month_outlined,
                  onTap: () => unawaited(_pickDate(isFrom: false)),
                  onClear: _to == null ? null : () => _clearDate(false),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }

  void _clearDate(bool isFrom) {
    setState(() {
      if (isFrom) {
        _from = null;
      } else {
        _to = null;
      }
      _page = 1;
    });
    _fetch();
  }

  Widget _dateChip({
    required String label,
    required IconData icon,
    required VoidCallback onTap,
    VoidCallback? onClear,
  }) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(10),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
        decoration: BoxDecoration(
          color: EvColors.surfaceAlt,
          borderRadius: BorderRadius.circular(10),
          border: Border.all(color: EvColors.outline),
        ),
        child: Row(
          children: [
            Icon(icon, size: 15, color: EvColors.textMedium),
            const SizedBox(width: 8),
            Expanded(
              child: Text(
                label,
                style: const TextStyle(color: EvColors.textMedium, fontSize: 12),
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
              ),
            ),
            if (onClear != null)
              InkWell(
                onTap: onClear,
                child: const Icon(Icons.close, size: 15, color: EvColors.textLow),
              ),
          ],
        ),
      ),
    );
  }

  Widget _eventCard(EventItem e, List<StreamItem> streams) {
    final streamName = streams
        .where((s) => s.id == e.streamId)
        .map((s) => s.name)
        .firstOrNull;
    return Card(
      child: InkWell(
        borderRadius: BorderRadius.circular(14),
        onTap: () => _showPayload(e),
        child: Padding(
          padding: const EdgeInsets.all(12),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Row(
                children: [
                  EventTypeChip(type: e.type),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text(
                      eventSentence(
                        type: e.type,
                        label: e.label,
                        trackId: e.trackId,
                        payload: e.payload,
                      ),
                      style: const TextStyle(
                        color: EvColors.textHigh,
                        fontSize: 13,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 6),
              Text(
                '${streamName ?? '—'} · ${faDateTime(e.ts.toLocal())} · ${faAgo(e.ts.toLocal())}',
                style: const TextStyle(color: EvColors.textLow, fontSize: 11),
              ),
            ],
          ),
        ),
      ),
    );
  }

  void _showPayload(EventItem e) {
    const encoder = JsonEncoder.withIndent('  ');
    String pretty;
    try {
      pretty = encoder.convert(e.payload ?? const <String, dynamic>{});
    } on Object {
      pretty = '${e.payload}';
    }
    showModalBottomSheet<void>(
      context: context,
      backgroundColor: EvColors.surface,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(16)),
      ),
      builder: (context) => DraggableScrollableSheet(
        expand: false,
        initialChildSize: 0.4,
        builder: (context, controller) => ListView(
          controller: controller,
          padding: const EdgeInsets.all(16),
          children: [
            Row(
              children: [
                EventTypeChip(type: e.type),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    'جزئیات رویداد #${faNumber(e.id)}',
                    style: const TextStyle(
                      color: EvColors.textHigh,
                      fontSize: 14,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 12),
            // JSON خام — چپ‌به‌راست و با قلم هم‌عرض.
            Directionality(
              textDirection: TextDirection.ltr,
              child: Container(
                width: double.infinity,
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  color: EvColors.background,
                  borderRadius: BorderRadius.circular(10),
                  border: Border.all(color: EvColors.outline),
                ),
                child: Text(
                  pretty,
                  style: const TextStyle(
                    color: EvColors.textMedium,
                    fontSize: 12,
                    fontFamily: 'monospace',
                  ),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
