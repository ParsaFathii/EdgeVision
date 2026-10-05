// EdgeVision — کلاینت موبایل
// Copyright © 2026 Parsa Fathi — Apache-2.0

/// مدل‌های دادهٔ کلاینت — تجزیهٔJSON سرور با سازگاری نسبت به اشکال واقعی.
///
/// پاسخ‌های واقعی سرور گاهی فیلدهای اختیاری را ندارد، تاریخ‌ها رشتهٔ
/// ISO-8601 UTC هستند و متریک‌ها یک‌بار تخت (ردیف پایگاه‌داده) و یک‌بار
/// با «latency» تودرتو (پیام WebSocket) می‌آیند — همهٔ این‌ها تحمل می‌شود.
library;

import 'dart:convert';

// — — — کمکی‌های تجزیه — — —

Map<String, dynamic> _asMap(Object? v) =>
    v is Map<String, dynamic> ? v : <String, dynamic>{};

List<dynamic> _asList(Object? v) => v is List ? v : <dynamic>[];

int _int(Object? v, int fallback) => v is num ? v.round() : fallback;

double _dbl(Object? v, double fallback) => v is num ? v.toDouble() : fallback;

String _str(Object? v, String fallback) => v is String ? v : fallback;

bool _bool(Object? v, bool fallback) => v is bool ? v : fallback;

DateTime? _date(Object? v) => v is String ? DateTime.tryParse(v) : null;

// — — — هدر پدرش — — —

/// پاسخ /api/v1/health.
class Health {
  Health({
    required this.status,
    required this.db,
    required this.engine,
    required this.engineBinary,
    required this.activeSessions,
    required this.version,
    required this.uptimeSec,
  });

  factory Health.fromJson(Map<String, dynamic> json) => Health(
        status: _str(json['status'], 'degraded'),
        db: _bool(json['db'], false),
        engine: _bool(json['engine'], false),
        engineBinary: _bool(json['engineBinary'], false),
        activeSessions: _int(json['activeSessions'], 0),
        version: _str(json['version'], '—'),
        uptimeSec: _int(json['uptimeSec'], 0),
      );

  final String status;
  final bool db;
  final bool engine;
  final bool engineBinary;
  final int activeSessions;
  final String version;
  final int uptimeSec;

  bool get ok => status == 'ok';
}

// — — — هندسه — — —

/// ناحیهٔ پایش (ROI) با مختصات نرمال‌شده ۰..۱.
class Roi {
  const Roi({required this.x, required this.y, required this.w, required this.h});

  factory Roi.fromJson(Map<String, dynamic> json) => Roi(
        x: _dbl(json['x'], 0),
        y: _dbl(json['y'], 0),
        w: _dbl(json['w'], 0),
        h: _dbl(json['h'], 0),
      );

  factory Roi.maybe(Object? v) =>
      v is Map<String, dynamic> ? Roi.fromJson(v) : const Roi(x: 0, y: 0, w: 0, h: 0);

  final double x;
  final double y;
  final double w;
  final double h;

  bool get isValid => w > 0 && h > 0;

  Map<String, dynamic> toJson() => {'x': x, 'y': y, 'w': w, 'h': h};
}

/// خط عبور با مختصات نرمال‌شده ۰..۱.
class CrossLine {
  const CrossLine({
    required this.x1,
    required this.y1,
    required this.x2,
    required this.y2,
  });

  factory CrossLine.fromJson(Map<String, dynamic> json) => CrossLine(
        x1: _dbl(json['x1'], 0),
        y1: _dbl(json['y1'], 0),
        x2: _dbl(json['x2'], 0),
        y2: _dbl(json['y2'], 0),
      );

  factory CrossLine.maybe(Object? v) => v is Map<String, dynamic>
      ? CrossLine.fromJson(v)
      : const CrossLine(x1: 0, y1: 0, x2: 0, y2: 0);

  final double x1;
  final double y1;
  final double x2;
  final double y2;

  bool get isValid => x1 != x2 || y1 != y2;

