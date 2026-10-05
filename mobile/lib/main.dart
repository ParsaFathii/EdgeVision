// EdgeVision — کلاینت موبایل
// Copyright © 2026 Parsa Fathi — Apache-2.0

import 'dart:async';

import 'package:flutter/material.dart';

import 'api/client.dart';
import 'api/models.dart';
import 'screens/analytics.dart';
import 'screens/dashboard.dart';
import 'screens/detections.dart';
import 'screens/events.dart';
import 'screens/settings.dart';
import 'screens/shared.dart';
import 'screens/streams.dart';
import 'utils/theme.dart';
import 'ws/ws_service.dart';

void main() {
  runApp(const EdgeVisionApp());
}

/// وضعیت سراسری برنامه: سرویس API، سرویس بلادرنگ و سلامت اتصال.
class AppState extends ChangeNotifier {
  AppState() {
    api = ApiService(config: _config);
    ws = WsService(config: _config);
    ws.addListener(_onWsChanged);
  }

  final ApiConfig _config = ApiConfig();

  /// سرویس REST مشترک.
  late final ApiService api;

  /// سرویس WebSocket مشترک (socket.io v4 دستی).
  late final WsService ws;

  /// سلامت سرور — null یعنی «هنوز بررسی نشده».
  bool? serverReachable;

  /// آخرین گزارش سلامت (برای پردهٔ نمای کلی).
  Health? lastHealth;

  Timer? _healthTimer;
  bool _disposed = false;

  WsStatus _wsStatus = WsStatus.disconnected;

  /// وضعیت جاری اتصال بلادرنگ.
  WsStatus get wsStatus => _wsStatus;

  void _onWsChanged() {
    _wsStatus = ws.status;
    notifyListeners();
  }

  /// راه‌اندازی: اتصال بلادرنگ + پایش دوره‌ای سلامت (هر ۱۵ ثانیه).
  void start() {
    ws.connect();
    unawaited(checkHealth());
    _healthTimer = Timer.periodic(
      const Duration(seconds: 15),
      (_) => unawaited(checkHealth()),
    );
  }

  /// کاوش سلامت — نتیجهٔ آن بنر «ارتباط با سرور» را می‌سازد.
  Future<void> checkHealth() async {
    try {
      lastHealth = await api.health();
      serverReachable = true;
    } on Object {
      serverReachable = false;
    }
    if (!_disposed) notifyListeners();
  }

  /// تغییر نشانی سرور — API و WebSocket دوباره متصل می‌شوند.
  void applyBaseUrl(String url) {
    api.setBaseUrl(url);
    lastHealth = null;
    serverReachable = null;
    ws.disconnect();
    ws.connect();
    notifyListeners();
    unawaited(checkHealth());
  }

  /// نشانی جاری سرور.
  String get baseUrl => _config.baseUrl;

  /// میزبان جاری برای نمایش.
  String get hostLabel => _config.hostLabel;

  @override
  void dispose() {
    _disposed = true;
    _healthTimer?.cancel();
    ws.removeListener(_onWsChanged);
    ws.dispose();
    api.dispose();
    super.dispose();
  }
}

/// در دسترس‌سازی AppState برای همهٔ پرده‌ها.
class AppScope extends InheritedNotifier<AppState> {
  const AppScope({super.key, required AppState notifier, required super.child})
      : super(notifier: notifier);

  /// وضعیت سراسری برنامه.
  static AppState of(BuildContext context) =>
      context.dependOnInheritedWidgetOfExactType<AppScope>()!.notifier!;
}

/// ریشهٔ برنامه — پوستهٔ راست‌به‌چپ فارسی با ناوبری شش‌گانه.
class EdgeVisionApp extends StatefulWidget {
  const EdgeVisionApp({super.key});

  @override
  State<EdgeVisionApp> createState() => _EdgeVisionAppState();
}

class _EdgeVisionAppState extends State<EdgeVisionApp> {
  final AppState _app = AppState();

  @override
  void initState() {
    super.initState();
    _app.start();
  }

  @override
  void dispose() {
    _app.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'EdgeVision',
      debugShowCheckedModeBanner: false,
      theme: buildEvTheme(),
      locale: const Locale('fa'),
      // جهت متن در کل برنامه راست‌به‌چپ تثبیت می‌شود — مستقل از
      // localizations پیش‌فرض انگلیسی Material.
      builder: (context, child) => Directionality(
        textDirection: TextDirection.rtl,
        child: AppScope(notifier: _app, child: child!),
      ),
      home: const AppShell(),
    );
  }
}

