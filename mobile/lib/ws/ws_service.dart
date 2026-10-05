// EdgeVision — کلاینت موبایل
// Copyright © 2026 Parsa Fathi — Apache-2.0

import 'dart:async';
import 'dart:convert';
import 'dart:math' as math;

import 'package:flutter/foundation.dart';
import 'package:web_socket_channel/web_socket_channel.dart';

import '../api/client.dart';
import '../api/models.dart';

/// وضعیت اتصال WebSocket.
enum WsStatus { disconnected, connecting, connected, reconnecting }

/// کارخانهٔ کانال WebSocket — برای تزریق در آزمون‌ها قابل‌جایگزینی است.
typedef WsChannelFactory = WebSocketChannel Function(Uri uri);

/// کارخانهٔ پیش‌فرض: اتصال مستقیم engine.io روی web_socket_channel.
WebSocketChannel defaultWsChannelFactory(Uri uri) =>
    WebSocketChannel.connect(uri);

// — — — پیام‌های دریافتی — — —

/// پیام hello پس از اتصال به namespace.
class WsHello {
  WsHello({
    required this.version,
    required this.engineBinary,
    required this.activeSessions,
  });

  factory WsHello.fromJson(Map<String, dynamic> json) => WsHello(
        version: json['version'] is String ? json['version'] as String : '—',
        engineBinary: json['engineBinary'] == true,
        activeSessions: [
          for (final s in (json['activeSessions'] as List<dynamic>? ??
              <dynamic>[]))
            if (s is Map<String, dynamic>) ActiveSession.fromJson(s),
        ],
      );

  final String version;
  final bool engineBinary;
  final List<ActiveSession> activeSessions;
}

/// شیء صحنه (ground-truth) در پیام frame.
class WsSceneObject {
  WsSceneObject({
    required this.oid,
    required this.t,
    required this.x,
    required this.y,
    required this.w,
    required this.h,
  });

  factory WsSceneObject.fromJson(Map<String, dynamic> json) => WsSceneObject(
        oid: (json['oid'] as num?)?.round() ?? 0,
        t: json['t'] is String ? json['t'] as String : '',
        x: (json['x'] as num?)?.toDouble() ?? 0,
        y: (json['y'] as num?)?.toDouble() ?? 0,
        w: (json['w'] as num?)?.toDouble() ?? 0,
        h: (json['h'] as num?)?.toDouble() ?? 0,
      );

  final int oid;
  final String t;
  final double x;
  final double y;
  final double w;
  final double h;
}

/// جعبهٔ تشخیص در پیام frame.
class WsDetectionBox {
  WsDetectionBox({
    required this.trackId,
    required this.label,
    required this.conf,
    required this.x,
    required this.y,
    required this.w,
    required this.h,
  });

  factory WsDetectionBox.fromJson(Map<String, dynamic> json) =>
      WsDetectionBox(
        trackId: (json['trackId'] as num?)?.round() ?? 0,
        label: json['label'] is String ? json['label'] as String : '',
        conf: (json['conf'] as num?)?.toDouble() ?? 0,
        x: (json['x'] as num?)?.toDouble() ?? 0,
        y: (json['y'] as num?)?.toDouble() ?? 0,
        w: (json['w'] as num?)?.toDouble() ?? 0,
        h: (json['h'] as num?)?.toDouble() ?? 0,
      );

  final int trackId;
  final String label;
  final double conf;
  final double x;
  final double y;
  final double w;
  final double h;
}

/// پیام frame — اشیای صحنه + تشخیص‌های همان فریم.
class WsFrameMessage {
  WsFrameMessage({
    required this.streamId,
    required this.sessionId,
    required this.frameIndex,
    required this.ts,
    required this.latencyMs,
    required this.objects,
    required this.detections,
  });