  Map<String, dynamic> toJson() => {'x1': x1, 'y1': y1, 'x2': x2, 'y2': y2};
}

// — — — نشست‌ها — — —

/// نشست فعال (از snapshot سرویس پردازش).
class ActiveSession {
  ActiveSession({
    required this.streamId,
    required this.sessionId,
    required this.state,
    required this.startedAt,
    required this.framesProcessed,
    required this.detectionsTotal,
  });

  factory ActiveSession.fromJson(Map<String, dynamic> json) => ActiveSession(
        streamId: _str(json['streamId'], ''),
        sessionId: _str(json['sessionId'], ''),
        state: _str(json['state'], 'STARTING'),
        startedAt: _date(json['startedAt']) ?? DateTime.fromMillisecondsSinceEpoch(0),
        framesProcessed: _int(json['framesProcessed'], 0),
        detectionsTotal: _int(json['detectionsTotal'], 0),
      );

  static ActiveSession? maybe(Object? v) => v is Map<String, dynamic>
      ? ActiveSession.fromJson(v)
      : null;

  final String streamId;
  final String sessionId;
  final String state;
  final DateTime startedAt;
  final int framesProcessed;
  final int detectionsTotal;
}

/// ردیف نشست در تاریخچه (sessions).
class SessionRecord {
  SessionRecord({
    required this.id,
    required this.streamId,
    required this.state,
    this.reason,
    required this.startedAt,
    this.endedAt,
    required this.framesProcessed,
    required this.framesDropped,
    required this.detectionsTotal,
    required this.eventsTotal,
  });

  factory SessionRecord.fromJson(Map<String, dynamic> json) => SessionRecord(
        id: _str(json['id'], ''),
        streamId: _str(json['streamId'], ''),
        state: _str(json['state'], ''),
        reason: json['reason'] is String ? json['reason'] as String : null,
        startedAt: _date(json['startedAt']) ?? DateTime.fromMillisecondsSinceEpoch(0),
        endedAt: _date(json['endedAt']),
        framesProcessed: _int(json['framesProcessed'], 0),
        framesDropped: _int(json['framesDropped'], 0),
        detectionsTotal: _int(json['detectionsTotal'], 0),
        eventsTotal: _int(json['eventsTotal'], 0),
      );

  final String id;
  final String streamId;
  final String state;
  final String? reason;
  final DateTime startedAt;
  final DateTime? endedAt;
  final int framesProcessed;
  final int framesDropped;
  final int detectionsTotal;
  final int eventsTotal;

  Duration get duration =>
      endedAt != null ? endedAt!.difference(startedAt) : DateTime.now().difference(startedAt);
}

// — — — متریک‌ها — — —

/// نمونهٔ متریک — هم ردیف پایگاه‌داده (latency تخت) و هم پیام WebSocket
/// (latency تودرتو) را می‌پذیرد.
class MetricSample {
  MetricSample({
    required this.ts,
    required this.sourceFps,
    required this.processedFps,
    required this.latencyAvgMs,
    required this.latencyMinMs,
    required this.latencyMaxMs,
    required this.latencyP50Ms,
    required this.latencyP95Ms,
    required this.queueDepth,
    this.queueCapacity,
    required this.droppedTotal,
    required this.cpuPercent,
    required this.memoryMb,
    required this.framesProcessed,
    required this.detectionsTotal,
    this.uptimeMs,
  });

