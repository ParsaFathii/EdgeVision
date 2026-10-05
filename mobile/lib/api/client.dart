// EdgeVision — کلاینت موبایل
// Copyright © 2026 Parsa Fathi — Apache-2.0

import 'dart:async';
import 'dart:convert';
import 'dart:io' show Platform;

import 'package:http/http.dart' as http;

import 'models.dart';

/// پیشوند مسیر API روی سرور Next.js.
const String apiPrefix = '/api/v1';

/// نشانی پیش‌فرض سرور بر اساس سکوی اجرا:
/// شبیه‌ساز اندروید به میزبان خودش با 10.0.2.2 می‌رسد؛ دسکتاپ با localhost.
String defaultBaseUrl() {
  var isAndroid = false;
  try {
    isAndroid = Platform.isAndroid;
  } on UnsupportedError {
    // وب و سکوهای بدون dart:io — همان localhost.
    isAndroid = false;
  }
  return isAndroid ? 'http://10.0.2.2:3000' : 'http://localhost:3000';
}

/// خطای API با پیام فارسی — همهٔ لایه‌های رابط کاربری این را نمایش می‌دهند.
class ApiException implements Exception {
  ApiException({
    required this.message,
    this.statusCode,
    this.code,
    this.details = const <String>[],
  });

  /// نگاشت خطای شبکه/پاسخ به پیام فارسی استاندارد.
  factory ApiException.fromNetwork(Object error) {
    if (error is TimeoutException) {
      return ApiException(
        message: 'پاسخ سرور بیش از حد انتظار طول کشید',
        code: 'TIMEOUT',
      );
    }
    return ApiException(
      message: 'ارتباط با سرور برقرار نشد',
      code: 'NETWORK',
    );
  }

  /// نگاشت پاسخ HTTP ناموفق — پیام و جزئیات فارسی سرور ترجیح داده می‌شود.
  factory ApiException.fromResponse(http.Response response) {
    Map<String, dynamic> envelope = <String, dynamic>{};
    try {
      final decoded = jsonDecode(utf8.decode(response.bodyBytes));
      if (decoded is Map<String, dynamic>) {
        final err = decoded['error'];
        if (err is Map<String, dynamic>) envelope = err;
      }
    } on FormatException {
      // بدنهٔ JSON نیست — با پیام کلی وضعیت ادامه می‌دهیم.
    }

    final serverMessage =
        envelope['message'] is String ? envelope['message'] as String : null;
    final serverCode =
        envelope['code'] is String ? envelope['code'] as String : null;
    final details = <String>[
      if (envelope['details'] is List)
        for (final d in envelope['details'] as List<dynamic>)
          if (d is String) d,
    ];

    final fallback = switch (response.statusCode) {
      400 => 'داده‌های ورودی نامعتبر است',
      401 => 'دسترسی مجاز نیست',
      404 => 'موردی یافت نشد',
      409 => 'تعارض با وضعیت فعلی سرور',
      413 => 'حجم درخواست بیش از حد مجاز است',
      429 => 'درخواست‌های بیش از حد مجاز؛ کمی صبر کنید',
      500 => 'خطای داخلی سرور',
      502 || 503 || 504 => 'سرویس پردازش در دسترس نیست',
      _ => 'درخواست با خطای ${response.statusCode} ناکام ماند',
    };

    return ApiException(
      message: serverMessage ?? fallback,
      statusCode: response.statusCode,
      code: serverCode,
      details: details,
    );
  }

  final String message;
  final int? statusCode;
  final String? code;
  final List<String> details;

  @override
  String toString() => message;
}

Uri? _parseBase(String raw) {
  final trimmed = raw.trim();
  if (trimmed.isEmpty) return null;
  Uri uri;
  try {
    uri = Uri.parse(trimmed);
  } on FormatException {
    return null;
  }
  if (uri.scheme != 'http' && uri.scheme != 'https') return null;
  if (uri.host.isEmpty) return null;
  if (uri.path.isNotEmpty && uri.path != '/') return null;
  return uri.replace(path: '');
}

/// پیکربندی نشانی سرور + ساخت نشانی WebSocket مستقیم سرویس پردازش.
class ApiConfig {
  ApiConfig({String? baseUrl}) : baseUrl = baseUrl ?? defaultBaseUrl();

  /// نشانی پایهٔ REST (مثل http://10.0.2.2:3000).
  String baseUrl;

  /// نشانی API — پس از اعتبارسنجی نشانی پایه.
  Uri get restUri {
    final base = _parseBase(baseUrl);
    if (base == null) {
      throw ApiException(
        message: 'نشانی سرور نامعتبر است',
        code: 'BAD_URL',
      );
    }
    return base;
  }