  factory WsFrameMessage.fromJson(Map<String, dynamic> json) => WsFrameMessage(
        streamId: json['streamId'] is String ? json['streamId'] as String : '',
        sessionId:
            json['sessionId'] is String ? json['sessionId'] as String : '',
        frameIndex: (json['frameIndex'] as num?)?.round() ?? 0,
        ts: (json['ts'] as num?)?.round() ?? 0,
        latencyMs: (json['latencyMs'] as num?)?.toDouble() ?? 0,
        objects: [
          for (final o in (json['objects'] as List<dynamic>? ?? <dynamic>[]))
            if (o is Map<String, dynamic>) WsSceneObject.fromJson(o),
        ],
        detections: [
          for (final d in (json['detections'] as List<dynamic>? ?? <dynamic>[]))
            if (d is Map<String, dynamic>) WsDetectionBox.fromJson(d),
        ],
      );

  final String streamId;
  final String sessionId;
  final int frameIndex;
  final int ts;
  final double latencyMs;
  final List<WsSceneObject> objects;
  final List<WsDetectionBox> detections;
}

/// پیام metrics — متریک لحظه‌ای نشست.
class WsMetricMessage {
  WsMetricMessage({required this.streamId, required this.sessionId, required this.sample});

  factory WsMetricMessage.fromJson(Map<String, dynamic> json) =>
      WsMetricMessage(
        streamId: json['streamId'] is String ? json['streamId'] as String : '',
        sessionId:
            json['sessionId'] is String ? json['sessionId'] as String : '',
        sample: MetricSample.fromJson(json),
      );

  final String streamId;
  final String sessionId;
  final MetricSample sample;
}

/// پیام event — رویداد بلادرنگ.
class WsEventMessage {
  WsEventMessage({
    required this.streamId,
    required this.sessionId,
    required this.type,
    required this.ts,
    this.trackId,
    this.label,
    this.payload,
  });

  factory WsEventMessage.fromJson(Map<String, dynamic> json) {
    final tsNum = (json['ts'] as num?)?.round();
    return WsEventMessage(
      streamId: json['streamId'] is String ? json['streamId'] as String : '',
      sessionId:
          json['sessionId'] is String ? json['sessionId'] as String : '',
      type: json['type'] is String ? json['type'] as String : '',
      ts: tsNum == null ? null : DateTime.fromMillisecondsSinceEpoch(tsNum),
      trackId: (json['trackId'] as num?)?.round(),
      label: json['label'] is String ? json['label'] as String : null,
      payload: json['payload'],
    );
  }

  final String streamId;
  final String sessionId;
  final String type;
  final DateTime? ts;
  final int? trackId;
  final String? label;
  final Object? payload;
}

/// پیام session — چرخهٔ وضعیت نشست.
class WsSessionMessage {
  WsSessionMessage({
    required this.streamId,
    required this.sessionId,
    required this.state,
    this.reason,
    this.startedAt,
    this.endedAt,
  });

  factory WsSessionMessage.fromJson(Map<String, dynamic> json) =>
      WsSessionMessage(
        streamId: json['streamId'] is String ? json['streamId'] as String : '',
        sessionId:
            json['sessionId'] is String ? json['sessionId'] as String : '',
        state: json['state'] is String ? json['state'] as String : '',
        reason: json['reason'] is String ? json['reason'] as String : null,
        startedAt: json['startedAt'] is String
            ? DateTime.tryParse(json['startedAt'] as String)
            : null,
        endedAt: json['endedAt'] is String
            ? DateTime.tryParse(json['endedAt'] as String)
            : null,
      );

  final String streamId;
  final String sessionId;
  final String state;
  final String? reason;
  final DateTime? startedAt;
  final DateTime? endedAt;

  bool get terminal => state == 'STOPPED' || state == 'ERROR';
}

/// پیام pong — پاسخ کاوش RTT (اختیاری).
class WsPongMessage {
  WsPongMessage({required this.ts, this.echo});

  factory WsPongMessage.fromJson(Map<String, dynamic> json) => WsPongMessage(
        ts: (json['ts'] as num?)?.round(),
        echo: json['echo'],
      );

  final int? ts;
  final Object? echo;
}