  factory MetricSample.fromJson(Map<String, dynamic> json) {
    final lat = _asMap(json['latency']);
    final ts = json['ts'] is num
        ? DateTime.fromMillisecondsSinceEpoch((json['ts'] as num).round())
        : (_date(json['ts']) ?? DateTime.fromMillisecondsSinceEpoch(0));
    return MetricSample(
      ts: ts,
      sourceFps: _dbl(json['sourceFps'], 0),
      processedFps: _dbl(json['processedFps'], 0),
      latencyAvgMs: _dbl(json['latencyAvgMs'] ?? lat['avgMs'], 0),
      latencyMinMs: _dbl(json['latencyMinMs'] ?? lat['minMs'], 0),
      latencyMaxMs: _dbl(json['latencyMaxMs'] ?? lat['maxMs'], 0),
      latencyP50Ms: _dbl(json['latencyP50Ms'] ?? lat['p50Ms'], 0),
      latencyP95Ms: _dbl(json['latencyP95Ms'] ?? lat['p95Ms'], 0),
      queueDepth: _int(json['queueDepth'], 0),
      queueCapacity: json['queueCapacity'] is num
          ? (json['queueCapacity'] as num).round()
          : null,
      droppedTotal: _int(json['droppedTotal'], 0),
      cpuPercent: _dbl(json['cpuPercent'], 0),
      memoryMb: _dbl(json['memoryMb'], 0),
      framesProcessed: _int(json['framesProcessed'], 0),
      detectionsTotal: _int(json['detectionsTotal'], 0),
      uptimeMs: json['uptimeMs'] is num ? (json['uptimeMs'] as num).round() : null,
    );
  }

  static MetricSample? maybe(Object? v) =>
      v is Map<String, dynamic> ? MetricSample.fromJson(v) : null;

  final DateTime ts;
  final double sourceFps;
  final double processedFps;
  final double latencyAvgMs;
  final double latencyMinMs;
  final double latencyMaxMs;
  final double latencyP50Ms;
  final double latencyP95Ms;
  final int queueDepth;
  final int? queueCapacity;
  final int droppedTotal;
  final double cpuPercent;
  final double memoryMb;
  final int framesProcessed;
  final int detectionsTotal;
  final int? uptimeMs;
}

/// یک بازهٔ زمانی در پاسخ /metrics.
class MetricsBucket {
  MetricsBucket({
    required this.ts,
    required this.samples,
    required this.avgSourceFps,
    required this.avgProcessedFps,
    required this.avgLatencyMs,
    required this.maxQueueDepth,
    required this.avgDropped,
    required this.avgCpuPercent,
    required this.avgMemoryMb,
  });

  factory MetricsBucket.fromJson(Map<String, dynamic> json) => MetricsBucket(
        ts: json['ts'] is num
            ? DateTime.fromMillisecondsSinceEpoch((json['ts'] as num).round())
            : DateTime.fromMillisecondsSinceEpoch(0),
        samples: _int(json['samples'], 0),
        avgSourceFps: _dbl(json['avgSourceFps'], 0),
        avgProcessedFps: _dbl(json['avgProcessedFps'], 0),
        avgLatencyMs: _dbl(json['avgLatencyMs'], 0),
        maxQueueDepth: _int(json['maxQueueDepth'], 0),
        avgDropped: _dbl(json['avgDropped'], 0),
        avgCpuPercent: _dbl(json['avgCpuPercent'], 0),
        avgMemoryMb: _dbl(json['avgMemoryMb'], 0),
      );

  final DateTime ts;
  final int samples;
  final double avgSourceFps;
  final double avgProcessedFps;
  final double avgLatencyMs;
  final int maxQueueDepth;
  final double avgDropped;
  final double avgCpuPercent;
  final double avgMemoryMb;
}

/// خلاصهٔ کلی متریک‌ها.
class MetricsSummary {
  MetricsSummary({
    required this.samples,
    required this.avgSourceFps,
    required this.avgProcessedFps,
    required this.avgLatencyMs,
    required this.minLatencyMs,
    required this.maxLatencyMs,
    required this.maxQueueDepth,
    required this.maxDropped,
    required this.avgCpuPercent,
    required this.avgMemoryMb,
    required this.maxFramesProcessed,
    required this.maxDetections,
  });

