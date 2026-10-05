// EdgeVision — کلاینت موبایل
// Copyright © 2026 Parsa Fathi — Apache-2.0

import 'package:flutter/material.dart';

import '../api/client.dart';
import '../api/models.dart';
import '../main.dart';
import '../utils/persian.dart';
import '../utils/theme.dart';
import 'shared.dart';
import 'stream_detail.dart';

/// پردهٔ «استریم‌ها» — فهرست، ساخت، ویرایش، شروع/توقف و حذف.
class StreamsScreen extends StatefulWidget {
  const StreamsScreen({super.key});

  @override
  State<StreamsScreen> createState() => _StreamsScreenState();
}

class _StreamsScreenState extends State<StreamsScreen> {
  AppState? _app;
  Future<List<StreamItem>>? _future;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (_app == null) {
      _app = AppScope.of(context);
      _future = _app!.api.streams();
    }
  }

  void _reload() {
    setState(() => _future = _app!.api.streams());
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () => _openEditor(),
        icon: const Icon(Icons.add),
        label: const Text('استریم جدید'),
      ),
      body: RefreshIndicator(
        onRefresh: () async => _reload(),
        child: FutureBuilder<List<StreamItem>>(
          future: _future,
          builder: (context, snapshot) {
            if (snapshot.connectionState != ConnectionState.done) {
              return const LoadingView();
            }
            if (snapshot.hasError) {
              return ListView(
                physics: const AlwaysScrollableScrollPhysics(),
                children: [
                  SizedBox(
                    height: MediaQuery.sizeOf(context).height * 0.5,
                    child: ErrorView(
                      message: errorMessage(snapshot.error!),
                      onRetry: _reload,
                    ),
                  ),
                ],
              );
            }
            final items = snapshot.data!;
            if (items.isEmpty) {
              return ListView(
                physics: const AlwaysScrollableScrollPhysics(),
                children: const [
                  SizedBox(height: 120),
                  EmptyView(
                    message: 'هنوز استریمی ثبت نشده است',
                    hint: 'با دکمهٔ «استریم جدید» اولین استریم را بسازید',
                    icon: Icons.videocam_outlined,
                  ),
                ],
              );
            }
            return ListView.separated(
              physics: const AlwaysScrollableScrollPhysics(),
              padding: const EdgeInsets.fromLTRB(14, 14, 14, 96),
              itemCount: items.length,
              separatorBuilder: (_, __) => const SizedBox(height: 10),
              itemBuilder: (context, i) => _StreamCard(
                stream: items[i],
                onOpen: () => _openDetail(items[i]),
                onToggle: () => _toggle(items[i]),
                onEdit: () => _openEditor(existing: items[i]),
                onDelete: () => _delete(items[i]),
              ),
            );
          },
        ),
      ),
    );
  }

  void _openDetail(StreamItem stream) {
    Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) => StreamDetailScreen(streamId: stream.id, title: stream.name),
      ),
    );
  }

  Future<void> _toggle(StreamItem stream) async {
    final app = _app!;
    final messenger = ScaffoldMessenger.of(context);
    final running = stream.hasActiveSession;
    if (running) {
      final confirmed = await showDialog<bool>(
        context: context,
        builder: (context) => AlertDialog(
          title: const Text('توقف نشست'),
          content: Text(
            'نشست فعالِ «${stream.name}» متوقف شود؟ داده‌های ثبت‌شده حفظ می‌شوند.',
          ),
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
    try {
      if (running) {
        await app.api.stopStream(stream.id);
        if (mounted) {
          messenger.showSnackBar(
            const SnackBar(content: Text('نشست با موفقیت متوقف شد')),
          );
        }
      } else {
        await app.api.startStream(stream.id);
        if (mounted) {
          messenger.showSnackBar(
            const SnackBar(content: Text('نشست جدید آغاز شد — پردهٔ جزئیات را ببینید')),
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
      if (mounted) _reload();
    }
  }

  Future<void> _delete(StreamItem stream) async {
    final app = _app!;
    final messenger = ScaffoldMessenger.of(context);
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('حذف استریم'),
        content: Text(
          'استریم «${stream.name}» همراه با همهٔ نشست‌ها، تشخیص‌ها و رویدادهایش '
          'حذف می‌شود. این عمل بازگشت‌پذیر نیست.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('انصراف'),
          ),
          FilledButton(
            style: FilledButton.styleFrom(
              backgroundColor: EvColors.danger,
              foregroundColor: Colors.white,
            ),
            onPressed: () => Navigator.pop(context, true),
            child: const Text('حذف کن'),
          ),
        ],
      ),
    );
    if (confirmed != true) return;
    try {
      await app.api.deleteStream(stream.id);
      if (mounted) {
        messenger.showSnackBar(
          SnackBar(content: Text('استریم «${stream.name}» حذف شد')),
        );
      }
    } on Object catch (error) {
      if (mounted) {
        messenger.showSnackBar(
          SnackBar(content: Text(errorMessage(error)), backgroundColor: const Color(0xFF2A1714)),
        );
      }
    } finally {
      if (mounted) _reload();
    }
  }

  Future<void> _openEditor({StreamItem? existing}) async {
    final app = _app!;
    final saved = await showDialog<bool>(
      context: context,
      barrierDismissible: false,
      builder: (context) => StreamFormDialog(api: app.api, existing: existing),
    );
    if (saved == true) _reload();
  }
}

/// کارت یک استریم در فهرست.
class _StreamCard extends StatelessWidget {
  const _StreamCard({
    required this.stream,
    required this.onOpen,
    required this.onToggle,
    required this.onEdit,
    required this.onDelete,
  });

  final StreamItem stream;
  final VoidCallback onOpen;
  final VoidCallback onToggle;
  final VoidCallback onEdit;
  final VoidCallback onDelete;

  @override
  Widget build(BuildContext context) {
    final active = stream.activeSession;
    return Card(
      child: InkWell(
        borderRadius: BorderRadius.circular(14),
        onTap: onOpen,
        child: Padding(
          padding: const EdgeInsets.all(14),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Row(
                children: [
                  Expanded(
                    child: Text(
                      stream.name,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        color: EvColors.textHigh,
                        fontSize: 15,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                  ),
                  StatusChip.forStreamStatus(stream.status),
                  const SizedBox(width: 6),
                  _MenuAnchor(onEdit: onEdit, onDelete: onDelete),
                ],
              ),
              const SizedBox(height: 6),
              Text(
                '${sceneLabelFa(stream.scene)} · '
                '${faNumber(stream.width)}×${faNumber(stream.height)} · '
                '${faNumber(stream.targetFps, decimals: 0)} فریم/ث · '
                '${faNumber(stream.objectCount)} شیء',
                style: const TextStyle(color: EvColors.textMedium, fontSize: 12),
              ),
              const SizedBox(height: 4),
              Text(
                active == null
                    ? 'آخرین تغییر ${faDate(stream.updatedAt.toLocal())}'
                    : 'نشست فعال از ${faTime(active.startedAt.toLocal())} — '
                        'فریم ${faNumber(active.framesProcessed)}',
                style: const TextStyle(color: EvColors.textLow, fontSize: 11),
              ),
              const SizedBox(height: 10),
              Row(
                children: [
                  Expanded(
                    child: OutlinedButton.icon(
                      onPressed: onToggle,
                      style: OutlinedButton.styleFrom(
                        foregroundColor:
                            active == null ? EvColors.accent : EvColors.warn,
                      ),
                      icon: Icon(
                        active == null ? Icons.play_arrow : Icons.stop,
                        size: 18,
                      ),
                      label: Text(active == null ? 'شروع' : 'توقف'),
                    ),
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _MenuAnchor extends StatelessWidget {
  const _MenuAnchor({required this.onEdit, required this.onDelete});

  final VoidCallback onEdit;
  final VoidCallback onDelete;

  @override
  Widget build(BuildContext context) {
    return PopupMenuButton<String>(
      tooltip: 'کنش‌های بیشتر',
      icon: const Icon(Icons.more_vert, size: 20),
      onSelected: (value) {
        if (value == 'edit') onEdit();
        if (value == 'delete') onDelete();
      },
      itemBuilder: (context) => const [
        PopupMenuItem<String>(
          value: 'edit',
          child: Row(
            children: [
              Icon(Icons.edit_outlined, size: 18),
              SizedBox(width: 10),
              Text('ویرایش'),
            ],
          ),
        ),
        PopupMenuItem<String>(
          value: 'delete',
          child: Row(
            children: [
              Icon(Icons.delete_outline, size: 18),
              SizedBox(width: 10),
              Text('حذف'),
            ],
          ),
        ),
      ],
    );
  }
}

// — — — فرم ساخت/ویرایش استریم — — —

/// گفت‌وگوی ساخت/ویرایش استریم — همهٔ فیلدها با دامنهٔ مجاز سرور.
class StreamFormDialog extends StatefulWidget {
  const StreamFormDialog({super.key, required this.api, this.existing});

  final ApiService api;
  final StreamItem? existing;

  @override
  State<StreamFormDialog> createState() => _StreamFormDialogState();
}

/// رابط فرم: از سرویس مشترک برنامه تزریق می‌شود.
class _StreamFormDialogState extends State<StreamFormDialog> {
  static const List<String> _scenes = ['STREET', 'INTERSECTION', 'PARKING'];
  static const List<String> _classes = ['PEDESTRIAN', 'VEHICLE', 'CYCLIST'];

  late final TextEditingController _name;
  late String _scene;
  late double _width;
  late double _height;
  late double _targetFps;
  late double _objectCount;
  late double _confidence;
  late double _queueCapacity;
  late double _gridCols;
  late double _gridRows;
  late double _emitStride;
  late Set<String> _classFilter;
  late bool _useRoi;
  late bool _useLine;
  late TextEditingController _roiX;
  late TextEditingController _roiY;
  late TextEditingController _roiW;
  late TextEditingController _roiH;
  late TextEditingController _lineX1;
  late TextEditingController _lineY1;
  late TextEditingController _lineX2;
  late TextEditingController _lineY2;

  bool _saving = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    final e = widget.existing;
    _name = TextEditingController(text: e?.name ?? '');
    _scene = e?.scene ?? 'STREET';
    _width = (e?.width ?? 640).toDouble();
    _height = (e?.height ?? 360).toDouble();
    _targetFps = e?.targetFps ?? 15;
    _objectCount = (e?.objectCount ?? 8).toDouble();
    _confidence = e?.confidenceThreshold ?? 0.35;
    _queueCapacity = (e?.queueCapacity ?? 30).toDouble();
    _gridCols = (e?.gridCols ?? 40).toDouble();
    _gridRows = (e?.gridRows ?? 24).toDouble();
    _emitStride = (e?.emitStride ?? 2).toDouble();
    _classFilter = <String>{...?e?.classFilter};
    _useRoi = e?.roi != null;
    _useLine = e?.line != null;
    _roiX = TextEditingController(text: _fmt(e?.roi?.x));
    _roiY = TextEditingController(text: _fmt(e?.roi?.y));
    _roiW = TextEditingController(text: _fmt(e?.roi?.w));
    _roiH = TextEditingController(text: _fmt(e?.roi?.h));
    _lineX1 = TextEditingController(text: _fmt(e?.line?.x1));
    _lineY1 = TextEditingController(text: _fmt(e?.line?.y1));
    _lineX2 = TextEditingController(text: _fmt(e?.line?.x2));
    _lineY2 = TextEditingController(text: _fmt(e?.line?.y2));
  }

  @override
  void dispose() {
    _name.dispose();
    _roiX.dispose();
    _roiY.dispose();
    _roiW.dispose();
    _roiH.dispose();
    _lineX1.dispose();
    _lineY1.dispose();
    _lineX2.dispose();
    _lineY2.dispose();
    super.dispose();
  }

  static String _fmt(double? v) => v == null ? '' : v.toString();

  double? _parseNum(TextEditingController c) =>
      double.tryParse(c.text.trim().replaceAll(',', '.'));

  Future<void> _save() async {
    final name = _name.text.trim();
    if (name.isEmpty || name.length > 80) {
      setState(() => _error = 'نام استریم باید بین ۱ و ۸۰ نویسه باشد');
      return;
    }
    Roi? roi;
    if (_useRoi) {
      final x = _parseNum(_roiX);
      final y = _parseNum(_roiY);
      final w = _parseNum(_roiW);
      final h = _parseNum(_roiH);
      if (x == null || y == null || w == null || h == null ||
          x < 0 || x > 1 || y < 0 || y > 1 || w <= 0 || w > 1 || h <= 0 || h > 1) {
        setState(() => _error = 'مختصات ROI باید عددی بین ۰ و ۱ باشد (عرض و ارتفاع بزرگ‌تر از صفر)');
        return;
      }
      roi = Roi(x: x, y: y, w: w, h: h);
    }
    CrossLine? line;
    if (_useLine) {
      final x1 = _parseNum(_lineX1);
      final y1 = _parseNum(_lineY1);
      final x2 = _parseNum(_lineX2);
      final y2 = _parseNum(_lineY2);
      if (x1 == null || y1 == null || x2 == null || y2 == null ||
          x1 < 0 || x1 > 1 || y1 < 0 || y1 > 1 || x2 < 0 || x2 > 1 || y2 < 0 || y2 > 1) {
        setState(() => _error = 'مختصات خط باید عددی بین ۰ و ۱ باشد');
        return;
      }
      line = CrossLine(x1: x1, y1: y1, x2: x2, y2: y2);
    }

    final input = StreamInput(
      name: name,
      scene: _scene,
      width: _width.round(),
      height: _height.round(),
      targetFps: _targetFps,
      objectCount: _objectCount.round(),
      confidenceThreshold: _confidence,
      classFilter: _classFilter.toList(growable: false),
      roi: roi,
      line: line,
      queueCapacity: _queueCapacity.round(),
      gridCols: _gridCols.round(),
      gridRows: _gridRows.round(),
      emitStride: _emitStride.round(),
    );

    setState(() {
      _saving = true;
      _error = null;
    });
    try {
      final existing = widget.existing;
      if (existing == null) {
        await widget.api.createStream(input);
      } else {
        await widget.api.updateStream(existing.id, input);
      }
      if (mounted) Navigator.pop(context, true);
    } on Object catch (error) {
      setState(() {
        _saving = false;
        _error = errorMessage(error);
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final editing = widget.existing != null;
    return AlertDialog(
      title: Text(editing ? 'ویرایش استریم' : 'استریم جدید'),
      content: SizedBox(
        width: 520,
        child: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              TextField(
                controller: _name,
                maxLength: 80,
                decoration: const InputDecoration(
                  labelText: 'نام استریم',
                  counterText: '',
                ),
              ),
              const SizedBox(height: 12),
              DropdownButtonFormField<String>(
                initialValue: _scene,
                decoration: const InputDecoration(labelText: 'نوع صحنه'),
                items: [
                  for (final s in _scenes)
                    DropdownMenuItem(value: s, child: Text(sceneLabelFa(s))),
                ],
                onChanged: (v) => setState(() => _scene = v ?? 'STREET'),
              ),
              const SizedBox(height: 14),
              _SliderField(
                label: 'عرض تصویر',
                value: _width,
                min: 320,
                max: 1920,
                divisions: 160,
                format: (v) => '${faNumber(v.round())} پیکسل',
                onChanged: (v) => setState(() => _width = v),
              ),
              _SliderField(
                label: 'ارتفاع تصویر',
                value: _height,
                min: 240,
                max: 1080,
                divisions: 84,
                format: (v) => '${faNumber(v.round())} پیکسل',
                onChanged: (v) => setState(() => _height = v),
              ),
              _SliderField(
                label: 'نرخ فریم هدف',
                value: _targetFps,
                min: 1,
                max: 30,
                divisions: 29,
                format: (v) => '${faNumber(v.round())} فریم/ث',
                onChanged: (v) => setState(() => _targetFps = v),
              ),
              _SliderField(
                label: 'تعداد اشیا',
                value: _objectCount,
                min: 3,
                max: 20,
                divisions: 17,
                format: (v) => faNumber(v.round()),
                onChanged: (v) => setState(() => _objectCount = v),
              ),
              _SliderField(
                label: 'آستانهٔ اطمینان',
                value: _confidence,
                min: 0.05,
                max: 0.95,
                divisions: 18,
                format: (v) => faPercent((v * 100).round()),
                onChanged: (v) => setState(() => _confidence = v),
              ),
              const SizedBox(height: 12),
              Wrap(
                spacing: 8,
                runSpacing: 8,
                children: [
                  for (final c in _classes)
                    FilterChip(
                      label: Text(classLabelFa(c)),
                      selected: _classFilter.contains(c),
                      onSelected: (on) => setState(() {
                        if (on) {
                          _classFilter.add(c);
                        } else {
                          _classFilter.remove(c);
                        }
                      }),
                    ),
                ],
              ),
              const SizedBox(height: 6),
              Text(
                _classFilter.isEmpty
                    ? 'بدون فیلتر کلاس — همهٔ دسته‌ها پردازش می‌شوند'
                    : 'فیلتر کلاس: ${_classFilter.map(classLabelFa).join('، ')}',
                style: const TextStyle(color: EvColors.textLow, fontSize: 11),
              ),
              const SizedBox(height: 12),
              _SliderField(
                label: 'ظرفیت صف فریم',
                value: _queueCapacity,
                min: 5,
                max: 200,
                divisions: 39,
                format: (v) => faNumber(v.round()),
                onChanged: (v) => setState(() => _queueCapacity = v),
              ),
              _SliderField(
                label: 'ستون‌های شبکهٔ استنتاج',
                value: _gridCols,
                min: 16,
                max: 80,
                divisions: 64,
                format: (v) => faNumber(v.round()),
                onChanged: (v) => setState(() => _gridCols = v),
              ),
              _SliderField(
                label: 'سطرهای شبکهٔ استنتاج',
                value: _gridRows,
                min: 9,
                max: 48,
                divisions: 39,
                format: (v) => faNumber(v.round()),
                onChanged: (v) => setState(() => _gridRows = v),
              ),
              _SliderField(
                label: 'گام انتشار فریم',
                value: _emitStride,
                min: 1,
                max: 10,
                divisions: 9,
                format: (v) => 'هر ${faNumber(v.round())} فریم',
                onChanged: (v) => setState(() => _emitStride = v),
              ),
              const Divider(height: 24),
              SwitchListTile(
                title: const Text('ناحیهٔ پایش (ROI)'),
                subtitle: const Text(
                  'برای رویدادهای ورود و خروج',
                  style: TextStyle(fontSize: 11),
                ),
                value: _useRoi,
                onChanged: (v) => setState(() => _useRoi = v),
              ),
              if (_useRoi)
                Padding(
                  padding: const EdgeInsets.only(bottom: 8),
                  child: Column(
                    children: [
                      _coordRow('x', _roiX),
                      _coordRow('y', _roiY),
                      _coordRow('w (عرض)', _roiW),
                      _coordRow('h (ارتفاع)', _roiH),
                    ],
                  ),
                ),
              SwitchListTile(
                title: const Text('خط عبور'),
                subtitle: const Text(
                  'برای رویداد عبور از خط',
                  style: TextStyle(fontSize: 11),
                ),
                value: _useLine,
                onChanged: (v) => setState(() => _useLine = v),
              ),
              if (_useLine)
                Column(
                  children: [
                    _coordRow('x1', _lineX1),
                    _coordRow('y1', _lineY1),
                    _coordRow('x2', _lineX2),
                    _coordRow('y2', _lineY2),
                  ],
                ),
              if (_error != null) ...[
                const SizedBox(height: 10),
                Text(
                  _error!,
                  style: const TextStyle(color: EvColors.danger, fontSize: 12),
                ),
              ],
            ],
          ),
        ),
      ),
      actions: [
        TextButton(
          onPressed: _saving ? null : () => Navigator.pop(context, false),
          child: const Text('انصراف'),
        ),
        FilledButton(
          onPressed: _saving ? null : _save,
          child: _saving
              ? const SizedBox(
                  width: 18,
                  height: 18,
                  child: CircularProgressIndicator(strokeWidth: 2),
                )
              : Text(editing ? 'ذخیرهٔ تغییرات' : 'ایجاد استریم'),
        ),
      ],
    );
  }

  Widget _coordRow(String label, TextEditingController controller) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Row(
        children: [
          SizedBox(
            width: 76,
            child: Text(label, style: const TextStyle(color: EvColors.textMedium, fontSize: 12)),
          ),
          Expanded(
            child: TextField(
              controller: controller,
              keyboardType: const TextInputType.numberWithOptions(decimal: true),
              decoration: const InputDecoration(hintText: '۰ تا ۱'),
            ),
          ),
        ],
      ),
    );
  }
}

/// فیلد لغزنده با برچسب و مقدار قالب‌بندی‌شده.
class _SliderField extends StatelessWidget {
  const _SliderField({
    required this.label,
    required this.value,
    required this.min,
    required this.max,
    required this.divisions,
    required this.format,
    required this.onChanged,
  });

  final String label;
  final double value;
  final double min;
  final double max;
  final int divisions;
  final String Function(double value) format;
  final ValueChanged<double> onChanged;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Padding(
          padding: const EdgeInsets.only(top: 8),
          child: Row(
            children: [
              Expanded(
                child: Text(
                  label,
                  style: const TextStyle(color: EvColors.textMedium, fontSize: 12),
                ),
              ),
              Text(
                format(value),
                style: const TextStyle(
                  color: EvColors.accent,
                  fontSize: 12,
                  fontWeight: FontWeight.w700,
                ),
              ),
            ],
          ),
        ),
        Slider(
          value: value.clamp(min, max),
          min: min,
          max: max,
          divisions: divisions,
          label: format(value),
          onChanged: onChanged,
        ),
      ],
    );
  }
}
