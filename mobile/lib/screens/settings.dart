// EdgeVision — کلاینت موبایل
// Copyright © 2026 Parsa Fathi — Apache-2.0

import 'dart:async';

import 'package:flutter/material.dart';

import '../api/models.dart';
import '../main.dart';
import '../utils/persian.dart';
import '../utils/theme.dart';
import 'shared.dart';

/// پردهٔ «تنظیمات» — نشانی سرور، آزمون ارتباط، رجیستری مدل‌ها و درباره.
class SettingsScreen extends StatefulWidget {
  const SettingsScreen({super.key});

  @override
  State<SettingsScreen> createState() => _SettingsScreenState();
}

class _SettingsScreenState extends State<SettingsScreen> {
  AppState? _app;
  late final TextEditingController _url;
  bool _testing = false;
  String? _testResult;
  bool? _testOk;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (_app == null) {
      _app = AppScope.of(context);
      _url = TextEditingController(text: _app!.baseUrl);
    }
  }

  @override
  void dispose() {
    _url.dispose();
    super.dispose();
  }

  Future<void> _testConnection() async {
    setState(() {
      _testing = true;
      _testResult = null;
      _testOk = null;
    });
    try {
      final health = await _app!.api.health();
      setState(() {
        _testOk = true;
        _testResult = health.ok
            ? 'اتصال برقرار است — نسخه ${faDigits(health.version)}، '
                '${faNumber(health.activeSessions)} نشست فعال'
            : 'اتصال برقرار است اما سامانه در وضعیت ناقص است';
      });
    } on Object catch (error) {
      setState(() {
        _testOk = false;
        _testResult = errorMessage(error);
      });
    }
  }

  void _applyUrl() {
    final app = _app!;
    final messenger = ScaffoldMessenger.of(context);
    try {
      app.applyBaseUrl(_url.text.trim());
      messenger.showSnackBar(
        SnackBar(content: Text('نشانی سرور به ${app.hostLabel} تغییر کرد')),
      );
    } on Object catch (error) {
      messenger.showSnackBar(
        SnackBar(content: Text(errorMessage(error)), backgroundColor: const Color(0xFF2A1714)),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: ListView(
        padding: const EdgeInsets.all(14),
        children: [
          _serverCard(),
          const SizedBox(height: 12),
          _modelsCard(),
          const SizedBox(height: 12),
          _aboutCard(),
        ],
      ),
    );
  }

  Widget _serverCard() {
    return PanelCard(
      title: 'اتصال به سرور',
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          TextField(
            controller: _url,
            keyboardType: TextInputType.url,
            decoration: const InputDecoration(
              labelText: 'نشانی سرور (REST)',
              hintText: 'http://10.0.2.2:3000',
              helperText: 'شبیه‌ساز اندروید: 10.0.2.2 — دسکتاپ: localhost',
            ),
          ),
          const SizedBox(height: 12),
          Row(
            children: [
              Expanded(
                child: OutlinedButton.icon(
                  onPressed: _testing ? null : () => unawaited(_testConnection()),
                  icon: _testing
                      ? const SizedBox(
                          width: 16,
                          height: 16,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        )
                      : const Icon(Icons.wifi_tethering, size: 18),
                  label: const Text('آزمون ارتباط'),
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: FilledButton.icon(
                  onPressed: _applyUrl,
                  icon: const Icon(Icons.save_outlined, size: 18),
                  label: const Text('ذخیره و اتصال مجدد'),
                ),
              ),
            ],
          ),
          if (_testResult != null) ...[
            const SizedBox(height: 10),
            Row(
              children: [
                Icon(
                  _testOk == true ? Icons.check_circle : Icons.error,
                  size: 16,
                  color: _testOk == true ? EvColors.ok : EvColors.danger,
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    _testResult!,
                    style: const TextStyle(color: EvColors.textMedium, fontSize: 12),
                  ),
                ),
              ],
            ),
          ],
        ],
      ),
    );
  }

  // — — — رجیستری مدل‌ها — — —

  Widget _modelsCard() {
    return const PanelCard(
      title: 'رجیستری مدل‌ها',
      trailing: _ModelsRefreshBadge(),
      child: _ModelsList(),
    );
  }

  // — — — درباره — — —

  Widget _aboutCard() {
    return PanelCard(
      title: 'دربارهٔ برنامه',
      child: Column(
        children: [
          const InfoRow('نام', 'EdgeVision — کلاینت موبایل'),
          InfoRow('نسخه', faDigits('1.0.0')),
          const InfoRow('مجوز', 'Apache-2.0'),
          const InfoRow('حق نشر', '© ۲۰۲۶ پارسا فتحی'),
          const Divider(height: 20),
          const Text(
            'EdgeVision پلتفرم تحلیل ویدئوی بلادرنگ است؛ این کلاینت با REST و '
            'WebSocket (socket.io نسخهٔ ۴) مستقیماً به سرور وصل می‌شود.\n\n'
            'در این استقرار، ورودی ویدئو یک شبیه‌ساز صحنهٔ قطعی است و «استنتاج» '
            'با آشکارساز شبکه‌ای در موتور بومی انجام می‌شود — مدل‌های رجیستری '
            'فقط فرادادهٔ پیکربندی‌اند. جزئیات در مستندات پروژه.',
            style: TextStyle(color: EvColors.textMedium, fontSize: 12, height: 1.7),
          ),
        ],
      ),
    );
  }
}