  factory MetricsSummary.fromJson(Map<String, dynamic> json) => MetricsSummary(
        samples: _int(json['samples'], 0),
        avgSourceFps: _dbl(json['avgSourceFps'], 0),
        avgProcessedFps: _dbl(json['avgProcessedFps'], 0),
        avgLatencyMs: _dbl(json['avgLatencyMs'], 0),
        minLatencyMs: _dbl(json['minLatencyMs'], 0),
        maxLatencyMs: _dbl(json['maxLatencyMs'], 0),
        maxQueueDepth: _int(json['maxQueueDepth'], 0),
        maxDropped: _int(json['maxDropped'], 0),
        avgCpuPercent: _dbl(json['avgCpuPercent'], 0),
        avgMemoryMb: _dbl(json['avgMemoryMb'], 0),
        maxFramesProcessed: _int(json['maxFramesProcessed'], 0),
        maxDetections: _int(json['maxDetections'], 0),
      );

  final int samples;
  final double avgSourceFps;
  final double avgProcessedFps;
  final double avgLatencyMs;
  final double minLatencyMs;
  final double maxLatencyMs;
  final int maxQueueDepth;
  final int maxDropped;
  final double avgCpuPercent;
  final double avgMemoryMb;
  final int maxFramesProcessed;
  final int maxDetections;
}

/// پاسخ /metrics (بازه‌بندی‌شده).
class MetricsResponse {
  MetricsResponse({
    required this.bucket,
    required this.buckets,
    required this.summary,
  });

  factory MetricsResponse.fromJson(Map<String, dynamic> json) =>
      MetricsResponse(
        bucket: _str(json['bucket'], '30s'),
        buckets: [
          for (final b in _asList(json['buckets']))
            if (b is Map<String, dynamic>) MetricsBucket.fromJson(b),
        ],
        summary: MetricsSummary.fromJson(_asMap(json['summary'])),
      );

  final String bucket;
  final List<MetricsBucket> buckets;
  final MetricsSummary summary;
}

/// نشست زنده در پاسخ /metrics?live=1 (ورودی + متریک آخر).
class LiveSessionEntry {
  LiveSessionEntry({required this.session, required this.metric});

  factory LiveSessionEntry.fromJson(Map<String, dynamic> json) =>
      LiveSessionEntry(
        session: ActiveSession.fromJson(json),
        metric: MetricSample.maybe(json['metric']),
      );

  final ActiveSession session;
  final MetricSample? metric;
}

/// پاسخ /metrics?live=1.
class LiveMetrics {
  LiveMetrics({required this.sessions});

  factory LiveMetrics.fromJson(Map<String, dynamic> json) => LiveMetrics(
        sessions: [
          for (final s in _asList(json['sessions']))
            if (s is Map<String, dynamic>) LiveSessionEntry.fromJson(s),
        ],
      );

  final List<LiveSessionEntry> sessions;
}

// — — — استریم‌ها — — —

/// یک استریم + نشست فعال آن.
class StreamItem {
  StreamItem({
    required this.id,
    required this.name,
    required this.scene,
    required this.sourceType,
    required this.width,
    required this.height,
    required this.targetFps,
    required this.objectCount,
    required this.confidenceThreshold,
    required this.classFilter,
    this.roi,
    this.line,
    required this.queueCapacity,
    required this.gridCols,
    required this.gridRows,
    required this.emitStride,
    required this.status,
    required this.createdAt,
    required this.updatedAt,
    this.activeSession,
    this.latestMetric,
  });

