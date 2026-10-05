// EdgeVision — کلاینت موبایل
// Copyright © 2026 Parsa Fathi — Apache-2.0

import 'dart:async';

import 'package:flutter/material.dart';

import '../api/models.dart';
import '../main.dart';
import '../utils/persian.dart';
import '../utils/theme.dart';
import 'shared.dart';

/// دادهٔ تجمعی پردهٔ تحلیل‌ها.
class _AnalyticsData {
  _AnalyticsData({
    required this.metrics,
    required this.labels,
    this.streamName,
  });

  final MetricsResponse metrics;
  final List<LabelCount> labels;
  final String? streamName;
}

/// پردهٔ «تحلیل‌ها» — شمارش هر دسته + نمودار خطی تاخیر (CustomPainter).
class AnalyticsScreen extends StatefulWidget {
  const AnalyticsScreen({super.key});

  @override
  State<AnalyticsScreen> createState() => _AnalyticsScreenState();
}

class _AnalyticsScreenState extends State<AnalyticsScreen> {
  AppState? _app;
  List<StreamItem>? _streams;

  String? _streamId;
  String _bucket = '30s';

  Future<_AnalyticsData>? _future;

  static const List<(String, String)> _bucketChoices = [
    ('1s', '۱ ثانیه'),
    ('5s', '۵ ثانیه'),
    ('30s', '۳۰ ثانیه'),
    ('1m', '۱ دقیقه'),
  ];

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
      // انتخابگر استریم اختیاری است.
    }
  }

  void _fetch() {
    setState(() {
      _future = _load();
    });
  }

  Future<_AnalyticsData> _load() async {
    final results = await Future.wait(<Future<Object>>[
      _app!.api.metrics(streamId: _streamId, bucket: _bucket),
      _app!.api.detectionLabels(streamId: _streamId),
    ]);
    final streamName = _streamId == null
        ? null
        : (_streams ?? const <StreamItem>[])
            .where((s) => s.id == _streamId)
            .map((s) => s.name)
            .firstOrNull;
    return _AnalyticsData(
      metrics: results[0] as MetricsResponse,
      labels: results[1] as List<LabelCount>,
      streamName: streamName,
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: RefreshIndicator(
        onRefresh: () async => _fetch(),
        child: ListView(
          physics: const AlwaysScrollableScrollPhysics(),
          padding: const EdgeInsets.all(14),
          children: [
            _pickers(),
            const SizedBox(height: 12),
            FutureBuilder<_AnalyticsData>(
              future: _future,
              builder: (context, snapshot) {
                if (snapshot.connectionState != ConnectionState.done) {
                  return const SizedBox(
                    height: 320,
                    child: LoadingView(),
                  );
                }
                if (snapshot.hasError) {
                  return SizedBox(
                    height: 320,
                    child: ErrorView(
                      message: errorMessage(snapshot.error!),
                      onRetry: _fetch,
                    ),
                  );
                }
                final data = snapshot.data!;
                if (data.metrics.buckets.isEmpty) {
                  return SizedBox(
                    height: 320,
                    child: EmptyView(
                      message: 'دادهٔ متریک برای این بازه موجود نیست',
                      hint: data.streamName == null
                          ? 'پس از اجرای نشست، متریک‌ها اینجا رسم می‌شوند'
                          : 'برای «${data.streamName}» متریک ثبت نشده است',
                      icon: Icons.insights_outlined,
                    ),
                  );
                }
                return Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    _summaryCard(data.metrics),
                    const SizedBox(height: 12),
                    _latencyCard(data.metrics),
                    const SizedBox(height: 12),
                    _labelsCard(data.labels),
                  ],
                );
              },
            ),
          ],
        ),
      ),
    );
  }

  Widget _pickers() {
    return Row(
      children: [
        Expanded(
          flex: 2,
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
                DropdownMenuItem<String?>(
                  value: s.id,
                  child: Text(s.name, maxLines: 1, overflow: TextOverflow.ellipsis),
                ),
            ],
            onChanged: (v) {
              setState(() => _streamId = v);
              _fetch();
            },
          ),
        ),
        const SizedBox(width: 10),
        Expanded(
          child: DropdownButtonFormField<String>(
            initialValue: _bucket,
            isExpanded: true,
            decoration: const InputDecoration(
              labelText: 'بازه',
              isDense: true,
            ),
            items: [
              for (final (key, label) in _bucketChoices)
                DropdownMenuItem<String>(value: key, child: Text(label)),
            ],
            onChanged: (v) {
              setState(() => _bucket = v ?? '30s');
              _fetch();
            },
          ),
        ),
      ],
    );
  }

  Widget _summaryCard(MetricsResponse metrics) {
    final s = metrics.summary;
    return PanelCard(
      title: 'خلاصهٔ متریک‌ها',
      trailing: Text(
        '${faNumber(s.samples)} نمونه',
        style: const TextStyle(color: EvColors.textLow, fontSize: 11),
      ),
      child: Column(
        children: [
          Row(
            children: [
              Expanded(
                child: _StatBox(
                  label: 'میانگین فریم/ث (پردازش)',
                  value: faNumber(s.avgProcessedFps, decimals: 1),
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: _StatBox(
                  label: 'میانگین تاخیر',
                  value: '${faNumber(s.avgLatencyMs, decimals: 1)} میلی‌ثانیه',
                ),
              ),
            ],
          ),
          const SizedBox(height: 10),
          Row(
            children: [
              Expanded(
                child: _StatBox(
                  label: 'بیشینهٔ تاخیر',
                  value: '${faNumber(s.maxLatencyMs, decimals: 1)} میلی‌ثانیه',
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: _StatBox(
                  label: 'میانگین پردازنده',
                  value: faPercent(s.avgCpuPercent),
                ),
              ),
            ],
          ),
          const SizedBox(height: 10),
          Row(
            children: [
              Expanded(
                child: _StatBox(
                  label: 'بیشینهٔ صف',
                  value: faNumber(s.maxQueueDepth),
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: _StatBox(
                  label: 'بیشینهٔ فریم پردازش‌شده',
                  value: faNumber(s.maxFramesProcessed),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _latencyCard(MetricsResponse metrics) {
    final buckets = metrics.buckets;
    return PanelCard(
      title: 'روند تاخیر پردازش',
      trailing: Text(
        'بازهٔ ${_bucketChoices.firstWhere((c) => c.$1 == metrics.bucket).$2}',
        style: const TextStyle(color: EvColors.textLow, fontSize: 11),
      ),
      child: buckets.isEmpty
          ? const EmptyView(
              message: 'نمونه‌ای برای رسم نیست',
              icon: Icons.show_chart_outlined,
            )
          : Column(
              children: [
                SizedBox(
                  height: 140,
                  width: double.infinity,
                  child: CustomPaint(
                    painter: LatencySparklinePainter(buckets: buckets),
                  ),
                ),
                const SizedBox(height: 8),
                Text(
                  'آخرین مقدار: ${faNumber(buckets.last.avgLatencyMs, decimals: 1)} میلی‌ثانیه — '
                  'از ${faNumber(buckets.length)} بازه',
                  style: const TextStyle(color: EvColors.textLow, fontSize: 11),
                ),
              ],
            ),
    );
  }

  Widget _labelsCard(List<LabelCount> labels) {
    final maxCount = labels.isEmpty ? 1 : labels.first.count;
    return PanelCard(
      title: 'شمارش تشخیص‌ها به تفکیک دسته',
      child: labels.isEmpty
          ? const EmptyView(
              message: 'تشخیصی ثبت نشده است',
              icon: Icons.category_outlined,
            )
          : Column(
              children: [
                for (final l in labels)
                  Padding(
                    padding: const EdgeInsets.symmetric(vertical: 5),
                    child: Row(
                      children: [
                        SizedBox(
                          width: 92,
                          child: Text(
                            classLabelFa(l.label),
                            style: const TextStyle(
                              color: EvColors.textHigh,
                              fontSize: 12,
                              fontWeight: FontWeight.w600,
                            ),
                          ),
                        ),
                        const SizedBox(width: 8),
                        Expanded(
                          child: ClipRRect(
                            borderRadius: BorderRadius.circular(4),
                            child: SizedBox(
                              height: 8,
                              child: LinearProgressIndicator(
                                value: (l.count / maxCount).clamp(0.0, 1.0),
                                minHeight: 8,
                              ),
                            ),
                          ),
                        ),
                        const SizedBox(width: 8),
                        Text(
                          faNumber(l.count),
                          style: const TextStyle(
                            color: EvColors.accent,
                            fontSize: 12,
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                      ],
                    ),
                  ),
              ],
            ),
    );
  }
}

/// جعبهٔ آمار کوتاه.
class _StatBox extends StatelessWidget {
  const _StatBox({required this.label, required this.value});

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
      decoration: BoxDecoration(
        color: EvColors.surfaceAlt,
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: EvColors.outline),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(label, style: const TextStyle(color: EvColors.textMedium, fontSize: 11)),
          const SizedBox(height: 4),
          Text(
            value,
            style: const TextStyle(
              color: EvColors.textHigh,
              fontSize: 15,
              fontWeight: FontWeight.w800,
            ),
          ),
        ],
      ),
    );
  }
}

/// نمودار خطی تاخیر — بدون بستهٔ نمودار، مستقیم روی بوم.
class LatencySparklinePainter extends CustomPainter {
  LatencySparklinePainter({required this.buckets});

  final List<MetricsBucket> buckets;

  @override
  void paint(Canvas canvas, Size size) {
    if (buckets.isEmpty) return;
    final values = [for (final b in buckets) b.avgLatencyMs];
    var minV = values.reduce((a, b) => a < b ? a : b);
    var maxV = values.reduce((a, b) => a > b ? a : b);
    if (maxV - minV < 1e-6) {
      minV = (minV - 1).clamp(0.0, double.infinity);
      maxV = maxV + 1;
    }
    const pad = 6.0;
    final w = size.width;
    final h = size.height;
    final usableH = h - pad * 2;

    Offset pointAt(int i) {
      final x = values.length == 1
          ? w / 2
          : pad + (w - pad * 2) * i / (values.length - 1);
      final t = (values[i] - minV) / (maxV - minV);
      // محور عمودی معکوس: مقدار بیشتر بالاتر.
      final y = h - pad - usableH * t;
      return Offset(x, y);
    }

    // پس‌زمینهٔ نوارها
    final bgPaint = Paint()..color = EvColors.surfaceAlt;
    canvas.drawRRect(
      RRect.fromRectAndRadius(
        Rect.fromLTWH(0, 0, w, h),
        const Radius.circular(8),
      ),
      bgPaint,
    );

    // خطوط راهنمای افقی (۳ سطح)
    final grid = Paint()
      ..color = EvColors.outline
      ..strokeWidth = 1;
    for (var g = 1; g <= 3; g++) {
      final y = pad + usableH * g / 4;
      canvas.drawLine(Offset(pad, y), Offset(w - pad, y), grid);
    }

    // ناحیهٔ زیر خط
    final line = <Offset>[for (var i = 0; i < values.length; i++) pointAt(i)];
    if (line.length > 1) {
      final area = Path()
        ..moveTo(line.first.dx, h - pad)
        ..addPolygon(line, false)
        ..lineTo(line.last.dx, h - pad)
        ..close();
      final areaPaint = Paint()
        ..color = EvColors.accent.withValues(alpha: 0.14);
      canvas.drawPath(area, areaPaint);
    }

    // خودِ خط
    final stroke = Paint()
      ..color = EvColors.accent
      ..strokeWidth = 2
      ..strokeCap = StrokeCap.round
      ..strokeJoin = StrokeJoin.round
      ..style = PaintingStyle.stroke;
    final path = Path()..addPolygon(line, false);
    canvas.drawPath(path, stroke);

    // نقطهٔ آخر
    final last = line.last;
    final dot = Paint()..color = EvColors.accent;
    canvas.drawCircle(last, 3.5, dot);
  }

  @override
  bool shouldRepaint(LatencySparklinePainter oldDelegate) =>
      oldDelegate.buckets != buckets;
}
