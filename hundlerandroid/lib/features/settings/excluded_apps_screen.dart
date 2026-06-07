import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../core/colors.dart';
import '../../services/app_list_service.dart';

/// Экран «Исключения приложений» — главная фича анти-детекта.
///
/// Юзер выбирает приложения, которые **полностью** обходят VPN-туннель —
/// внутри них нет ни TRANSPORT_VPN, ни tun0, нет вообще ничего, что
/// может палить VPN. Поэтому Сбер / Госуслуги / ВТБ / Тинькофф / другие
/// "VPN-чувствительные" приложения работают как обычно (с российским
/// IP, через wlan0/mobile), даже когда VPN включён.
///
/// Это структурно идентично тому, как делают Hiddify, v2rayTun, NekoBox.
///
/// ## Контракт с CoreManager
///
///  - `lib/services/app_list_service.dart` сохраняет список в нативном
///     `ExcludedAppsStore` (SharedPreferences).
///  - `CoreManager.injectTunInboundIfMissing` при подключении VPN читает
///    этот список и инжектит в sing-box `tun.exclude_package`.
///  - sing-box передаёт в `HundlerPlatformInterface.openTun`, который
///    через `HundlerVpnService.applyPackageFilter` вызывает
///    `VpnService.Builder.addDisallowedApplication(pkg)` для каждого.
///
/// Изменения применяются **только на следующем переподключении** VPN —
/// если юзер сейчас подключён, показываем snack с просьбой переподключить.
class ExcludedAppsScreen extends StatefulWidget {
  const ExcludedAppsScreen({super.key});

  @override
  State<ExcludedAppsScreen> createState() => _ExcludedAppsScreenState();
}

class _ExcludedAppsScreenState extends State<ExcludedAppsScreen> {
  final _service = AppListService.instance;
  final _searchCtl = TextEditingController();