  factory StreamItem.fromJson(Map<String, dynamic> json) {
    // classFilterJson/roiJson/lineJson رشته‌های JSON هستند.
    List<String> classFilter = <String>[];
    final cfj = json['classFilterJson'];
    if (cfj is String && cfj.isNotEmpty) {
      classFilter = parseStringArray(cfj);
    } else if (json['classFilter'] is List) {
      classFilter = [
        for (final c in json['classFilter'] as List<dynamic>)
          if (c is String) c,
      ];
    }
    return StreamItem(
      id: _str(json['id'], ''),
      name: _str(json['name'], ''),
      scene: _str(json['scene'], 'STREET'),
      sourceType: _str(json['sourceType'], 'SYNTHETIC'),
      width: _int(json['width'], 640),
      height: _int(json['height'], 360),
      targetFps: _dbl(json['targetFps'], 15),
      objectCount: _int(json['objectCount'], 8),
      confidenceThreshold: _dbl(json['confidenceThreshold'], 0.35),
      classFilter: classFilter,
      roi: json['roiJson'] is String
          ? parseRoi(json['roiJson'] as String)
          : Roi.maybe(json['roi']),
      line: json['lineJson'] is String
          ? parseLine(json['lineJson'] as String)
          : CrossLine.maybe(json['line']),
      queueCapacity: _int(json['queueCapacity'], 30),
      gridCols: _int(json['gridCols'], 40),
      gridRows: _int(json['gridRows'], 24),
      emitStride: _int(json['emitStride'], 2),
      status: _str(json['status'], 'IDLE'),
      createdAt: _date(json['createdAt']) ?? DateTime.fromMillisecondsSinceEpoch(0),
      updatedAt: _date(json['updatedAt']) ?? DateTime.fromMillisecondsSinceEpoch(0),
      activeSession: ActiveSession.maybe(json['activeSession']),
      latestMetric: MetricSample.maybe(json['latestMetric']),
    );
  }

  /// تجزیهٔ آرایهٔ رشته‌ای از JSON خام؛ در صورت خطا آرایهٔ خالی.
  static List<String> parseStringArray(String raw) {
    try {
      final decoded = jsonDecode(raw);
      if (decoded is List) {
        return <String>[
          for (final c in decoded)
            if (c is String) c,
        ];
      }
    } on FormatException {
      // JSON خراب — به شکل خالی تحمل می‌شود.
    }
    return <String>[];
  }

  /// تجزیهٔ ROI از رشتهٔ JSON؛ null در صورت نبود/خرابی.
  static Roi? parseRoi(String raw) {
    try {
      final decoded = jsonDecode(raw);
      if (decoded is Map<String, dynamic>) {
        final roi = Roi.fromJson(decoded);
        return roi.isValid ? roi : null;
      }
    } on FormatException {
      // نادیده گرفته می‌شود.
    }
    return null;
  }

  /// تجزیهٔ خط عبور از رشتهٔ JSON؛ null در صورت نبود/خرابی.
  static CrossLine? parseLine(String raw) {
    try {
      final decoded = jsonDecode(raw);
      if (decoded is Map<String, dynamic>) {
        final line = CrossLine.fromJson(decoded);
        return line.isValid ? line : null;
      }
    } on FormatException {
      // نادیده گرفته می‌شود.
    }
    return null;
  }

  final String id;
  final String name;
  final String scene;
  final String sourceType;
  final int width;
  final int height;
  final double targetFps;
  final int objectCount;
  final double confidenceThreshold;
  final List<String> classFilter;
  final Roi? roi;
  final CrossLine? line;
  final int queueCapacity;
  final int gridCols;
  final int gridRows;
  final int emitStride;
  final String status;
  final DateTime createdAt;
  final DateTime updatedAt;
  final ActiveSession? activeSession;
  final MetricSample? latestMetric;

  bool get hasActiveSession => activeSession != null;
}

/// بدنهٔ ایجاد/ویرایش استریم (برای POST /streams و PATCH /streams/:id).
class StreamInput {
  StreamInput({
    required this.name,
    required this.scene,
    required this.width,
    required this.height,
    required this.targetFps,
    required this.objectCount,
    required this.confidenceThreshold,
    required this.classFilter,
    this.roi,
    this.line,
    required this.queueCapacity,
    required this.gridCols,
    required this.gridRows,
    required this.emitStride,
  });

  factory StreamInput.fromStream(StreamItem s) => StreamInput(
        name: s.name,
        scene: s.scene,
        width: s.width,
        height: s.height,
        targetFps: s.targetFps,
        objectCount: s.objectCount,
        confidenceThreshold: s.confidenceThreshold,
        classFilter: List<String>.of(s.classFilter),
        roi: s.roi,
        line: s.line,
        queueCapacity: s.queueCapacity,
        gridCols: s.gridCols,
        gridRows: s.gridRows,
        emitStride: s.emitStride,
      );