  /// نشانی WebSocket مستقیم socket.io روی سرویس پردازش (پورت ۳۰۰۳).
  ///
  /// قاعده: پورت ۳۰۰۰ به ۳۰۰۳ نگاشت می‌شود (تفکیک REST از realtime)؛
  /// هر پورت دیگری همان می‌ماند. مسیر socket.io با پارامترهای EIO=4
  /// و transport=websocket ساخته می‌شود — سرویس با path «/» کار می‌کند که
  /// پیشوند هر مسیری است، پس نشانی استاندارد socket.io هم پاسخ می‌دهد.
  Uri wsUri() {
    final base = _parseBase(baseUrl);
    if (base == null) {
      throw ApiException(
        message: 'نشانی سرور نامعتبر است',
        code: 'BAD_URL',
      );
    }
    final wsPort = !base.hasPort || base.port == 3000 ? 3003 : base.port;
    final scheme = base.scheme == 'https' ? 'wss' : 'ws';
    return Uri(
      scheme: scheme,
      host: base.host,
      port: wsPort,
      path: 'socket.io/',
      query: 'EIO=4&transport=websocket',
    );
  }

  /// میزبان برای نمایش (بدون طرح).
  String get hostLabel => restUri.authority;
}

/// سرویس REST تایپ‌شده — تمام سطح API نسخهٔ ۱.
class ApiService {
  ApiService({
    ApiConfig? config,
    http.Client? client,
    Duration timeout = const Duration(seconds: 10),
  })  : _config = config ?? ApiConfig(),
        _client = client ?? http.Client(),
        _timeout = timeout;

  final ApiConfig _config;
  final http.Client _client;
  final Duration _timeout;

  /// پیکربندی جاری (نشانی سرور).
  ApiConfig get config => _config;

  /// تغییر نشانی سرور در زمان اجرا (پردهٔ تنظیمات).
  void setBaseUrl(String url) {
    final parsed = _parseBase(url);
    if (parsed == null) {
      throw ApiException(
        message: 'نشانی سرور باید http یا https با میزبان معتبر باشد',
        code: 'BAD_URL',
      );
    }
    _config.baseUrl = url.trim();
  }

  // — — — زیرساخت درخواست — — —

  Uri _uri(String path, [Map<String, String?>? query]) {
    final base = _config.restUri;
    final params = <String, String>{
      if (query != null)
        for (final e in query.entries)
          if (e.value != null && e.value!.isNotEmpty) e.key: e.value!,
    };
    return base.replace(
      path: '$apiPrefix$path',
      queryParameters: params.isEmpty ? null : params,
    );
  }

  Future<dynamic> _getRaw(String path, [Map<String, String?>? query]) async {
    http.Response response;
    try {
      response = await _client.get(_uri(path, query)).timeout(_timeout);
    } on Object catch (error) {
      throw ApiException.fromNetwork(error);
    }
    if (response.statusCode >= 400) throw ApiException.fromResponse(response);
    try {
      return jsonDecode(utf8.decode(response.bodyBytes));
    } on FormatException {
      throw ApiException(
        message: 'پاسخ سرور قابل خواندن نبود',
        code: 'BAD_RESPONSE',
      );
    }
  }

  Future<Map<String, dynamic>> _getJson(String path,
      [Map<String, String?>? query]) async {
    final dynamic body = await _getRaw(path, query);
    if (body is Map<String, dynamic>) return body;
    throw ApiException(
      message: 'پاسخ سرور قابل خواندن نبود',
      code: 'BAD_RESPONSE',
    );
  }

  Future<Map<String, dynamic>> _sendJson(
    String method,
    String path, {
    Map<String, dynamic>? body,
    Duration? timeout,
  }) async {
    http.Response response;
    final uri = _uri(path);
    final effectiveTimeout = timeout ?? _timeout;
    final headers = <String, String>{
      if (body != null) 'content-type': 'application/json; charset=utf-8',
    };
    final encoded = body == null ? null : jsonEncode(body);
    try {
      response = switch (method) {
        'POST' => await _client
            .post(uri, headers: headers, body: encoded)
            .timeout(effectiveTimeout),
        'PATCH' => await _client
            .patch(uri, headers: headers, body: encoded)
            .timeout(effectiveTimeout),
        'DELETE' => await _client.delete(uri).timeout(effectiveTimeout),
        _ => throw StateError('متد پشتیبانی‌نشده: $method'),
      };
    } on Object catch (error) {
      throw ApiException.fromNetwork(error);
    }
    if (response.statusCode >= 400) throw ApiException.fromResponse(response);
    try {
      final decoded = jsonDecode(utf8.decode(response.bodyBytes));
      if (decoded is Map<String, dynamic>) return decoded;
    } on FormatException {
      // بدنهٔ خالی — مثل برخی پاسخ‌های DELETE.
    }
    return <String, dynamic>{};
  }