class _NavItem {
  const _NavItem(this.label, this.icon);
  final String label;
  final IconData icon;
}

const List<_NavItem> _navItems = <_NavItem>[
  _NavItem('نمای کلی', Icons.dashboard_outlined),
  _NavItem('استریم‌ها', Icons.videocam_outlined),
  _NavItem('رویدادها', Icons.bolt_outlined),
  _NavItem('تشخیص‌ها', Icons.center_focus_strong_outlined),
  _NavItem('تحلیل‌ها', Icons.insights_outlined),
  _NavItem('تنظیمات', Icons.settings_outlined),
];

class AppShell extends StatelessWidget {
  const AppShell({super.key});

  @override
  Widget build(BuildContext context) {
    final app = AppScope.of(context);
    final wide = MediaQuery.sizeOf(context).width >= 720;

    return AnimatedBuilder(
      animation: app,
      builder: (context, _) {
        final offline = app.serverReachable == false;
        const pages = <Widget>[
          DashboardScreen(),
          StreamsScreen(),
          EventsScreen(),
          DetectionsScreen(),
          AnalyticsScreen(),
          SettingsScreen(),
        ];
        return _ShellBody(app: app, offline: offline, wide: wide, pages: pages);
      },
    );
  }
}

class _ShellBody extends StatefulWidget {
  const _ShellBody({
    required this.app,
    required this.offline,
    required this.wide,
    required this.pages,
  });

  final AppState app;
  final bool offline;
  final bool wide;
  final List<Widget> pages;

  @override
  State<_ShellBody> createState() => _ShellBodyState();
}

class _ShellBodyState extends State<_ShellBody> {
  int _index = 0;

  @override
  Widget build(BuildContext context) {
    final app = widget.app;
    final wide = widget.wide;
    final offline = widget.offline;

    final body = IndexedStack(index: _index, children: widget.pages);

    return Scaffold(
      appBar: AppBar(
        title: Row(
          children: [
            const Text('EdgeVision'),
            const SizedBox(width: 10),
            StatusChip.forHealth(
              app.serverReachable == true && (app.lastHealth?.ok ?? false),
            ),
            const SizedBox(width: 6),
            StatusChip.forWs(app.wsStatus),
          ],
        ),
        actions: [
          IconButton(
            tooltip: 'بازخوانی وضعیت',
            icon: const Icon(Icons.refresh),
            onPressed: () => unawaited(app.checkHealth()),
          ),
        ],
      ),
      body: Column(
        children: [
          // بنر قطع ارتباط — تنها وقتی سرور پاسخ نمی‌دهد.
          if (offline)
            _OfflineBanner(onRetry: () => unawaited(app.checkHealth())),
          Expanded(child: wide ? _withRail(body) : body),
        ],
      ),
      bottomNavigationBar: wide
          ? null
          : NavigationBar(
              selectedIndex: _index,
              onDestinationSelected: (i) => setState(() => _index = i),
              destinations: [
                for (final item in _navItems)
                  NavigationDestination(
                    icon: Icon(item.icon),
                    label: item.label,
                  ),
              ],
            ),
    );
  }

  Widget _withRail(Widget body) {
    return Row(
      children: [
        NavigationRail(
          selectedIndex: _index,
          onDestinationSelected: (i) => setState(() => _index = i),
          labelType: NavigationRailLabelType.all,
          backgroundColor: EvColors.surface,
          selectedIconTheme: const IconThemeData(color: EvColors.accent),
          unselectedIconTheme: const IconThemeData(color: EvColors.textMedium),
          destinations: [
            for (final item in _navItems)
              NavigationRailDestination(
                icon: Icon(item.icon),
                label: Text(item.label),
              ),
          ],
        ),
        const VerticalDivider(width: 1),
        Expanded(child: body),
      ],
    );
  }
}

/// بنر «ارتباط با سرور برقرار نشد» با دکمهٔ تلاش دوباره.
class _OfflineBanner extends StatelessWidget {
  const _OfflineBanner({required this.onRetry});

  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: const Color(0xFF2A1714),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
        child: Row(
          children: [
            const Icon(Icons.wifi_off, size: 18, color: EvColors.danger),
            const SizedBox(width: 8),
            const Expanded(
              child: Text(
                'ارتباط با سرور برقرار نشد — نشانی و وضعیت سرویس را بررسی کنید',
                style: TextStyle(
                  color: EvColors.textHigh,
                  fontSize: 12,
                  fontWeight: FontWeight.w600,
                ),
              ),
            ),
            TextButton(onPressed: onRetry, child: const Text('تلاش دوباره')),
          ],
        ),
      ),
    );
  }
}