  final String name;
  final String scene;
  final int width;
  final int height;
  final double targetFps;
  final int objectCount;
  final double confidenceThreshold;
  final List<String> classFilter;
  final Roi? roi;
  final CrossLine? line;
  final int queueCapacity;
  final int gridCols;
  final int gridRows;
  final int emitStride;

  Map<String, dynamic> toJson({bool full = true}) => <String, dynamic>{
        'name': name,
        'scene': scene,
        'width': width,
        'height': height,
        'targetFps': targetFps,
        'objectCount': objectCount,
        'confidenceThreshold': confidenceThreshold,
        'classFilter': classFilter,
        'roi': roi?.toJson(),
        'line': line?.toJson(),
        'queueCapacity': queueCapacity,
        'gridCols': gridCols,
        'gridRows': gridRows,
        'emitStride': emitStride,
      };
}

// — — — تشخیص‌ها — — —

/// یک ردیف تشخیص.
class Detection {
  Detection({
    required this.id,
    required this.sessionId,
    required this.streamId,
    required this.frameIndex,
    required this.ts,
    required this.label,
    required this.confidence,
    required this.trackId,
    required this.x,
    required this.y,
    required this.w,
    required this.h,
  });

  factory Detection.fromJson(Map<String, dynamic> json) => Detection(
        id: _int(json['id'], 0),
        sessionId: _str(json['sessionId'], ''),
        streamId: _str(json['streamId'], ''),
        frameIndex: _int(json['frameIndex'], 0),
        ts: _date(json['ts']) ?? DateTime.fromMillisecondsSinceEpoch(0),
        label: _str(json['label'], '—'),
        confidence: _dbl(json['confidence'], 0),
        trackId: _int(json['trackId'], 0),
        x: _dbl(json['x'], 0),
        y: _dbl(json['y'], 0),
        w: _dbl(json['w'], 0),
        h: _dbl(json['h'], 0),
      );

  final int id;
  final String sessionId;
  final String streamId;
  final int frameIndex;
  final DateTime ts;
  final String label;
  final double confidence;
  final int trackId;
  final double x;
  final double y;
  final double w;
  final double h;
}

/// برچسب + تعداد (detections/labels و گروه‌بندی‌های گزارش).
class LabelCount {
  LabelCount({required this.label, required this.count});

  factory LabelCount.fromJson(Map<String, dynamic> json) =>
      LabelCount(label: _str(json['label'], '—'), count: _int(json['count'], 0));

  final String label;
  final int count;
}

// — — — رویدادها — — —

/// یک رویداد (payload به شکل خام JSON نگه داشته می‌شود).
class EventItem {
  EventItem({
    required this.id,
    required this.sessionId,
    required this.streamId,
    required this.type,
    this.trackId,
    this.label,
    required this.payload,
    required this.ts,
    required this.createdAt,
  });

  factory EventItem.fromJson(Map<String, dynamic> json) => EventItem(
        id: _int(json['id'], 0),
        sessionId: _str(json['sessionId'], ''),
        streamId: _str(json['streamId'], ''),
        type: _str(json['type'], '—'),
        trackId: json['trackId'] is num ? (json['trackId'] as num).round() : null,
        label: json['label'] is String ? json['label'] as String : null,
        payload: json['payload'],
        ts: _date(json['ts']) ?? DateTime.fromMillisecondsSinceEpoch(0),
        createdAt: _date(json['createdAt']) ?? DateTime.fromMillisecondsSinceEpoch(0),
      );

  final int id;
  final String sessionId;
  final String streamId;
  final String type;
  final int? trackId;
  final String? label;
  final Object? payload;
  final DateTime ts;
  final DateTime createdAt;
}

// — — — مدل‌ها — — —

/// یک مدل از رجیستری مدل‌ها.
class ModelInfo {
  ModelInfo({
    required this.id,
    required this.name,
    required this.task,
    required this.format,
    required this.device,
    required this.inputShape,
    required this.classes,
    this.sizeBytes,
    this.license,
    this.description,
    required this.isActive,
    required this.createdAt,
    required this.updatedAt,
  });