  List<InstalledApp> _apps = [];
  bool _loading = true;
  bool _dirty = false; // были ли изменения с момента входа
  String _query = '';

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _searchCtl.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    setState(() => _loading = true);
    final apps = await _service.getInstalledApps();
    if (!mounted) return;
    setState(() {
      _apps = apps;
      _loading = false;
    });
  }

  Future<void> _save() async {
    final excluded = _apps.where((a) => a.isExcluded).map((a) => a.packageName).toSet();
    await _service.setExcludedPackages(excluded);
    HapticFeedback.lightImpact();
    if (!mounted) return;
    _dirty = false;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(
          excluded.isEmpty
              ? 'Список очищен. Все приложения теперь через VPN.'
              : 'Сохранено: ${excluded.length} ${_pluralApps(excluded.length)} обходят VPN. '
                  'Переподключите VPN, чтобы изменения вступили в силу.',
        ),
        behavior: SnackBarBehavior.floating,
        margin: const EdgeInsets.all(16),
        duration: const Duration(seconds: 4),
      ),
    );
  }

  Future<void> _applyRuPreset() async {
    // Сохраняем все текущие изменения сначала.
    final current = _apps.where((a) => a.isExcluded).map((a) => a.packageName).toSet();
    final presetPackages = (await _service.getRuBankPreset()).toSet();
    final merged = {...current, ...presetPackages};

    setState(() {
      _apps = _apps
          .map((a) => a.copyWith(isExcluded: merged.contains(a.packageName)))
          .toList();
      _dirty = true;
    });
    HapticFeedback.lightImpact();
  }

  Future<void> _clearAll() async {
    setState(() {
      _apps = _apps.map((a) => a.copyWith(isExcluded: false)).toList();
      _dirty = true;
    });
    HapticFeedback.selectionClick();
  }

  void _toggle(int globalIndex) {
    setState(() {
      _apps[globalIndex] = _apps[globalIndex].copyWith(
        isExcluded: !_apps[globalIndex].isExcluded,
      );
      _dirty = true;
    });
    HapticFeedback.selectionClick();
  }

  String _pluralApps(int n) {
    final mod10 = n % 10;
    final mod100 = n % 100;
    if (mod10 == 1 && mod100 != 11) return 'приложение';
    if ((mod10 == 2 || mod10 == 3 || mod10 == 4) &&
        (mod100 < 12 || mod100 > 14)) {
      return 'приложения';
    }
    return 'приложений';
  }

  @override
  Widget build(BuildContext context) {
    // Фильтрация по поиску.
    final filtered = _query.isEmpty
        ? _apps
        : _apps
            .where((a) =>
                a.appName.toLowerCase().contains(_query) ||
                a.packageName.toLowerCase().contains(_query))
            .toList();

    final excludedCount = _apps.where((a) => a.isExcluded).length;

    return PopScope(
      canPop: !_dirty,
      onPopInvokedWithResult: (didPop, _) async {
        if (didPop) return;
        // Спрашиваем сохранять ли изменения.
        if (!mounted) return;
        final save = await showDialog<bool>(
          context: context,
          builder: (ctx) => AlertDialog(
            backgroundColor: HundlerColors.bgElevated,
            title: const Text('Сохранить изменения?'),
            content: const Text(
              'Список исключений изменился. Сохранить перед выходом?',
            ),
            actions: [
              TextButton(
                onPressed: () => Navigator.of(ctx).pop(false),
                child: const Text(
                  'Не сохранять',
                  style: TextStyle(color: HundlerColors.textSecondary),
                ),
              ),
              TextButton(
                onPressed: () => Navigator.of(ctx).pop(true),
                child: const Text(
                  'Сохранить',
                  style: TextStyle(color: HundlerColors.accentRed),
                ),
              ),
            ],
          ),
        );
        if (save == true) await _save();
        if (!mounted) return;
        Navigator.of(context).pop();
      },
      child: Scaffold(
        backgroundColor: HundlerColors.bgPrimary,
        appBar: AppBar(
          backgroundColor: HundlerColors.bgPrimary,
          elevation: 0,
          title: const Text('Исключения VPN'),
          actions: [
            if (_dirty)
              IconButton(
                onPressed: _save,
                icon: const Icon(LucideIcons.check, color: HundlerColors.success),
                tooltip: 'Сохранить',
              ),
          ],
        ),
        body: _loading
            ? const Center(
                child: CircularProgressIndicator(color: HundlerColors.accentRed),
              )
            : Column(
                children: [
                  _Header(excludedCount: excludedCount, totalCount: _apps.length),
                  Padding(
                    padding: const EdgeInsets.fromLTRB(
                      HundlerSpacing.lg,
                      HundlerSpacing.xs,
                      HundlerSpacing.lg,
                      HundlerSpacing.sm,
                    ),
                    child: _SearchField(
                      controller: _searchCtl,
                      onChanged: (q) => setState(() => _query = q.toLowerCase()),
                    ),
                  ),
                  Padding(
                    padding: const EdgeInsets.symmetric(
                      horizontal: HundlerSpacing.lg,
                    ),
                    child: Row(
                      children: [
                        Expanded(
                          child: _ActionChip(
                            icon: LucideIcons.landmark,
                            label: 'Пресет RU банков',
                            onTap: _applyRuPreset,
                          ),
                        ),
                        const SizedBox(width: HundlerSpacing.xs),
                        _ActionChip(
                          icon: LucideIcons.trash2,
                          label: 'Очистить',
                          onTap: _clearAll,
                          danger: true,
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: HundlerSpacing.sm),
                  Expanded(
                    child: filtered.isEmpty
                        ? const _EmptyState()
                        : ListView.builder(
                            padding: const EdgeInsets.fromLTRB(
                              HundlerSpacing.lg,
                              0,
                              HundlerSpacing.lg,
                              HundlerSpacing.xxl,
                            ),
                            itemCount: filtered.length,
                            itemBuilder: (_, i) {
                              final app = filtered[i];
                              return _AppTile(
                                app: app,
                                onToggle: () {
                                  final globalIdx = _apps.indexWhere(
                                    (a) => a.packageName == app.packageName,
                                  );
                                  if (globalIdx >= 0) _toggle(globalIdx);
                                },
                              );
                            },
                          ),
                  ),
                ],
              ),
      ),
    );
  }
}

class _Header extends StatelessWidget {
  const _Header({required this.excludedCount, required this.totalCount});
  final int excludedCount;
  final int totalCount;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Container(
      width: double.infinity,
      margin: const EdgeInsets.fromLTRB(
        HundlerSpacing.lg,
        HundlerSpacing.sm,
        HundlerSpacing.lg,
        HundlerSpacing.xs,
      ),
      padding: const EdgeInsets.all(HundlerSpacing.md),
      decoration: BoxDecoration(
        color: HundlerColors.accentRedSoft,
        borderRadius: BorderRadius.circular(HundlerRadius.md),
        border: Border.all(
          color: HundlerColors.accentRed.withValues(alpha: 0.25),
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const Icon(LucideIcons.shield, size: 18, color: HundlerColors.accentRed),
              const SizedBox(width: HundlerSpacing.xs),
              Text(
                'Обход для $excludedCount из $totalCount',
                style: theme.textTheme.titleSmall?.copyWith(
                  fontWeight: FontWeight.w700,
                ),
              ),
            ],
          ),
          const SizedBox(height: HundlerSpacing.xxs),
          Text(
            'Отмеченные приложения НЕ идут через VPN — у них настоящий IP, '
            'нет VPN-маркеров. Банки и госуслуги не палят туннель.',
            style: theme.textTheme.bodySmall?.copyWith(
              color: HundlerColors.textSecondary,
              height: 1.35,
            ),
          ),
        ],
      ),
    );
  }
}

