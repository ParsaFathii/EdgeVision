// EdgeVision — کلاینت موبایل
// Copyright © 2026 Parsa Fathi — Apache-2.0

import 'dart:async';

import 'package:flutter/material.dart';

import '../api/models.dart';
import '../main.dart';
import '../utils/persian.dart';
import '../utils/theme.dart';
import 'shared.dart';

/// پردهٔ «تشخیص‌ها» — فیلتر برچسب/اطمینان/ترتیب و صفحه‌بندی.
class DetectionsScreen extends StatefulWidget {
  const DetectionsScreen({super.key});

  @override
  State<DetectionsScreen> createState() => _DetectionsScreenState();
}

class _DetectionsScreenState extends State<DetectionsScreen> {
  AppState? _app;
  List<LabelCount>? _labels;

  String? _label;
  double _minConfidence = 0;
  bool _sortByConfidence = false;
  bool _asc = false;
  int _page = 1;

  Future<Paged<Detection>>? _future;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (_app == null) {
      _app = AppScope.of(context);
      _fetch();
      unawaited(_loadLabels());
    }
  }

  Future<void> _loadLabels() async {
    try {
      final labels = await _app!.api.detectionLabels();
      if (mounted) setState(() => _labels = labels);
    } on Object {
      // برچسب‌ها اختیاری‌اند — بدون آن‌ها فیلتر برچسب خاموش می‌ماند.
    }
  }

  void _fetch() {
    setState(() {
      _future = _app!.api.detections(
        label: _label,
        minConfidence: _minConfidence > 0 ? _minConfidence : null,
        page: _page,
        pageSize: 25,
        sort: _sortByConfidence ? 'confidence' : 'ts',
        asc: _asc,
      );
    });
  }

  void _changePage(int page) {
    _page = page;
    _fetch();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Column(
        children: [
          _filterBar(),
          Expanded(
            child: FutureBuilder<Paged<Detection>>(
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
                    message: 'تشخیصی مطابق فیلترها یافت نشد',
                    hint: 'آستانهٔ اطمینان را کاهش دهید یا فیلتر برچسب را بردارید',
                    icon: Icons.center_focus_strong_outlined,
                  );
                }
                return RefreshIndicator(
                  onRefresh: () async => _fetch(),
                  child: ListView.separated(
                    physics: const AlwaysScrollableScrollPhysics(),
                    padding: const EdgeInsets.fromLTRB(14, 8, 14, 8),
                    itemCount: data.items.length,
                    separatorBuilder: (_, __) => const SizedBox(height: 8),
                    itemBuilder: (context, i) => _detectionCard(data.items[i]),
                  ),
                );
              },
            ),
          ),
          FutureBuilder<Paged<Detection>>(
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
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              Expanded(
                child: DropdownButtonFormField<String?>(
                  initialValue: _label,
                  isExpanded: true,
                  decoration: const InputDecoration(
                    labelText: 'برچسب دسته',
                    isDense: true,
                  ),
                  items: [
                    const DropdownMenuItem<String?>(value: null, child: Text('همهٔ دسته‌ها')),
                    for (final l in (_labels ?? const <LabelCount>[]))
                      DropdownMenuItem<String?>(
                        value: l.label,
                        child: Text('${classLabelFa(l.label)} (${faNumber(l.count)})'),
                      ),
                  ],
                  onChanged: (v) {
                    setState(() {
                      _label = v;
                      _page = 1;
                    });
                    _fetch();
                  },
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: InputDecorator(
                  decoration: const InputDecoration(
                    labelText: 'مرتب‌سازی',
                    isDense: true,
                  ),
                  child: DropdownButton<bool?>(
                    value: _sortByConfidence,
                    isExpanded: true,
                    underline: const SizedBox.shrink(),
                    items: const [
                      DropdownMenuItem<bool?>(value: false, child: Text('زمان')),
                      DropdownMenuItem<bool?>(value: true, child: Text('اطمینان')),
                    ],
                    onChanged: (v) {
                      setState(() {
                        _sortByConfidence = v ?? false;
                        _page = 1;
                      });
                      _fetch();
                    },
                  ),
                ),
              ),
              const SizedBox(width: 10),
              SizedBox(
                width: 48,
                child: IconButton(
                  tooltip: _asc ? 'صعودی' : 'نزولی',
                  onPressed: () {
                    setState(() => _asc = !_asc);
                    _fetch();
                  },
                  icon: Icon(_asc ? Icons.arrow_upward : Icons.arrow_downward, size: 18),
                ),
              ),
            ],
          ),
          const SizedBox(height: 10),
          Row(
            children: [
              Expanded(
                child: Text(
                  'حداقل اطمینان: ${faPercent((_minConfidence * 100).round())}',
                  style: const TextStyle(color: EvColors.textMedium, fontSize: 12),
                ),
              ),
              if (_minConfidence > 0)
                TextButton(
                  onPressed: () {
                    setState(() => _minConfidence = 0);
                    _page = 1;
                    _fetch();
                  },
                  child: const Text('پاک‌کردن'),
                ),
            ],
          ),
          Slider(
            value: _minConfidence,
            min: 0,
            max: 1,
            divisions: 20,
            onChanged: (v) => setState(() => _minConfidence = v),
            onChangeEnd: (_) {
              _page = 1;
              _fetch();
            },
          ),
        ],
      ),
    );
  }

  Widget _detectionCard(Detection d) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              children: [
                Text(
                  classLabelFa(d.label),
                  style: const TextStyle(
                    color: EvColors.textHigh,
                    fontSize: 14,
                    fontWeight: FontWeight.w700,
                  ),
                ),
                const SizedBox(width: 8),
                Text(
                  'مسیر ${faNumber(d.trackId)}',
                  style: const TextStyle(color: EvColors.textMedium, fontSize: 12),
                ),
                const Spacer(),
                Text(
                  faPercent((d.confidence * 100).round()),
                  style: const TextStyle(
                    color: EvColors.accent,
                    fontSize: 13,
                    fontWeight: FontWeight.w800,
                  ),
                ),
              ],
            ),
            const SizedBox(height: 8),
            _confidenceBar(d.confidence),
            const SizedBox(height: 8),
            Text(
              'فریم ${faNumber(d.frameIndex)} · '
              'مختصات (${faNumber(d.x, decimals: 2)}، ${faNumber(d.y, decimals: 2)}) '
              'اندازه ${faNumber(d.w, decimals: 2)}×${faNumber(d.h, decimals: 2)} · '
              '${faDateTime(d.ts.toLocal())}',
              style: const TextStyle(color: EvColors.textLow, fontSize: 11),
            ),
          ],
        ),
      ),
    );
  }

  Widget _confidenceBar(double confidence) {
    return ClipRRect(
      borderRadius: BorderRadius.circular(4),
      child: SizedBox(
        height: 5,
        child: LinearProgressIndicator(
          value: confidence.clamp(0.0, 1.0),
          minHeight: 5,
        ),
      ),
    );
  }
}