/// سرویس WebSocket — پیاده‌سازی دستی پروتکل socket.io v4 (engine.io 4)
/// روی کانال خام web_socket_channel، بدون بستهٔ socket_io_client.
///
/// قرارداد سیم:
///  * اتصال مستقیم به سرویس پردازش: ws://host:3003/socket.io/?EIO=4&transport=websocket
///    (نشانی از ApiConfig.wsUri می‌آید؛ نشانی‌های نسبی مرورگر اینجا کاربرد ندارند).
///  * پس از گشوده‌شدن کانال، بستهٔ CONNECT یعنی «40» فرستاده می‌شود و
///    پاسخ «40{"sid":...}» یعنی پذیرش namespace «/».
///  * بستهٔ OPEN سرور («0{...sid,pingInterval,...}») فقط اطلاعاتی است.
///  * رویدادها به شکل «42["نام",payload]» می‌رسند و عضوگرایی استریم با
///    «42["subscribe",{"streams":[...]}]» اعلام می‌شود.
///  * پینگ سرور «2» باید بی‌درنگ با «3» پاسخ داده شود.
///  * قطع اتصال با backoff نمایی سقف‌دار (۰٫۵ تا ۸ ثانیه) دوباره تلاش
///    می‌شود؛ پس از هر اتصال موفق بازة زمانی ریست و عضویت‌ها دوباره
///    اعمال می‌شوند.
class WsService extends ChangeNotifier {
  WsService({
    required ApiConfig config,
    WsChannelFactory? channelFactory,
  })  : _config = config,
        _channelFactory = channelFactory ?? defaultWsChannelFactory;

  static const Duration _connectTimeout = Duration(seconds: 10);
  static const int _backoffBaseMs = 500;
  static const int _backoffCapMs = 8000;

  final ApiConfig _config;
  final WsChannelFactory _channelFactory;

  WebSocketChannel? _channel;
  bool _wantConnected = false;
  bool _everConnected = false;
  bool _channelAttached = false;
  int _backoffMs = _backoffBaseMs;
  final Set<String> _wantedStreams = <String>{};

  WsStatus _status = WsStatus.disconnected;
  WsHello? _hello;

  final StreamController<WsHello> _helloCtrl =
      StreamController<WsHello>.broadcast();
  final StreamController<WsFrameMessage> _frameCtrl =
      StreamController<WsFrameMessage>.broadcast();
  final StreamController<WsMetricMessage> _metricCtrl =
      StreamController<WsMetricMessage>.broadcast();
  final StreamController<WsEventMessage> _eventCtrl =
      StreamController<WsEventMessage>.broadcast();
  final StreamController<WsSessionMessage> _sessionCtrl =
      StreamController<WsSessionMessage>.broadcast();
  final StreamController<WsPongMessage> _pongCtrl =
      StreamController<WsPongMessage>.broadcast();

  /// وضعیت جاری اتصال.
  WsStatus get status => _status;

  /// آخرین پیام hello (مقصد پردهٔ وضعیت).
  WsHello? get hello => _hello;

  /// استریم‌هایی که عضویتشان درخواست شده است.
  Set<String> get wantedStreams => Set<String>.unmodifiable(_wantedStreams);

  /// hello اتصال جاری.
  Stream<WsHello> get helloStream => _helloCtrl.stream;

  /// فریم‌های زندهٔ استریم‌های عضو.
  Stream<WsFrameMessage> get frames => _frameCtrl.stream;

  /// متریک‌های لحظه‌ای.
  Stream<WsMetricMessage> get metrics => _metricCtrl.stream;

  /// رویدادهای بلادرنگ.
  Stream<WsEventMessage> get events => _eventCtrl.stream;

  /// تغییر وضعیت نشست‌ها.
  Stream<WsSessionMessage> get sessionEvents => _sessionCtrl.stream;

  /// پاسخ‌های pong.
  Stream<WsPongMessage> get pongs => _pongCtrl.stream;

  // — — — چرخهٔ عمر — — —

  /// آغاز اتصال (idempotent) — حلقهٔ اتصال مجدد را روشن نگه می‌دارد.
  void connect() {
    if (_wantConnected) return;
    _wantConnected = true;
    unawaited(_runLoop());
  }

  /// قطع اتصال به دست کاربر — حلقهٔ اتصال مجدد خاموش می‌شود.
  void disconnect() {
    if (!_wantConnected && _status == WsStatus.disconnected) return;
    _wantConnected = false;
    _closeChannel();
  }