  static String? _iso(DateTime? d) => d?.toUtc().toIso8601String();

  // — — — سلامت سامانه — — —

  /// GET /api/v1/health
  Future<Health> health() async => Health.fromJson(await _getJson('/health'));

  // — — — استریم‌ها — — —

  /// GET /api/v1/streams — فهرست + نشست فعال هر استریم.
  Future<List<StreamItem>> streams() async {
    final data = await _getJson('/streams');
    return [
      for (final item in (data['items'] as List<dynamic>? ?? <dynamic>[]))
        if (item is Map<String, dynamic>) StreamItem.fromJson(item),
    ];
  }

  /// GET /api/v1/streams/:id — جزئیات + نشست فعال + آخرین متریک.
  Future<StreamItem> streamById(String id) async {
    final data = await _getJson('/streams/${Uri.encodeComponent(id)}');
    return StreamItem.fromJson(data);
  }

  /// POST /api/v1/streams
  Future<StreamItem> createStream(StreamInput input) async {
    final data = await _sendJson('POST', '/streams', body: input.toJson());
    return StreamItem.fromJson(data);
  }

  /// PATCH /api/v1/streams/:id
  Future<StreamItem> updateStream(String id, StreamInput input) async {
    final data = await _sendJson(
      'PATCH',
      '/streams/${Uri.encodeComponent(id)}',
      body: input.toJson(),
    );
    return StreamItem.fromJson(data);
  }

  /// DELETE /api/v1/streams/:id
  Future<void> deleteStream(String id) async {
    await _sendJson('DELETE', '/streams/${Uri.encodeComponent(id)}');
  }

  /// POST /api/v1/streams/:id/start — نشست ایجادشده را برمی‌گرداند.
  Future<ActiveSession?> startStream(String id) => _sendJson(
        'POST',
        '/streams/${Uri.encodeComponent(id)}/start',
        timeout: const Duration(seconds: 15),
      ).then((data) => ActiveSession.maybe(data['session']));

  /// POST /api/v1/streams/:id/stop — نشست متوقف‌شده را برمی‌گرداند.
  Future<ActiveSession?> stopStream(String id) => _sendJson(
        'POST',
        '/streams/${Uri.encodeComponent(id)}/stop',
        timeout: const Duration(seconds: 20),
      ).then((data) => ActiveSession.maybe(data['session']));

  // — — — تشخیص‌ها — — —

  /// GET /api/v1/detections — با فیلترها و صفحه‌بندی.
  Future<Paged<Detection>> detections({
    String? streamId,
    String? sessionId,
    String? label,
    double? minConfidence,
    int? trackId,
    DateTime? from,
    DateTime? to,
    int page = 1,
    int pageSize = 25,
    String sort = 'ts',
    bool asc = false,
  }) async {
    final data = await _getJson('/detections', <String, String?>{
      'streamId': streamId,
      'sessionId': sessionId,
      'label': label,
      'minConfidence': minConfidence?.toString(),
      'trackId': trackId?.toString(),
      'from': _iso(from),
      'to': _iso(to),
      'page': page.toString(),
      'pageSize': pageSize.toString(),
      'sort': sort,
      'order': asc ? 'asc' : 'desc',
    });
    return Paged.fromJson(data, Detection.fromJson);
  }

  /// GET /api/v1/detections/labels — برچسب‌های متمایز با تعداد.
  Future<List<LabelCount>> detectionLabels({String? streamId}) async {
    final dynamic data = await _getRaw('/detections/labels', <String, String?>{
      'streamId': streamId,
    });
    if (data is List) {
      return [
        for (final item in data)
          if (item is Map<String, dynamic>) LabelCount.fromJson(item),
      ];
    }
    return <LabelCount>[];
  }

  // — — — رویدادها — — —

  /// GET /api/v1/events — با فیلترها و صفحه‌بندی.
  Future<Paged<EventItem>> events({
    String? streamId,
    String? type,
    DateTime? from,
    DateTime? to,
    int page = 1,
    int pageSize = 25,
  }) async {
    final data = await _getJson('/events', <String, String?>{
      'streamId': streamId,
      'type': type,
      'from': _iso(from),
      'to': _iso(to),
      'page': page.toString(),
      'pageSize': pageSize.toString(),
    });
    return Paged.fromJson(data, EventItem.fromJson);
  }

