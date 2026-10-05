// EdgeVision — کلاینت موبایل
// Copyright © 2026 Parsa Fathi — Apache-2.0

import 'dart:async';
import 'dart:math' as math;

import 'package:flutter/material.dart';

import '../api/models.dart';
import '../main.dart';
import '../utils/persian.dart';
import '../utils/theme.dart';
import '../ws/ws_service.dart';
import 'shared.dart';

/// پردهٔ «جزئیات استریم» — صحنهٔ زنده (CustomPainter)، متریک‌های لحظه‌ای،
/// رویدادهای اخیر و پیکربندی استریم.
class StreamDetailScreen extends StatefulWidget {
  const StreamDetailScreen({super.key, required this.streamId, required this.title});

  final String streamId;
  final String title;

  @override
  State<StreamDetailScreen> createState() => _StreamDetailScreenState();
}

class _StreamDetailScreenState extends State<StreamDetailScreen> {
  AppState? _app;

  StreamItem? _stream;
  Object? _error;
  bool _loading = true;
  bool _busy = false;

  WsFrameMessage? _frame;
  MetricSample? _liveMetric;
  DateTime? _lastFrameAt;
  bool _stale = false;
  final List<WsEventMessage> _recentEvents = <WsEventMessage>[];

  StreamSubscription<WsFrameMessage>? _frameSub;
  StreamSubscription<WsMetricMessage>? _metricSub;
  StreamSubscription<WsEventMessage>? _eventSub;
  StreamSubscription<WsSessionMessage>? _sessionSub;
  Timer? _staleTimer;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (_app != null) return;
    final app = AppScope.of(context);
    _app = app;
    app.ws.subscribe([widget.streamId]);
    _frameSub = app.ws.frames
        .where((f) => f.streamId == widget.streamId)
        .listen((f) {
      if (!mounted) return;
      setState(() {
        _frame = f;
        _lastFrameAt = DateTime.now();
        _stale = false;
      });
    });
    _metricSub = app.ws.metrics
        .where((m) => m.streamId == widget.streamId)
        .listen((m) {
      if (!mounted) return;
      setState(() => _liveMetric = m.sample);
    });
    _eventSub = app.ws.events
        .where((e) => e.streamId == widget.streamId)
        .listen((e) {
      if (!mounted) return;
      setState(() => _recentEvents.insert(0, e));
      if (_recentEvents.length > 50) {
        _recentEvents.removeLast();
      }
    });
    _sessionSub = app.ws.sessionEvents
        .where((s) => s.streamId == widget.streamId)
        .listen((s) {
      if (!mounted) return;
      if (s.terminal) {
        setState(() => _liveMetric = null);
        _reload();
      }
    });
    _staleTimer = Timer.periodic(const Duration(seconds: 1), (_) {
      if (!mounted) return;
      final last = _lastFrameAt;
      final running = _stream?.hasActiveSession ?? false;
      final stale = running && last != null &&
          DateTime.now().difference(last) > const Duration(seconds: 5);
      if (stale != _stale) setState(() => _stale = stale);
    });
    unawaited(_reload());
  }

  Future<void> _reload() async {
    setState(() => _loading = true);
    try {
      final stream = await _app!.api.streamById(widget.streamId);
      if (!mounted) return;
      setState(() {
        _stream = stream;
        _error = null;
        _loading = false;
      });
    } on Object catch (error) {
      if (!mounted) return;
      setState(() {
        _error = error;
        _loading = false;
      });
    }
  }

  @override
  void dispose() {
    _staleTimer?.cancel();
    _frameSub?.cancel();
    _metricSub?.cancel();
    _eventSub?.cancel();
    _sessionSub?.cancel();
    _app?.ws.unsubscribe([widget.streamId]);
    super.dispose();
  }

  Future<void> _toggle() async {
    final app = _app!;
    final stream = _stream;
    if (stream == null || _busy) return;
    final running = stream.hasActiveSession;
    final messenger = ScaffoldMessenger.of(context);
    if (running) {
      final confirmed = await showDialog<bool>(
        context: context,
        builder: (context) => AlertDialog(
          title: const Text('توقف نشست'),
          content: const Text('نشست فعال این استریم متوقف شود؟ داده‌های ثبت‌شده حفظ می‌شوند.'),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(context, false),
              child: const Text('انصراف'),
            ),
            FilledButton(
              onPressed: () => Navigator.pop(context, true),
              child: const Text('متوقف کن'),
            ),
          ],
        ),
      );
      if (confirmed != true) return;
    }
    setState(() => _busy = true);
    try {
      if (running) {
        await app.api.stopStream(stream.id);
        if (mounted) {
          messenger.showSnackBar(const SnackBar(content: Text('نشست متوقف شد')));
        }
      } else {
        await app.api.startStream(stream.id);
        if (mounted) {
          messenger.showSnackBar(
            const SnackBar(content: Text('نشست آغاز شد — در حال دریافت فریم‌های زنده')),
          );
        }
      }
    } on Object catch (error) {
      if (mounted) {
        messenger.showSnackBar(
          SnackBar(content: Text(errorMessage(error)), backgroundColor: const Color(0xFF2A1714)),
        );
      }
    } finally {
      if (mounted) {
        setState(() => _busy = false);
        unawaited(_reload());
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: Text(widget.title)),
      body: _loading
          ? const LoadingView()
          : _error != null
              ? ErrorView(message: errorMessage(_error!), onRetry: () => unawaited(_reload()))
              : RefreshIndicator(
                  onRefresh: _reload,
                  child: ListView(
                    physics: const AlwaysScrollableScrollPhysics(),
                    padding: const EdgeInsets.all(14),
                    children: [
                      _liveSceneCard(),
                      const SizedBox(height: 12),
                      _toggleButton(),
                      const SizedBox(height: 12),
                      _metricsPanel(),
                      const SizedBox(height: 12),
                      _eventsPanel(),
                      const SizedBox(height: 12),
                      _configPanel(),
                      const SizedBox(height: 24),
                    ],
                  ),
                ),
    );
  }

  // — — — صحنهٔ زنده — — —

  Widget _liveSceneCard() {
    final stream = _stream!;
    final running = stream.hasActiveSession;
    return PanelCard(
      title: 'صحنهٔ زنده',
      trailing: running
          ? (_stale
              ? const StatusChip(label: 'داده‌های کهنه', color: EvColors.warn)
              : const StatusChip(label: 'در حال دریافت', color: EvColors.ok))
          : null,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          ClipRRect(
            borderRadius: BorderRadius.circular(10),
            child: AspectRatio(
              aspectRatio: 640 / 360,
              child: CustomPaint(
                painter: ScenePainter(
                  scene: stream.scene,
                  frame: _frame,
                  roi: stream.roi,
                  line: stream.line,
                ),
                child: running && _frame == null
                    ? const Center(
                        child: Text(
                          'در انتظار نخستین فریم…',
                          style: TextStyle(color: EvColors.textMedium, fontSize: 13),
                        ),
                      )
                    : null,
              ),
            ),
          ),
          const SizedBox(height: 10),
          Text(
            _frame == null
                ? running
                    ? 'نشست در حال راه‌اندازی است — فریمی هنوز دریافت نشده'
                    : 'نشست فعالی وجود ندارد؛ با «شروع» پردازش زنده را آغاز کنید'
                : 'فریم ${faNumber(_frame!.frameIndex)} — '
                    'تاخیر ${faNumber(_frame!.latencyMs, decimals: 1)} میلی‌ثانیه — '
                    '${faNumber(_frame!.objects.length)} شیء و '
                    '${faNumber(_frame!.detections.length)} تشخیص',
            style: const TextStyle(color: EvColors.textMedium, fontSize: 12),
          ),
        ],
      ),
    );
  }

  Widget _toggleButton() {
    final running = _stream!.hasActiveSession;
    return Row(
      children: [
        Expanded(
          child: _busy
              ? const OutlinedButton(
                  onPressed: null,
                  child: SizedBox(
                    width: 18,
                    height: 18,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  ),
                )
              : OutlinedButton.icon(
                  style: OutlinedButton.styleFrom(
                    foregroundColor: running ? EvColors.warn : EvColors.accent,
                  ),
                  onPressed: _toggle,
                  icon: Icon(running ? Icons.stop : Icons.play_arrow, size: 18),
                  label: Text(running ? 'توقف نشست' : 'شروع نشست'),
                ),
        ),
      ],
    );
  }

  // — — — متریک‌ها — — —

  Widget _metricsPanel() {
    final m = _liveMetric ?? _stream!.latestMetric;
    final queueCapacity = m?.queueCapacity ?? _stream!.queueCapacity;
    return PanelCard(
      title: 'متریک‌های پردازش',
      trailing: _liveMetric != null
          ? const StatusChip(label: 'زنده', color: EvColors.accent)
          : null,
      child: m == null
          ? const EmptyView(
              message: 'هنوز متریک ثبت نشده است',
              hint: 'متریک‌ها با آغاز نشست ثبت می‌شوند',
              icon: Icons.speed_outlined,
            )
          : Column(
              children: [
                Row(
                  children: [
                    Expanded(
                      child: _MetricBox(
                        label: 'فریم بر ثانیه (پردازش)',
                        value: faNumber(m.processedFps, decimals: 1),
                      ),
                    ),
                    const SizedBox(width: 10),
                    Expanded(
                      child: _MetricBox(
                        label: 'فریم بر ثانیه (منبع)',
                        value: faNumber(m.sourceFps, decimals: 1),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 10),
                Row(
                  children: [
                    Expanded(
                      child: _MetricBox(
                        label: 'تاخیر میانگین',
                        value: '${faNumber(m.latencyAvgMs, decimals: 1)} میلی‌ثانیه',
                        sub: 'P95: ${faNumber(m.latencyP95Ms, decimals: 1)}',
                      ),
                    ),
                    const SizedBox(width: 10),
                    Expanded(
                      child: _MetricBox(
                        label: 'صف فریم',
                        value:
                            '${faNumber(m.queueDepth)} از ${faNumber(queueCapacity)}',
                        sub: 'حذف‌شده: ${faNumber(m.droppedTotal)}',
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 10),
                Row(
                  children: [
                    Expanded(
                      child: _MetricBox(
                        label: 'پردازنده',
                        value: faPercent(m.cpuPercent),
                      ),
                    ),
                    const SizedBox(width: 10),
                    Expanded(
                      child: _MetricBox(
                        label: 'حافظه',
                        value: '${faNumber(m.memoryMb, decimals: 0)} مگابایت',
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 10),
                Row(
                  children: [
                    Expanded(
                      child: _MetricBox(
                        label: 'فریم‌های پردازش‌شده',
                        value: faNumber(m.framesProcessed),
                      ),
                    ),
                    const SizedBox(width: 10),
                    Expanded(
                      child: _MetricBox(
                        label: 'تشخیص‌های تجمعی',
                        value: faNumber(m.detectionsTotal),
                      ),
                    ),
                  ],
                ),
              ],
            ),
    );
  }

  // — — — رویدادهای اخیر — — —

  Widget _eventsPanel() {
    return PanelCard(
      title: 'رویدادهای اخیر',
      trailing: _recentEvents.isEmpty
          ? null
          : Text(
              '${faNumber(_recentEvents.length)} مورد',
              style: const TextStyle(color: EvColors.accent, fontSize: 12),
            ),
      child: _recentEvents.isEmpty
          ? const EmptyView(
              message: 'هنوز رویدادی ثبت نشده است',
              hint: 'عبور از خط یا ورود به ناحیهٔ پایش اینجا نمایش داده می‌شود',
              icon: Icons.bolt_outlined,
            )
          : Column(
              children: [
                for (final e in _recentEvents.take(10))
                  _eventTile(
                    type: e.type,
                    label: e.label,
                    trackId: e.trackId,
                    payload: e.payload,
                    when: e.ts,
                  ),
              ],
            ),
    );
  }

  Widget _eventTile({
    required String type,
    String? label,
    int? trackId,
    Object? payload,
    DateTime? when,
  }) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          EventTypeChip(type: type),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  eventSentence(type: type, label: label, trackId: trackId, payload: payload),
                  style: const TextStyle(
                    color: EvColors.textHigh,
                    fontSize: 13,
                    fontWeight: FontWeight.w600,
                  ),
                ),
                if (when != null)
                  Padding(
                    padding: const EdgeInsets.only(top: 2),
                    child: Text(
                      '${faDateTime(when.toLocal())} — ${faAgo(when.toLocal())}',
                      style: const TextStyle(color: EvColors.textLow, fontSize: 11),
                    ),
                  ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  // — — — پیکربندی — — —

  Widget _configPanel() {
    final s = _stream!;
    final classFilter = s.classFilter.isEmpty
        ? 'بدون فیلتر (همهٔ دسته‌ها)'
        : s.classFilter.map(classLabelFa).join('، ');
    return PanelCard(
      title: 'پیکربندی استریم',
      child: Column(
        children: [
          InfoRow('نوع صحنه', sceneLabelFa(s.scene)),
          InfoRow('ابعاد تصویر', '${faNumber(s.width)}×${faNumber(s.height)}'),
          InfoRow('نرخ فریم هدف', '${faNumber(s.targetFps, decimals: 0)} فریم/ث'),
          InfoRow('تعداد اشیا', faNumber(s.objectCount)),
          InfoRow('آستانهٔ اطمینان', faPercent((s.confidenceThreshold * 100).round())),
          InfoRow('فیلتر کلاس', classFilter),
          InfoRow('ظرفیت صف', faNumber(s.queueCapacity)),
          InfoRow('شبکهٔ استنتاج', '${faNumber(s.gridCols)}×${faNumber(s.gridRows)}'),
          InfoRow('گام انتشار فریم', 'هر ${faNumber(s.emitStride)} فریم'),
          InfoRow('ناحیهٔ پایش', s.roi == null ? 'تعریف نشده' : 'فعال'),
          InfoRow('خط عبور', s.line == null ? 'تعریف نشده' : 'فعال'),
          InfoRow('تاریخ ایجاد', faDateTime(s.createdAt.toLocal())),
        ],
      ),
    );
  }
}

/// جعبهٔ متریک داخل پردهٔ جزئیات.
class _MetricBox extends StatelessWidget {
  const _MetricBox({required this.label, required this.value, this.sub});

  final String label;
  final String value;
  final String? sub;

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
          if (sub != null)
            Padding(
              padding: const EdgeInsets.only(top: 2),
              child: Text(sub!, style: const TextStyle(color: EvColors.textLow, fontSize: 10)),
            ),
        ],
      ),
    );
  }
}

// — — — نقاش صحنهٔ زنده — — —

/// نقاش صحنهٔ زنده: پس‌زمینهٔ صحنه (STREET/INTERSECTION/PARKING)، اشیای
/// صحنه، جعبه‌های تشخیص، ناحیهٔ پایش و خط عبور — همه در فضای ۶۴۰×۳۶۰.
class ScenePainter extends CustomPainter {
  ScenePainter({required this.scene, this.frame, this.roi, this.line});

  static const double w = 640;
  static const double h = 360;

  final String scene;
  final WsFrameMessage? frame;
  final Roi? roi;
  final CrossLine? line;

  static Color objectColor(String t) => switch (t) {
        'VEHICLE' => EvColors.objectVehicle,
        'PEDESTRIAN' => EvColors.objectPedestrian,
        'CYCLIST' => EvColors.objectCyclist,
        _ => EvColors.objectVehicle,
      };

  @override
  void paint(Canvas canvas, Size size) {
    final scale = size.width / w;
    canvas.save();
    canvas.scale(scale, scale);

    switch (scene) {
      case 'INTERSECTION':
        _drawIntersection(canvas);
      case 'PARKING':
        _drawParking(canvas);
      default:
        _drawStreet(canvas);
    }

    if (roi != null && roi!.isValid) _drawRoi(canvas, roi!);
    if (line != null && line!.isValid) _drawLine(canvas, line!);

    final f = frame;
    if (f != null) {
      for (final o in f.objects) {
        _drawObject(canvas, o);
      }
      for (final d in f.detections) {
        _drawDetection(canvas, d);
      }
    }
    canvas.restore();
  }

  // — — — پس‌زمینه‌ها — — —

  void _fill(Canvas canvas, Rect rect, Color color) {
    final paint = Paint()..color = color;
    canvas.drawRect(rect, paint);
  }

  void _dashLine(
    Canvas canvas,
    Offset a,
    Offset b,
    Color color,
    double strokeWidth, {
    double dash = 26,
    double gap = 20,
  }) {
    final paint = Paint()
      ..color = color
      ..strokeWidth = strokeWidth
      ..strokeCap = StrokeCap.butt;
    final dx = b.dx - a.dx;
    final dy = b.dy - a.dy;
    final total = math.sqrt(dx * dx + dy * dy);
    if (total <= 0) return;
    final ux = dx / total;
    final uy = dy / total;
    var t = 0.0;
    while (t < total) {
      final end = (t + dash) < total ? t + dash : total;
      canvas.drawLine(
        Offset(a.dx + ux * t, a.dy + uy * t),
        Offset(a.dx + ux * end, a.dy + uy * end),
        paint,
      );
      t = end + gap;
    }
  }

  void _drawStreet(Canvas canvas) {
    _fill(canvas, const Rect.fromLTWH(0, 0, w, h), const Color(0xFF131316));
    // پیاده‌روها
    _fill(canvas, const Rect.fromLTWH(0, 0, w, 36), const Color(0xFF232328));
    _fill(canvas, const Rect.fromLTWH(0, 324, w, 36), const Color(0xFF232328));
    // جوی‌ها
    final joint = Paint()
      ..color = const Color(0xFF2F2F36)
      ..strokeWidth = 1.5;
    for (var x = 16.0; x < w; x += 32) {
      canvas.drawLine(Offset(x, 4), Offset(x, 32), joint);
      canvas.drawLine(Offset(x, 328), Offset(x, 356), joint);
    }
    // خیابان
    _fill(canvas, const Rect.fromLTWH(0, 36, w, 288), const Color(0xFF1B1B20));
    final edge = Paint()
      ..color = const Color(0xFF33333B)
      ..strokeWidth = 1.5;
    canvas.drawLine(const Offset(0, 44), const Offset(w, 44), edge);
    canvas.drawLine(const Offset(0, 316), const Offset(w, 316), edge);
    // خط‌چین میانی
    _dashLine(
      canvas,
      const Offset(0, 180),
      const Offset(w, 180),
      const Color(0xFF3A3A42),
      3,
    );
    // خط‌کشی عابر پیاده
    for (var i = 0; i < 8; i++) {
      _fill(
        canvas,
        Rect.fromLTWH(474 + i * 12.0, 48, 7, 264),
        const Color(0xFF34343C),
      );
    }
  }

  void _drawIntersection(Canvas canvas) {
    _fill(canvas, const Rect.fromLTWH(0, 0, w, h), const Color(0xFF232328));
    // دو خیابان متقاطع
    _fill(canvas, const Rect.fromLTWH(0, 100, w, 160), const Color(0xFF1B1B20));
    _fill(canvas, const Rect.fromLTWH(180, 0, 280, h), const Color(0xFF1B1B20));
    final edge = Paint()
      ..color = const Color(0xFF2F2F36)
      ..strokeWidth = 2;
    canvas.drawLine(const Offset(0, 100), const Offset(180, 100), edge);
    canvas.drawLine(const Offset(460, 100), const Offset(w, 100), edge);
    canvas.drawLine(const Offset(0, 260), const Offset(180, 260), edge);
    canvas.drawLine(const Offset(460, 260), const Offset(w, 260), edge);
    canvas.drawLine(const Offset(180, 0), const Offset(180, 100), edge);
    canvas.drawLine(const Offset(460, 0), const Offset(460, 100), edge);
    canvas.drawLine(const Offset(180, 260), const Offset(180, h), edge);
    canvas.drawLine(const Offset(460, 260), const Offset(460, h), edge);
    // خط‌چین لِین‌ها
    _dashLine(
      canvas,
      const Offset(0, 180),
      const Offset(168, 180),
      const Color(0xFF3A3A42),
      3,
      dash: 22,
      gap: 16,
    );
    _dashLine(
      canvas,
      const Offset(472, 180),
      const Offset(w, 180),
      const Color(0xFF3A3A42),
      3,
      dash: 22,
      gap: 16,
    );
    _dashLine(
      canvas,
      const Offset(320, 0),
      const Offset(320, 88),
      const Color(0xFF3A3A42),
      3,
      dash: 22,
      gap: 16,
    );
    _dashLine(
      canvas,
      const Offset(320, 272),
      const Offset(320, h),
      const Color(0xFF3A3A42),
      3,
      dash: 22,
      gap: 16,
    );
    // خط‌کشی عابر پیاده چهار جهت
    for (var i = 0; i < 7; i++) {
      _fill(
        canvas,
        Rect.fromLTWH(196 + i * 36.0, 54, 22, 34),
        const Color(0xFF34343C),
      );
      _fill(
        canvas,
        Rect.fromLTWH(196 + i * 36.0, 272, 22, 34),
        const Color(0xFF34343C),
      );
    }
    for (var i = 0; i < 6; i++) {
      _fill(
        canvas,
        Rect.fromLTWH(120, 118 + i * 22.0, 34, 12),
        const Color(0xFF34343C),
      );
      _fill(
        canvas,
        Rect.fromLTWH(486, 118 + i * 22.0, 34, 12),
        const Color(0xFF34343C),
      );
    }
  }

  void _drawParking(Canvas canvas) {
    _fill(canvas, const Rect.fromLTWH(0, 0, w, h), const Color(0xFF1B1B20));
    final border = Paint()
      ..color = const Color(0xFF2B2B32)
      ..style = PaintingStyle.stroke
      ..strokeWidth = 2;
    canvas.drawRect(const Rect.fromLTWH(24, 22, 592, 316), border);
    final bay = Paint()
      ..color = const Color(0xFF38383F)
      ..strokeWidth = 2.5;
    for (var i = 0; i < 10; i++) {
      final x = 72.0 + i * 56;
      canvas.drawLine(Offset(x, 26), Offset(x, 150), bay);
      canvas.drawLine(Offset(x, 210), Offset(x, 334), bay);
    }
    _dashLine(
      canvas,
      const Offset(24, 180),
      const Offset(616, 180),
      const Color(0xFF33333B),
      3,
    );
  }

  // — — — هندسه‌های پایش — — —

  void _drawRoi(Canvas canvas, Roi roi) {
    final rect = Rect.fromLTWH(roi.x * w, roi.y * h, roi.w * w, roi.h * h);
    final paint = Paint()
      ..color = const Color(0x14C9A227)
      ..style = PaintingStyle.fill;
    canvas.drawRect(rect, paint);
    _dashedRect(canvas, rect, EvColors.roi, 1.5, dash: 7, gap: 5);
    _label(canvas, 'ناحیهٔ پایش', Offset(rect.right, rect.top + 14), EvColors.roi,
        anchorRight: true);
  }

  void _drawLine(Canvas canvas, CrossLine l) {
    final a = Offset(l.x1 * w, l.y1 * h);
    final b = Offset(l.x2 * w, l.y2 * h);
    _dashLine(canvas, a, b, EvColors.line, 2, dash: 9, gap: 6);
    final mid = Offset((a.dx + b.dx) / 2, (a.dy + b.dy) / 2);
    _label(canvas, 'خط عبور', Offset(mid.dx, mid.dy - 7), EvColors.line);
  }

  void _dashedRect(
    Canvas canvas,
    Rect rect,
    Color color,
    double strokeWidth, {
    double dash = 7,
    double gap = 5,
  }) {
    _dashLine(canvas, rect.topRight, rect.topLeft, color, strokeWidth, dash: dash, gap: gap);
    _dashLine(canvas, rect.bottomLeft, rect.topLeft, color, strokeWidth, dash: dash, gap: gap);
    _dashLine(canvas, rect.bottomLeft, rect.bottomRight, color, strokeWidth, dash: dash, gap: gap);
    _dashLine(canvas, rect.bottomRight, rect.topRight, color, strokeWidth, dash: dash, gap: gap);
  }

  // — — — اشیا و تشخیص‌ها — — —

  void _drawObject(Canvas canvas, WsSceneObject o) {
    final rect = Rect.fromLTWH(
      o.x * w,
      o.y * h,
      (o.w * w).clamp(8.0, w),
      (o.h * h).clamp(8.0, h),
    );
    final fill = Paint()..color = objectColor(o.t).withValues(alpha: 0.88);
    final stroke = Paint()
      ..color = const Color(0x66000000)
      ..style = PaintingStyle.stroke
      ..strokeWidth = 1;
    canvas.drawRRect(RRect.fromRectAndRadius(rect, const Radius.circular(4)), fill);
    canvas.drawRRect(RRect.fromRectAndRadius(rect, const Radius.circular(4)), stroke);
  }

  void _drawDetection(Canvas canvas, WsDetectionBox d) {
    final rect = Rect.fromLTWH(d.x * w, d.y * h, d.w * w, d.h * h);
    final paint = Paint()
      ..color = EvColors.detectionBox
      ..style = PaintingStyle.stroke
      ..strokeWidth = 2;
    canvas.drawRect(rect, paint);
    _label(
      canvas,
      '${classLabelFa(d.label)} ٪${faNumber((d.conf * 100).round())}',
      Offset(rect.left, rect.top - 4),
      EvColors.detectionBox,
    );
  }

  /// برچسب متنی کوچک با پس‌زمینهٔ تیره — روی بوم ۶۴۰×۳۶۰.
  void _label(
    Canvas canvas,
    String text,
    Offset at,
    Color color, {
    bool anchorRight = false,
  }) {
    final tp = TextPainter(
      text: TextSpan(
        text: text,
        style: TextStyle(
          color: color,
          fontSize: 10.5,
          fontWeight: FontWeight.w600,
        ),
      ),
      textDirection: TextDirection.rtl,
    )..layout();
    final wBox = tp.width + 8;
    final hBox = tp.height + 4;
    Offset origin;
    if (anchorRight) {
      origin = Offset(at.dx - wBox, at.dy - hBox);
    } else {
      origin = Offset(at.dx - wBox / 2, at.dy - hBox);
    }
    // مهار داخل بوم
    final ox = origin.dx.clamp(0.0, w - wBox);
    final oy = origin.dy.clamp(0.0, h - hBox);
    final bg = Paint()..color = const Color(0xE0181818);
    canvas.drawRRect(
      RRect.fromRectAndRadius(
        Rect.fromLTWH(ox, oy, wBox, hBox),
        const Radius.circular(3),
      ),
      bg,
    );
    tp.paint(canvas, Offset(ox + 4, oy + 2));
  }

  @override
  bool shouldRepaint(ScenePainter oldDelegate) =>
      oldDelegate.frame != frame ||
      oldDelegate.scene != scene ||
      oldDelegate.roi != roi ||
      oldDelegate.line != line;
}