  /// درخواست عضویت روی استریم‌ها؛ اگر متصل باشد بی‌درنگ اعمال می‌شود.
  void subscribe(Iterable<String> streamIds) {
    final added = <String>[
      for (final id in streamIds)
        if (id.isNotEmpty && _wantedStreams.add(id)) id,
    ];
    if (added.isNotEmpty && _channelAttached) {
      _emit('subscribe', <String, dynamic>{'streams': added});
    }
  }

  /// لغو عضویت استریم‌ها.
  void unsubscribe(Iterable<String> streamIds) {
    final removed = <String>[
      for (final id in streamIds)
        if (_wantedStreams.remove(id)) id,
    ];
    if (removed.isNotEmpty && _channelAttached) {
      _emit('unsubscribe', <String, dynamic>{'streams': removed});
    }
  }

  @override
  void dispose() {
    _wantConnected = false;
    _closeChannel();
    _helloCtrl.close();
    _frameCtrl.close();
    _metricCtrl.close();
    _eventCtrl.close();
    _sessionCtrl.close();
    _pongCtrl.close();
    super.dispose();
  }

  // — — — حلقهٔ اتصال — — —

  Future<void> _runLoop() async {
    while (_wantConnected) {
      _setStatus(
        _everConnected ? WsStatus.reconnecting : WsStatus.connecting,
      );

      WebSocketChannel channel;
      try {
        channel = _channelFactory(_config.wsUri());
        await channel.ready.timeout(_connectTimeout);
      } on Object {
        // اتصال برقرار نشد — پس از backoff دوباره تلاش می‌کنیم.
        await _backoffWait();
        continue;
      }
      if (!_wantConnected) {
        _silentClose(channel);
        break;
      }

      _channel = channel;
      _channelAttached = true;
      try {
        // CONNECT به namespace «/» — بستهٔ «40».
        channel.sink.add('40');
      } on Object {
        // sink مرده — کانال در هم می‌خوابد و حلقه ادامه می‌یابد.
      }

      final channelClosed = Completer<void>();
      late final StreamSubscription<Object?> subscription;
      subscription = channel.stream.listen(
        (Object? data) => _handleData(data),
        onError: (Object _) {
          if (_channelAttached) {
            _channelAttached = false;
            if (!channelClosed.isCompleted) channelClosed.complete();
          }
        },
        onDone: () {
          if (_channelAttached) {
            _channelAttached = false;
            if (!channelClosed.isCompleted) channelClosed.complete();
          }
        },
        cancelOnError: true,
      );
      _currentSubscription = subscription;

      // صبر تا مرگ این کانال (خطا، بسته‌شدن یا قطع توسط کاربر).
      await channelClosed.future;
      _currentSubscription = null;
      _channel = null;

      if (!_wantConnected) break;
      _setStatus(WsStatus.reconnecting);
      await _backoffWait();
    }
    _setStatus(WsStatus.disconnected);
  }

  StreamSubscription<Object?>? _currentSubscription;

  Future<void> _backoffWait() async {
    if (!_wantConnected) return;
    final delay = _backoffMs;
    _backoffMs = math.min(_backoffMs * 2, _backoffCapMs);
    await Future<void>.delayed(Duration(milliseconds: delay));
  }

  void _closeChannel() {
    final channel = _channel;
    _channel = null;
    _channelAttached = false;
    final sub = _currentSubscription;
    _currentSubscription = null;
    if (channel != null) {
      try {
        // بستن آرام sink — onDone حلقه را بیدار می‌کند.
        channel.sink.close();
      } on Object {
        // کانال مرده — مهم نیست.
      }
    }
    sub?.cancel();
    _setStatus(WsStatus.disconnected);
  }

  void _silentClose(WebSocketChannel channel) {
    try {
      channel.sink.close();
    } on Object {
      // نادیده گرفته می‌شود.
    }
  }

  void _setStatus(WsStatus next) {
    if (_status == next) return;
    _status = next;
    notifyListeners();
  }

  // — — — پروتکل engine.io / socket.io — — —