class _ModelsRefreshBadge extends StatefulWidget {
  const _ModelsRefreshBadge();

  @override
  State<_ModelsRefreshBadge> createState() => _ModelsRefreshBadgeState();
}

class _ModelsRefreshBadgeState extends State<_ModelsRefreshBadge> {
  @override
  Widget build(BuildContext context) {
    return TextButton.icon(
      onPressed: () => _ModelsList.of(context)?.reload(),
      icon: const Icon(Icons.refresh, size: 16),
      label: const Text('بازخوانی'),
    );
  }
}

class _ModelsList extends StatefulWidget {
  const _ModelsList();

  static _ModelsListState? of(BuildContext context) =>
      context.findAncestorStateOfType<_ModelsListState>();

  @override
  State<_ModelsList> createState() => _ModelsListState();
}

class _ModelsListState extends State<_ModelsList> {
  Future<List<ModelInfo>>? _future;
  bool _toggling = false;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    _future ??= AppScope.of(context).api.models();
  }

  void reload() {
    setState(() => _future = AppScope.of(context).api.models());
  }

  Future<void> _toggle(ModelInfo model) async {
    if (_toggling) return;
    final app = AppScope.of(context);
    final messenger = ScaffoldMessenger.of(context);
    setState(() => _toggling = true);
    try {
      await app.api.setModelActive(model.id, !model.isActive);
      if (mounted) {
        messenger.showSnackBar(
          SnackBar(
            content: Text(
              model.isActive
                  ? 'مدل «${model.name}» غیرفعال شد'
                  : 'مدل «${model.name}» فعال شد',
            ),
          ),
        );
      }
    } on Object catch (error) {
      if (mounted) {
        messenger.showSnackBar(
          SnackBar(content: Text(errorMessage(error)), backgroundColor: const Color(0xFF2A1714)),
        );
      }
    } finally {
      if (mounted) {
        setState(() => _toggling = false);
        reload();
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return FutureBuilder<List<ModelInfo>>(
      future: _future,
      builder: (context, snapshot) {
        if (snapshot.connectionState != ConnectionState.done) {
          return const SizedBox(height: 120, child: LoadingView());
        }
        if (snapshot.hasError) {
          return SizedBox(
            height: 140,
            child: ErrorView(
              message: errorMessage(snapshot.error!),
              onRetry: reload,
            ),
          );
        }
        final models = snapshot.data!;
        if (models.isEmpty) {
          return const SizedBox(
            height: 120,
            child: EmptyView(
              message: 'مدلی ثبت نشده است',
              icon: Icons.memory_outlined,
            ),
          );
        }
        return Column(
          children: [
            for (final m in models)
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 6),
                child: Row(
                  children: [
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Row(
                            children: [
                              Flexible(
                                child: Text(
                                  m.name,
                                  maxLines: 1,
                                  overflow: TextOverflow.ellipsis,
                                  style: const TextStyle(
                                    color: EvColors.textHigh,
                                    fontSize: 13,
                                    fontWeight: FontWeight.w700,
                                  ),
                                ),
                              ),
                              const SizedBox(width: 8),
                              if (m.isActive)
                                const StatusChip(label: 'فعال', color: EvColors.ok),
                            ],
                          ),
                          const SizedBox(height: 3),
                          Text(
                            '${faDigits(m.format)} · ${faDigits(m.task)} · '
                            'ورودی ${faDigits(m.inputShape)} · '
                            '${faNumber(m.classes.length)} کلاس'
                            '${m.sizeBytes == null ? '' : ' · ${faNumber(m.sizeBytes! / 1000000, decimals: 1)} مگابایت'}',
                            style: const TextStyle(
                              color: EvColors.textLow,
                              fontSize: 11,
                            ),
                          ),
                        ],
                      ),
                    ),
                    Switch(
                      value: m.isActive,
                      onChanged: _toggling ? null : (_) => unawaited(_toggle(m)),
                    ),
                  ],
                ),
              ),
            const SizedBox(height: 6),
            const Text(
              'رجیستری فرادادهٔ مدل‌هاست؛ در این استقرار وزنی توزیع نمی‌شود.',
              style: TextStyle(color: EvColors.textLow, fontSize: 11),
            ),
          ],
        );
      },
    );
  }
}