  // — — — متریک‌ها — — —

  /// GET /api/v1/metrics — بازه‌بندی‌شده (bucket=1s|5s|30s|1m).
  Future<MetricsResponse> metrics({
    String? streamId,
    String? sessionId,
    DateTime? from,
    DateTime? to,
    String bucket = '30s',
  }) async {
    final data = await _getJson('/metrics', <String, String?>{
      'streamId': streamId,
      'sessionId': sessionId,
      'from': _iso(from),
      'to': _iso(to),
      'bucket': bucket,
    });
    return MetricsResponse.fromJson(data);
  }

  /// GET /api/v1/metrics?live=1 — آخرین متریک هر نشست زنده.
  Future<LiveMetrics> liveMetrics() async {
    final data = await _getJson('/metrics', <String, String?>{'live': '1'});
    return LiveMetrics.fromJson(data);
  }

  // — — — مدل‌ها — — —

  /// GET /api/v1/models — رجیستری مدل‌ها.
  Future<List<ModelInfo>> models() async {
    final data = await _getJson('/models');
    return [
      for (final item in (data['items'] as List<dynamic>? ?? <dynamic>[]))
        if (item is Map<String, dynamic>) ModelInfo.fromJson(item),
    ];
  }

  /// POST /api/v1/models — ثبت مدل جدید.
  Future<ModelInfo> createModel({
    required String name,
    required String inputShape,
    required List<String> classes,
    String? task,
    String? format,
    String? device,
    int? sizeBytes,
    String? license,
    String? description,
  }) async {
    final data = await _sendJson('POST', '/models', body: <String, dynamic>{
      'name': name,
      'inputShape': inputShape,
      'classesJson': classes,
      if (task != null) 'task': task,
      if (format != null) 'format': format,
      if (device != null) 'device': device,
      if (sizeBytes != null) 'sizeBytes': sizeBytes,
      if (license != null) 'license': license,
      if (description != null) 'description': description,
    });
    return ModelInfo.fromJson(data);
  }

  /// PATCH /api/v1/models/:id — فعال/غیرفعال (تک‌فعال).
  Future<ModelInfo> setModelActive(String id, bool isActive) async {
    final data = await _sendJson(
      'PATCH',
      '/models/${Uri.encodeComponent(id)}',
      body: <String, dynamic>{'isActive': isActive},
    );
    return ModelInfo.fromJson(data);
  }

  // — — — نشست‌ها — — —

  /// GET /api/v1/sessions — تاریخچهٔ نشست‌ها با صفحه‌بندی.
  Future<Paged<SessionRecord>> sessions({
    String? streamId,
    String? state,
    DateTime? from,
    DateTime? to,
    int page = 1,
    int pageSize = 25,
  }) async {
    final data = await _getJson('/sessions', <String, String?>{
      'streamId': streamId,
      'state': state,
      'from': _iso(from),
      'to': _iso(to),
      'page': page.toString(),
      'pageSize': pageSize.toString(),
    });
    return Paged.fromJson(data, SessionRecord.fromJson);
  }

  // — — — گزارش‌ها — — —

  /// GET /api/v1/reports?format=json — گزارش تحلیلی.
  Future<Report> report({
    String? streamId,
    DateTime? from,
    DateTime? to,
  }) async {
    final data = await _getJson('/reports', <String, String?>{
      'streamId': streamId,
      'from': _iso(from),
      'to': _iso(to),
      'format': 'json',
    });
    return Report.fromJson(data);
  }

  /// GET /api/v1/reports?format=csv — متن CSV (با BOM).
  Future<String> reportCsv({
    String? streamId,
    DateTime? from,
    DateTime? to,
  }) async {
    http.Response response;
    try {
      response = await _client
          .get(_uri('/reports', <String, String?>{
            'streamId': streamId,
            'from': _iso(from),
            'to': _iso(to),
            'format': 'csv',
          }))
          .timeout(_timeout);
    } on Object catch (error) {
      throw ApiException.fromNetwork(error);
    }
    if (response.statusCode >= 400) throw ApiException.fromResponse(response);
    return utf8.decode(response.bodyBytes);
  }

  // — — — تنظیمات — — —

  /// GET /api/v1/settings
  Future<AppSettings> settings() async =>
      AppSettings.fromJson(await _getJson('/settings'));

  /// PATCH /api/v1/settings
  Future<AppSettings> updateSettings(AppSettings settings) async {
    final data =
        await _sendJson('PATCH', '/settings', body: settings.toPatch());
    return AppSettings.fromJson(data);
  }

  /// آزادسازی منابع HTTP.
  void dispose() {
    _client.close();
  }
}
