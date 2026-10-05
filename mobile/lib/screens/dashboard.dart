// EdgeVision — کلاینت موبایل
// Copyright © 2026 Parsa Fathi — Apache-2.0

import 'package:flutter/material.dart';

import '../api/models.dart';
import '../main.dart';
import '../utils/persian.dart';
import '../utils/theme.dart';
import 'shared.dart';

/// دادهٔ تجمعی پردهٔ نمای کلی.
class _DashboardData {
  _DashboardData({
    required this.health,
    required this.streams,
    required this.live,
    this.detectionsTotal,
    this.eventsTotal,
    this.sessionsTotal,
  });

  final Health health;
  final List<StreamItem> streams;
  final LiveMetrics live;
  final int? detectionsTotal;
  final int? eventsTotal;
  final int? sessionsTotal;
}

/// پردهٔ «نمای کلی» — کارت سلامت، KPIها و نشست‌های فعال.
class DashboardScreen extends StatefulWidget {
  const DashboardScreen({super.key});

  @override
  State<DashboardScreen> createState() => _DashboardScreenState();
}

class _DashboardScreenState extends State<DashboardScreen> {
  AppState? _app;
  Future<_DashboardData>? _future;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (_app == null) {
      _app = AppScope.of(context);
      _future = _load(_app!);
    }
  }

  Future<_DashboardData> _load(AppState app) async {
    final results =
        await Future.wait(<Future<Object?>>[app.api.health(), app.api.streams(), app.api.liveMetrics()]);
    // شمارش‌ها بهترین‌حالته‌اند — خرابی یکی کل پرده را نمی‌اندازد.
    final detectionsTotal = await app.api
        .detections(page: 1, pageSize: 1)
        .then<int?>((p) => p.total)
        .catchError((_) => null);
    final eventsTotal = await app.api
        .events(page: 1, pageSize: 1)
        .then<int?>((p) => p.total)
        .catchError((_) => null);
    final sessionsTotal = await app.api
        .sessions(page: 1, pageSize: 1)
        .then<int?>((p) => p.total)
        .catchError((_) => null);

    return _DashboardData(
      health: results[0]! as Health,
      streams: results[1]! as List<StreamItem>,
      live: results[2]! as LiveMetrics,
      detectionsTotal: detectionsTotal,
      eventsTotal: eventsTotal,
      sessionsTotal: sessionsTotal,
    );
  }

  void _reload() {
    final app = _app;
    if (app == null) return;
    setState(() => _future = _load(app));
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: RefreshIndicator(
        onRefresh: () async {
          final app = _app;
          if (app != null) await app.checkHealth();
          _reload();
        },
        child: FutureBuilder<_DashboardData>(
          future: _future,
          builder: (context, snapshot) {
            if (snapshot.connectionState != ConnectionState.done) {
              return const LoadingView();
            }
            if (snapshot.hasError) {
              return ErrorView(
                message: errorMessage(snapshot.error!),
                onRetry: _reload,
              );
            }
            final data = snapshot.data!;
            if (data.streams.isEmpty) {
              return ListView(
                physics: const AlwaysScrollableScrollPhysics(),
                children: [
                  _healthCard(data.health),
                  const SizedBox(height: 16),
                  const EmptyView(
                    message: 'هنوز استریمی ثبت نشده است',
                    hint: 'از پردهٔ «استریم‌ها» نخستین استریم را بسازید',
                    icon: Icons.videocam_outlined,
                  ),
                ],
              );
            }
            return ListView(
              physics: const AlwaysScrollableScrollPhysics(),
              padding: const EdgeInsets.all(14),
              children: [
                _healthCard(data.health),
                const SizedBox(height: 16),
                _kpiGrid(data),
                const SizedBox(height: 16),
                _activeSessionsCard(data),
              ],
            );
          },
        ),
      ),
    );
  }

  Widget _healthCard(Health health) {
    return PanelCard(
      title: 'سلامت سامانه',
      trailing: Text(
        'نسخه ${faDigits(health.version)}',
        style: const TextStyle(color: EvColors.textLow, fontSize: 11),
      ),
      child: Column(
        children: [
          Row(
            children: [
              StatusChip.forHealth(health.ok),
              const SizedBox(width: 8),
              Expanded(
                child: Text(
                  health.ok
                      ? 'همهٔ اجزا در وضعیت طبیعی هستند'
                      : 'یک یا چند جزء سامانه دچار اشکال است',
                  style: const TextStyle(
                    color: EvColors.textMedium,
                    fontSize: 12,
                  ),
                ),
              ),
            ],
          ),
          const Divider(height: 20),
          InfoRow('پایگاه‌داده', health.db ? 'متصل' : 'قطع',
              color: health.db ? EvColors.ok : EvColors.danger),
          InfoRow('سرویس پردازش', health.engine ? 'فعال' : 'در دسترس نیست',
              color: health.engine ? EvColors.ok : EvColors.danger),
          InfoRow('موتور بومی', health.engineBinary ? 'موجود' : 'یافت نشد',
              color: health.engineBinary ? EvColors.ok : EvColors.warn),
          InfoRow('نشست‌های فعال', faNumber(health.activeSessions)),
          InfoRow('زمان کارکرد', faDuration(Duration(seconds: health.uptimeSec))),
        ],
      ),
    );
  }

  Widget _kpiGrid(_DashboardData data) {
    final running =
        data.streams.where((s) => s.hasActiveSession).toList(growable: false);
    return LayoutBuilder(
      builder: (context, constraints) {
        final columns =
            constraints.maxWidth >= 560 ? 3 : (constraints.maxWidth >= 340 ? 2 : 1);
        final tiles = <Widget>[
          KpiTile(
            label: 'استریم‌ها',
            value: faNumber(data.streams.length),
            sub: '${faNumber(data.streams.length - running.length)} غیرفعال',
          ),
          KpiTile(
            label: 'نشست‌های فعال',
            value: faNumber(data.live.sessions.length),
            accent: true,
            sub: running.isEmpty ? 'هیچ استریمی در حال اجرا نیست' : null,
          ),
          KpiTile(
            label: 'تشخیص‌های ثبت‌شده',
            value: data.detectionsTotal == null
                ? '—'
                : faNumber(data.detectionsTotal!),
          ),
          KpiTile(
            label: 'رویدادها',
            value:
                data.eventsTotal == null ? '—' : faNumber(data.eventsTotal!),
          ),
          KpiTile(
            label: 'نشست‌های تاریخچه',
            value: data.sessionsTotal == null
                ? '—'
                : faNumber(data.sessionsTotal!),
          ),
        ];
        return GridView.count(
          crossAxisCount: columns,
          shrinkWrap: true,
          physics: const NeverScrollableScrollPhysics(),
          mainAxisSpacing: 10,
          crossAxisSpacing: 10,
          childAspectRatio: 1.9,
          children: tiles,
        );
      },
    );
  }

  Widget _activeSessionsCard(_DashboardData data) {
    final byId = <String, StreamItem>{
      for (final s in data.streams) s.id: s,
    };
    final sessions = data.live.sessions;
    return PanelCard(
      title: 'نشست‌های زنده',
      trailing: sessions.isEmpty
          ? null
          : Text(
              '${faNumber(sessions.length)} مورد',
              style: const TextStyle(color: EvColors.accent, fontSize: 12),
            ),
      child: sessions.isEmpty
          ? const EmptyView(
              message: 'در حال حاضر نشست فعالی وجود ندارد',
              hint: 'با «شروع» از پردهٔ استریم‌ها، پردازش زنده را آغاز کنید',
              icon: Icons.play_circle_outlined,
            )
          : Column(
              children: [
                for (final entry in sessions)
                  _liveSessionTile(entry, byId[entry.session.streamId]?.name),
              ],
            ),
    );
  }

  Widget _liveSessionTile(LiveSessionEntry entry, String? streamName) {
    final s = entry.session;
    final m = entry.metric;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  streamName ??
                      'استریم ${s.streamId.substring(0, s.streamId.length < 8 ? s.streamId.length : 8)}',
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    color: EvColors.textHigh,
                    fontSize: 14,
                    fontWeight: FontWeight.w700,
                  ),
                ),
                const SizedBox(height: 4),
                Text(
                  m == null
                      ? 'فریم ${faNumber(s.framesProcessed)} — تشخیص ${faNumber(s.detectionsTotal)}'
                      : 'فریم ${faNumber(m.framesProcessed)} — ${faNumber(m.processedFps, decimals: 1)} فریم/ث — تاخیر ${faNumber(m.latencyAvgMs, decimals: 1)} میلی‌ثانیه',
                  style: const TextStyle(
                    color: EvColors.textMedium,
                    fontSize: 12,
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(width: 8),
          StatusChip.forSessionState(s.state),
        ],
      ),
    );
  }
}