  factory ModelInfo.fromJson(Map<String, dynamic> json) {
    var classes = <String>[];
    final cj = json['classesJson'];
    if (cj is String && cj.isNotEmpty) {
      classes = StreamItem.parseStringArray(cj);
    } else if (json['classes'] is List) {
      classes = [
        for (final c in json['classes'] as List<dynamic>)
          if (c is String) c,
      ];
    }
    return ModelInfo(
      id: _str(json['id'], ''),
      name: _str(json['name'], ''),
      task: _str(json['task'], '—'),
      format: _str(json['format'], '—'),
      device: _str(json['device'], '—'),
      inputShape: _str(json['inputShape'], '—'),
      classes: classes,
      sizeBytes: json['sizeBytes'] is num ? (json['sizeBytes'] as num).round() : null,
      license: json['license'] is String ? json['license'] as String : null,
      description:
          json['description'] is String ? json['description'] as String : null,
      isActive: _bool(json['isActive'], false),
      createdAt: _date(json['createdAt']) ?? DateTime.fromMillisecondsSinceEpoch(0),
      updatedAt: _date(json['updatedAt']) ?? DateTime.fromMillisecondsSinceEpoch(0),
    );
  }

  final String id;
  final String name;
  final String task;
  final String format;
  final String device;
  final String inputShape;
  final List<String> classes;
  final int? sizeBytes;
  final String? license;
  final String? description;
  final bool isActive;
  final DateTime createdAt;
  final DateTime updatedAt;
}

// — — — تنظیمات — — —

/// تنظیمات سرویس (GET/PATCH /settings).
class AppSettings {
  AppSettings({
    required this.defaultGridCols,
    required this.defaultGridRows,
    required this.defaultQueueCapacity,
    required this.defaultEmitStride,
    required this.metricsPersistEvery,
  });

  factory AppSettings.fromJson(Map<String, dynamic> json) => AppSettings(
        defaultGridCols: _int(json['defaultGridCols'], 40),
        defaultGridRows: _int(json['defaultGridRows'], 24),
        defaultQueueCapacity: _int(json['defaultQueueCapacity'], 30),
        defaultEmitStride: _int(json['defaultEmitStride'], 2),
        metricsPersistEvery: _int(json['metricsPersistEvery'], 2),
      );

  final int defaultGridCols;
  final int defaultGridRows;
  final int defaultQueueCapacity;
  final int defaultEmitStride;
  final int metricsPersistEvery;

  Map<String, dynamic> toPatch() => <String, dynamic>{
        'defaultGridCols': defaultGridCols,
        'defaultGridRows': defaultGridRows,
        'defaultQueueCapacity': defaultQueueCapacity,
        'defaultEmitStride': defaultEmitStride,
      };
}

// — — — گزارش — — —

/// خلاصهٔ هر استریم در گزارش JSON.
class ReportStreamSummary {
  ReportStreamSummary({
    required this.streamId,
    required this.name,
    required this.sessions,
    required this.detections,
    required this.events,
  });

  factory ReportStreamSummary.fromJson(Map<String, dynamic> json) =>
      ReportStreamSummary(
        streamId: _str(json['streamId'], ''),
        name: _str(json['name'], ''),
        sessions: _int(json['sessions'], 0),
        detections: _int(json['detections'], 0),
        events: _int(json['events'], 0),
      );

  final String streamId;
  final String name;
  final int sessions;
  final int detections;
  final int events;
}

/// نوع + تعداد رویداد.
class TypeCount {
  TypeCount({required this.type, required this.count});

  factory TypeCount.fromJson(Map<String, dynamic> json) =>
      TypeCount(type: _str(json['type'], '—'), count: _int(json['count'], 0));

  final String type;
  final int count;
}

/// مسیر (track) پرتکرار.
class TrackCount {
  TrackCount({required this.trackId, required this.label, required this.count});