  void _handleData(Object? data) {
    if (data is! String || data.isEmpty) return;
    final type = data.codeUnitAt(0);
    switch (type) {
      case 0x30: // '0' — OPEN: {"sid":...,"pingInterval":...}
        // فقط اطلاعاتی است؛ CONNECT را همین اوایل فرستاده‌ایم.
        break;
      case 0x32: // '2' — پینگ سرور
        _sendRaw('3');
        break;
      case 0x33: // '3' — پونگ (پاسخ پینگ خودمان؛ نمی‌فرستیم)
        break;
      case 0x31: // '1' — CLOSE
        _handleDisconnect('engine.io close');
        break;
      case 0x34: // '4' — بسته‌های socket.io
        _handleSocketIo(data);
        break;
      default:
        // بستهٔ ناشناخته — بی‌صدا تحمل می‌شود.
        break;
    }
  }

  void _handleSocketIo(String data) {
    if (data.length < 2) return;
    switch (data.codeUnitAt(1)) {
      case 0x30: // '40' — CONNECT: پذیرش namespace
        _backoffMs = _backoffBaseMs;
        _everConnected = true;
        _setStatus(WsStatus.connected);
        if (_wantedStreams.isNotEmpty) {
          _emit('subscribe', <String, dynamic>{
            'streams': _wantedStreams.toList(growable: false),
          });
        }
        break;
      case 0x31: // '41' — DISCONNECT از namespace
        _handleDisconnect('namespace disconnect');
        break;
      case 0x34: // '44' — CONNECT_ERROR
        _handleDisconnect('connect error');
        break;
      case 0x32: // '42' — EVENT: ["نام", payload]
        _handleEvent(data.substring(2));
        break;
      default:
        break;
    }
  }

  void _handleEvent(String raw) {
    dynamic decoded;
    try {
      decoded = jsonDecode(raw);
    } on FormatException {
      return; // JSON خراب — تحمل می‌شود.
    }
    if (decoded is! List<dynamic> || decoded.isEmpty) return;
    final name = decoded[0];
    if (name is! String) return;
    final payload =
        decoded.length > 1 && decoded[1] is Map<String, dynamic>
            ? decoded[1] as Map<String, dynamic>
            : <String, dynamic>{};
    switch (name) {
      case 'hello':
        final hello = WsHello.fromJson(payload);
        _hello = hello;
        _helloCtrl.add(hello);
        break;
      case 'frame':
        _frameCtrl.add(WsFrameMessage.fromJson(payload));
        break;
      case 'metrics':
        _metricCtrl.add(WsMetricMessage.fromJson(payload));
        break;
      case 'event':
        _eventCtrl.add(WsEventMessage.fromJson(payload));
        break;
      case 'session':
        _sessionCtrl.add(WsSessionMessage.fromJson(payload));
        break;
      case 'pong':
        _pongCtrl.add(WsPongMessage.fromJson(payload));
        break;
      default:
        // رویداد ناشناخته — نادیده گرفته می‌شود.
        break;
    }
  }

  void _handleDisconnect(String reason) {
    // بستن sink باعث onDone می‌شود و حلقهٔ اتصال مجدد ادامه می‌یابد.
    final channel = _channel;
    if (channel != null) {
      try {
        channel.sink.close();
      } on Object {
        // کانال مرده — حلقه از طریق خطا/ onDone بیدار می‌شود.
      }
    }
  }

  void _sendRaw(String packet) {
    final channel = _channel;
    if (channel == null || !_channelAttached) return;
    try {
      channel.sink.add(packet);
    } on Object {
      // sink مرده — قطع از مسیر onDone/onError دیده می‌شود.
    }
  }

  void _emit(String event, Map<String, dynamic> payload) {
    _sendRaw('42${jsonEncode(<dynamic>[event, payload])}');
  }

  // — — — کاوش RTT (اختیاری) — — —

  /// ارسال رویداد ping برای سنجش تاخیر رفت‌وبرگشت.
  void ping() {
    if (_channelAttached) {
      _emit('ping', <String, dynamic>{'ts': DateTime.now().millisecondsSinceEpoch});
    }
  }
}