class _SearchField extends StatelessWidget {
  const _SearchField({required this.controller, required this.onChanged});
  final TextEditingController controller;
  final ValueChanged<String> onChanged;

  @override
  Widget build(BuildContext context) {
    return TextField(
      controller: controller,
      onChanged: onChanged,
      style: const TextStyle(color: HundlerColors.textPrimary, fontSize: 14),
      decoration: InputDecoration(
        hintText: 'Поиск приложения…',
        hintStyle: const TextStyle(color: HundlerColors.textSecondary, fontSize: 14),
        prefixIcon: const Icon(LucideIcons.search, size: 18, color: HundlerColors.textSecondary),
        filled: true,
        fillColor: HundlerColors.bgSurface,
        contentPadding: const EdgeInsets.symmetric(vertical: 12, horizontal: 12),
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(HundlerRadius.sm),
          borderSide: const BorderSide(color: HundlerColors.borderSubtle),
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(HundlerRadius.sm),
          borderSide: const BorderSide(color: HundlerColors.borderSubtle),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(HundlerRadius.sm),
          borderSide: const BorderSide(color: HundlerColors.accentRed, width: 1.2),
        ),
      ),
    );
  }
}

class _ActionChip extends StatelessWidget {
  const _ActionChip({
    required this.icon,
    required this.label,
    required this.onTap,
    this.danger = false,
  });

  final IconData icon;
  final String label;
  final VoidCallback onTap;
  final bool danger;

  @override
  Widget build(BuildContext context) {
    final color = danger ? HundlerColors.danger : HundlerColors.accentRed;
    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(HundlerRadius.xs),
        child: Ink(
          padding: const EdgeInsets.symmetric(vertical: 10, horizontal: 12),
          decoration: BoxDecoration(
            color: color.withValues(alpha: 0.08),
            borderRadius: BorderRadius.circular(HundlerRadius.xs),
            border: Border.all(color: color.withValues(alpha: 0.3)),
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Icon(icon, size: 14, color: color),
              const SizedBox(width: 6),
              Flexible(
                child: Text(
                  label,
                  style: TextStyle(
                    color: color,
                    fontSize: 12,
                    fontWeight: FontWeight.w600,
                  ),
                  overflow: TextOverflow.ellipsis,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _AppTile extends StatelessWidget {
  const _AppTile({required this.app, required this.onToggle});
  final InstalledApp app;
  final VoidCallback onToggle;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: onToggle,
        borderRadius: BorderRadius.circular(HundlerRadius.xs),
        child: Padding(
          padding: const EdgeInsets.symmetric(
            vertical: HundlerSpacing.sm,
            horizontal: HundlerSpacing.xs,
          ),
          child: Row(
            children: [
              _AppAvatar(initial: app.appName.isEmpty ? '?' : app.appName.characters.first.toUpperCase()),
              const SizedBox(width: HundlerSpacing.sm),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      app.appName,
                      style: theme.textTheme.bodyMedium?.copyWith(
                        fontWeight: FontWeight.w500,
                      ),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                    const SizedBox(height: 2),
                    Text(
                      app.packageName,
                      style: theme.textTheme.bodySmall?.copyWith(
                        color: HundlerColors.textSecondary,
                        fontSize: 11,
                      ),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                  ],
                ),
              ),
              Switch.adaptive(
                value: app.isExcluded,
                onChanged: (_) => onToggle(),
                activeColor: HundlerColors.accentRed,
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _AppAvatar extends StatelessWidget {
  const _AppAvatar({required this.initial});
  final String initial;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: 36,
      height: 36,
      decoration: BoxDecoration(
        color: HundlerColors.bgElevated,
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: HundlerColors.borderSubtle),
      ),
      alignment: Alignment.center,
      child: Text(
        initial,
        style: const TextStyle(
          fontWeight: FontWeight.w700,
          fontSize: 14,
          color: HundlerColors.textPrimary,
        ),
      ),
    );
  }
}

class _EmptyState extends StatelessWidget {
  const _EmptyState();

  @override
  Widget build(BuildContext context) {
    return const Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(LucideIcons.packageOpen, size: 48, color: HundlerColors.textSecondary),
          SizedBox(height: HundlerSpacing.sm),
          Text(
            'Ничего не найдено',
            style: TextStyle(color: HundlerColors.textSecondary, fontSize: 14),
          ),
        ],
      ),
    );
  }
}