  factory TrackCount.fromJson(Map<String, dynamic> json) => TrackCount(
        trackId: _int(json['trackId'], 0),
        label: _str(json['label'], '—'),
        count: _int(json['count'], 0),
      );

  final int trackId;
  final String label;
  final int count;
}

/// گزارش JSON (GET /reports?format=json).
class Report {
  Report({
    required this.generatedAt,
    required this.rangeFrom,
    required this.rangeTo,
    required this.streamsSummary,
    required this.sessionsCount,
    required this.detectionsByLabel,
    required this.eventsByType,
    required this.avgSourceFps,
    required this.avgProcessedFps,
    required this.avgLatencyMs,
    required this.avgCpuPercent,
    required this.avgMemoryMb,
    required this.maxQueueDepth,
    required this.metricsSamples,
    required this.topTracks,
  });

  factory Report.fromJson(Map<String, dynamic> json) {
    final range = _asMap(json['range']);
    final avg = _asMap(json['metricsAverages']);
    return Report(
      generatedAt: _date(json['generatedAt']) ?? DateTime.fromMillisecondsSinceEpoch(0),
      rangeFrom: _date(range['from']),
      rangeTo: _date(range['to']),
      streamsSummary: [
        for (final s in _asList(json['streamsSummary']))
          if (s is Map<String, dynamic>) ReportStreamSummary.fromJson(s),
      ],
      sessionsCount: _int(json['sessionsCount'], 0),
      detectionsByLabel: [
        for (final l in _asList(json['detectionsByLabel']))
          if (l is Map<String, dynamic>) LabelCount.fromJson(l),
      ],
      eventsByType: [
        for (final t in _asList(json['eventsByType']))
          if (t is Map<String, dynamic>) TypeCount.fromJson(t),
      ],
      avgSourceFps: _dbl(avg['avgSourceFps'], 0),
      avgProcessedFps: _dbl(avg['avgProcessedFps'], 0),
      avgLatencyMs: _dbl(avg['avgLatencyMs'], 0),
      avgCpuPercent: _dbl(avg['avgCpuPercent'], 0),
      avgMemoryMb: _dbl(avg['avgMemoryMb'], 0),
      maxQueueDepth: _int(avg['maxQueueDepth'], 0),
      metricsSamples: _int(avg['samples'], 0),
      topTracks: [
        for (final t in _asList(json['topTracks']))
          if (t is Map<String, dynamic>) TrackCount.fromJson(t),
      ],
    );
  }

  final DateTime generatedAt;
  final DateTime? rangeFrom;
  final DateTime? rangeTo;
  final List<ReportStreamSummary> streamsSummary;
  final int sessionsCount;
  final List<LabelCount> detectionsByLabel;
  final List<TypeCount> eventsByType;
  final double avgSourceFps;
  final double avgProcessedFps;
  final double avgLatencyMs;
  final double avgCpuPercent;
  final double avgMemoryMb;
  final int maxQueueDepth;
  final int metricsSamples;
  final List<TrackCount> topTracks;
}

// — — — صفحه‌بندی — — —

/// پاکت صفحه‌بندی‌شدهٔ {items,total,page,pageSize}.
class Paged<T> {
  Paged({
    required this.items,
    required this.total,
    required this.page,
    required this.pageSize,
  });

  static Paged<T> fromJson<T>(
    Map<String, dynamic> json,
    T Function(Map<String, dynamic>) parse,
  ) =>
      Paged<T>(
        items: [
          for (final item in _asList(json['items']))
            if (item is Map<String, dynamic>) parse(item),
        ],
        total: _int(json['total'], 0),
        page: _int(json['page'], 1),
        pageSize: _int(json['pageSize'], 25),
      );

  final List<T> items;
  final int total;
  final int page;
  final int pageSize;

  int get totalPages => total <= 0 ? 0 : ((total + pageSize - 1) ~/ pageSize);

  bool get hasNext => page < totalPages;

  bool get hasPrev => page > 1;
}
