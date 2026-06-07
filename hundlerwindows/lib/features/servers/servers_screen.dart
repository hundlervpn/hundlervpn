import 'package:country_flags/country_flags.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';
import 'package:window_manager/window_manager.dart';

import '../../core/api_client.dart';
import '../../core/colors.dart';
import '../vpn/vpn_protocol_controller.dart';
import 'servers_controller.dart';

/// Экран выбора сервера — премиум.
///
/// Дизайн вдохновлён NordVPN / ProtonVPN (как самым «дорогим» на рынке).
/// Ключевые элементы:
///
/// - Кастомный header (no AppBar) — frameless окно требует draggable
///   зону, AppBar нативно её не даёт.
/// - Каждый сервер — крупная карточка 70+ px высотой с круглой
///   country-плашкой, заголовком (русское название страны), subtitle
///   (server.name = «Обход Глушилок» / «YouTube» / etc), бейджем
///   технологии (`VLESS · Reality`), индикатором онлайн (зелёная точка).
/// - При наведении hover-glow (тонкий красный shadow), при выборе —
///   красная рамка + чек.
/// - При тапе моментально применяем `selectedServerProvider.select()`
///   и закрываем экран — без подтверждения. Если юзер передумал, он
///   просто откроет снова.
/// - В пустом и error состояниях — крупные illustration'ы (иконки
///   Lucide размер 40), centred CTA «Повторить».
class ServersScreen extends ConsumerWidget {
  const ServersScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final serversAsync = ref.watch(serversProvider);
    final selected = ref.watch(selectedServerProvider);
    final protocol = ref.watch(vpnProtocolProvider);

    return Scaffold(
      backgroundColor: HundlerColors.bgPrimary,
      body: SafeArea(
        child: Column(
          children: [
            _Header(
              onRefresh: () => ref.read(serversProvider.notifier).refresh(),
            ),
            // Переключатель VLESS / Hysteria — управляет фильтрацией
            // списка локаций ниже. При выборе Hysteria покажутся только
            // серверы у которых бэкенд вернул `protocols: ["...", "hysteria"]`
            // (фактически — DE 213.182.213.183, единственный с Hy2 inbound).
            const _ProtocolToggle(),
            Expanded(
              child: serversAsync.when(
                loading: () => const Center(
                  child: CircularProgressIndicator(
                    color: HundlerColors.accentRed,
                  ),
                ),
                error: (e, _) => _ErrorState(
                  message: e.toString(),
                  onRetry: () =>
                      ref.read(serversProvider.notifier).refresh(),
                ),
                data: (servers) {
                  if (servers.isEmpty) {
                    return _EmptyState(
                      onRetry: () =>
                          ref.read(serversProvider.notifier).refresh(),
                    );
                  }
                  // Фильтруем по поддерживаемому протоколу.
                  final filterTag = protocol.serverFilterTag;
                  final filtered = servers
                      .where((s) => s.supports(filterTag))
                      .toList(growable: false);

                  if (filtered.isEmpty) {
                    return _ProtocolEmptyState(
                      protocolName: protocol.displayName,
                      onSwitchToVless: () => ref
                          .read(vpnProtocolProvider.notifier)
                          .set(VpnProtocol.vless),
                    );
                  }

                  return _ServersList(
                    servers: filtered,
                    selectedId: selected?.id,
                    onSelect: (s) async {
                      await ref
                          .read(selectedServerProvider.notifier)
                          .select(s);
                      if (context.mounted) {
                        Navigator.of(context).maybePop();
                      }
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

/// Segment-control над списком локаций. По кнопке VLESS / Hysteria,
/// идентичный по стилю тому что был на главной до 2026-05-15. После
/// смены протокола `SelectedServerController` сам перепикнет первый
/// поддерживаемый сервер из списка (см. `servers_controller.dart`).
class _ProtocolToggle extends ConsumerWidget {
  const _ProtocolToggle();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final p = ref.watch(vpnProtocolProvider);
    return Padding(
      padding: const EdgeInsets.symmetric(
        horizontal: HundlerSpacing.md,
        vertical: HundlerSpacing.sm,
      ),
      child: Container(
        padding: const EdgeInsets.all(4),
        decoration: BoxDecoration(
          color: HundlerColors.bgSurface,
          borderRadius: BorderRadius.circular(HundlerRadius.sm),
          border: Border.all(color: HundlerColors.borderSubtle),
        ),
        child: Row(
          children: [
            Expanded(
              child: _ProtocolButton(
                label: 'VLESS',
                icon: LucideIcons.shieldCheck,
                active: p == VpnProtocol.vless,
                onTap: () => ref
                    .read(vpnProtocolProvider.notifier)
                    .set(VpnProtocol.vless),
              ),
            ),
            const SizedBox(width: 4),
            Expanded(
              child: _ProtocolButton(
                label: 'Hysteria',
                icon: LucideIcons.zap,
                active: p == VpnProtocol.hysteria,
                onTap: () => ref
                    .read(vpnProtocolProvider.notifier)
                    .set(VpnProtocol.hysteria),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _ProtocolButton extends StatelessWidget {
  const _ProtocolButton({
    required this.label,
    required this.icon,
    required this.active,
    required this.onTap,
  });

  final String label;
  final IconData icon;
  final bool active;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      behavior: HitTestBehavior.opaque,
      onTap: onTap,
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 160),
        padding: const EdgeInsets.symmetric(
          horizontal: HundlerSpacing.sm,
          vertical: 12,
        ),
        decoration: BoxDecoration(
          color: active
              ? HundlerColors.accentRed.withValues(alpha: 0.18)
              : Colors.transparent,
          borderRadius: BorderRadius.circular(HundlerRadius.xs),
          border: Border.all(
            color: active
                ? HundlerColors.accentRed.withValues(alpha: 0.55)
                : Colors.transparent,
          ),
        ),
        child: Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(
              icon,
              size: 14,
              color: active
                  ? HundlerColors.accentRed
                  : HundlerColors.textSecondary,
            ),
            const SizedBox(width: 6),
            Text(
              label,
              style: TextStyle(
                fontWeight: FontWeight.w700,
                fontSize: 12,
                letterSpacing: 0.4,
                color: active
                    ? HundlerColors.textPrimary
                    : HundlerColors.textSecondary,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// Empty state — серверов с выбранным протоколом нет в списке.
/// Сейчас единственный реалистичный кейс: юзер тапнул Hysteria, а DE
/// сервер оффлайн / задеактивирован → backend не вернул его в `/api/servers`.
class _ProtocolEmptyState extends StatelessWidget {
  const _ProtocolEmptyState({
    required this.protocolName,
    required this.onSwitchToVless,
  });
  final String protocolName;
  final VoidCallback onSwitchToVless;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(HundlerSpacing.xl),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(
              width: 56,
              height: 56,
              alignment: Alignment.center,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                color: HundlerColors.bgElevated,
                border: Border.all(color: HundlerColors.borderSubtle),
              ),
              child: const Icon(
                LucideIcons.zapOff,
                size: 24,
                color: HundlerColors.textSecondary,
              ),
            ),
            const SizedBox(height: HundlerSpacing.md),
            Text(
              'Серверы $protocolName временно недоступны',
              textAlign: TextAlign.center,
              style: Theme.of(context).textTheme.titleMedium?.copyWith(
                    fontWeight: FontWeight.w700,
                  ),
            ),
            const SizedBox(height: HundlerSpacing.xs),
            Text(
              'Сейчас доступен только VLESS — он работает на всех серверах.',
              textAlign: TextAlign.center,
              style: Theme.of(context).textTheme.bodySmall?.copyWith(
                    color: HundlerColors.textSecondary,
                  ),
            ),
            const SizedBox(height: HundlerSpacing.lg),
            FilledButton.icon(
              onPressed: onSwitchToVless,
              icon: const Icon(LucideIcons.shieldCheck, size: 16),
              label: const Text('Переключиться на VLESS'),
              style: FilledButton.styleFrom(
                backgroundColor: HundlerColors.accentRed,
                foregroundColor: Colors.white,
                padding: const EdgeInsets.symmetric(
                  horizontal: 20,
                  vertical: 14,
                ),
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(HundlerRadius.sm),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _Header extends StatelessWidget {
  const _Header({required this.onRefresh});
  final VoidCallback onRefresh;

  @override
  Widget build(BuildContext context) {
    return DragToMoveArea(
      child: Container(
        height: 56,
        padding: const EdgeInsets.symmetric(horizontal: HundlerSpacing.xs),
        decoration: const BoxDecoration(
          border: Border(
            bottom: BorderSide(color: HundlerColors.borderSubtle),
          ),
        ),
        child: Row(
          children: [
            _HeaderButton(
              icon: LucideIcons.chevronLeft,
              tooltip: 'Назад',
              onTap: () => Navigator.of(context).maybePop(),
            ),
            Expanded(
              child: Text(
                'Выберите локацию',
                textAlign: TextAlign.center,
                style: Theme.of(context).textTheme.titleMedium?.copyWith(
                      fontWeight: FontWeight.w700,
                    ),
              ),
            ),
            _HeaderButton(
              icon: LucideIcons.refreshCw,
              tooltip: 'Обновить',
              onTap: onRefresh,
            ),
          ],
        ),
      ),
    );
  }
}

class _HeaderButton extends StatefulWidget {
  const _HeaderButton({
    required this.icon,
    required this.tooltip,
    required this.onTap,
  });
  final IconData icon;
  final String tooltip;
  final VoidCallback onTap;

  @override
  State<_HeaderButton> createState() => _HeaderButtonState();
}

class _HeaderButtonState extends State<_HeaderButton> {
  bool _hover = false;

  @override
  Widget build(BuildContext context) {
    return MouseRegion(
      cursor: SystemMouseCursors.click,
      onEnter: (_) => setState(() => _hover = true),
      onExit: (_) => setState(() => _hover = false),
      child: GestureDetector(
        behavior: HitTestBehavior.opaque,
        onTap: widget.onTap,
        child: Tooltip(
          message: widget.tooltip,
          child: Container(
            width: 44,
            height: 44,
            alignment: Alignment.center,
            decoration: BoxDecoration(
              color: _hover ? HundlerColors.bgElevated : Colors.transparent,
              borderRadius: BorderRadius.circular(HundlerRadius.xs),
            ),
            child: Icon(
              widget.icon,
              size: 18,
              color: HundlerColors.textPrimary,
            ),
          ),
        ),
      ),
    );
  }
}

class _ServersList extends StatelessWidget {
  const _ServersList({
    required this.servers,
    required this.selectedId,
    required this.onSelect,
  });

  final List<HundlerServer> servers;
  final int? selectedId;
  final ValueChanged<HundlerServer> onSelect;

  @override
  Widget build(BuildContext context) {
    // Сортируем по country (так юзер видит соседние локации одной
    // страны рядом). Активные серверы — первыми, deactivated — внизу
    // (даже не должны прийти из API, но на всякий).
    final sorted = [...servers]..sort((a, b) {
        if (a.isActive != b.isActive) return a.isActive ? -1 : 1;
        final c = a.country.compareTo(b.country);
        if (c != 0) return c;
        return a.name.compareTo(b.name);
      });

    return ListView.separated(
      padding: const EdgeInsets.symmetric(
        horizontal: HundlerSpacing.md,
        vertical: HundlerSpacing.md,
      ),
      itemCount: sorted.length + 1,
      separatorBuilder: (_, __) =>
          const SizedBox(height: HundlerSpacing.xs),
      itemBuilder: (context, i) {
        if (i == 0) {
          return Padding(
            padding: const EdgeInsets.only(
              bottom: HundlerSpacing.xs,
              left: HundlerSpacing.xs,
            ),
            child: Text(
              'ДОСТУПНЫЕ ЛОКАЦИИ · ${sorted.length}',
              style: TextStyle(
                color: HundlerColors.textSecondary,
                fontSize: 10,
                letterSpacing: 1.2,
                fontWeight: FontWeight.w700,
              ),
            ),
          );
        }
        final s = sorted[i - 1];
        return _ServerTile(
          server: s,
          selected: s.id == selectedId,
          onTap: () => onSelect(s),
        );
      },
    );
  }
}

class _ServerTile extends ConsumerStatefulWidget {
  const _ServerTile({
    required this.server,
    required this.selected,
    required this.onTap,
  });

  final HundlerServer server;
  final bool selected;
  final VoidCallback onTap;

  @override
  ConsumerState<_ServerTile> createState() => _ServerTileState();
}

class _ServerTileState extends ConsumerState<_ServerTile> {
  bool _hover = false;
  bool _pressed = false;

  @override
  Widget build(BuildContext context) {
    final s = widget.server;
    final selected = widget.selected;
    final country = _localCountryName(s.country);
    // Чипы протокола показываем только для активного протокола: на
    // вкладке VLESS юзер не должен видеть HYSTERIA-бейдж у Германии,
    // и наоборот. Это убирает дезориентацию из issue 2026-05-15.
    final protocol = ref.watch(vpnProtocolProvider);
    final showVless = protocol == VpnProtocol.vless && s.supports('vless');
    final showHysteria =
        protocol == VpnProtocol.hysteria && s.supports('hysteria');
    final subtitle = s.name.isEmpty
        ? (protocol == VpnProtocol.hysteria
            ? 'Hysteria 2 · QUIC'
            : 'VLESS · Reality · uTLS')
        : s.name;

    final borderColor = selected
        ? HundlerColors.accentRed
        : (_hover
            ? HundlerColors.accentRed.withValues(alpha: 0.45)
            : HundlerColors.borderSubtle);
    final bg = selected
        ? HundlerColors.accentRedSoft
        : (_hover ? HundlerColors.bgElevated : HundlerColors.bgSurface);

    return MouseRegion(
      cursor: SystemMouseCursors.click,
      onEnter: (_) => setState(() => _hover = true),
      onExit: (_) => setState(() {
        _hover = false;
        _pressed = false;
      }),
      child: GestureDetector(
        behavior: HitTestBehavior.opaque,
        onTapDown: (_) => setState(() => _pressed = true),
        onTapCancel: () => setState(() => _pressed = false),
        onTapUp: (_) => setState(() => _pressed = false),
        onTap: widget.onTap,
        child: AnimatedScale(
          duration: const Duration(milliseconds: 120),
          scale: _pressed ? 0.98 : 1.0,
          child: AnimatedContainer(
            duration: const Duration(milliseconds: 160),
            padding: const EdgeInsets.symmetric(
              horizontal: HundlerSpacing.md,
              vertical: HundlerSpacing.md,
            ),
            decoration: BoxDecoration(
              color: bg,
              borderRadius: BorderRadius.circular(HundlerRadius.md),
              border: Border.all(
                color: borderColor,
                width: selected ? 1.5 : 1.0,
              ),
              boxShadow: (_hover || selected)
                  ? [
                      BoxShadow(
                        color: HundlerColors.accentRed
                            .withValues(alpha: selected ? 0.25 : 0.15),
                        blurRadius: 18,
                        spreadRadius: 0,
                      ),
                    ]
                  : null,
            ),
            child: Row(
              children: [
                _CountryBadge(iso: s.country, selected: selected),
                const SizedBox(width: HundlerSpacing.md),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        children: [
                          Flexible(
                            child: Text(
                              country,
                              style: Theme.of(context)
                                  .textTheme
                                  .titleMedium
                                  ?.copyWith(
                                    fontWeight: FontWeight.w700,
                                  ),
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                            ),
                          ),
                          const SizedBox(width: HundlerSpacing.xs),
                          if (s.isActive) const _OnlineDot(),
                        ],
                      ),
                      const SizedBox(height: 2),
                      Text(
                        subtitle,
                        style: Theme.of(context)
                            .textTheme
                            .bodySmall
                            ?.copyWith(
                              color: HundlerColors.textSecondary,
                              fontSize: 11,
                              height: 1.3,
                            ),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                      ),
                      const SizedBox(height: HundlerSpacing.xs),
                      Wrap(
                        spacing: HundlerSpacing.xxs,
                        runSpacing: HundlerSpacing.xxs,
                        children: [
                          _Pill(
                            text: 'PREMIUM',
                            color: HundlerColors.accentRed,
                          ),
                          if (showVless)
                            _Pill(
                              text: 'VLESS',
                              color: HundlerColors.textSecondary,
                            ),
                          if (showVless)
                            _Pill(
                              text: 'REALITY',
                              color: HundlerColors.textSecondary,
                            ),
                          if (showHysteria)
                            _Pill(
                              text: 'HYSTERIA',
                              color: HundlerColors.accentOrange,
                            ),
                        ],
                      ),
                    ],
                  ),
                ),
                AnimatedContainer(
                  duration: const Duration(milliseconds: 160),
                  width: selected ? 28 : 0,
                  height: 28,
                  alignment: Alignment.center,
                  child: selected
                      ? const Icon(
                          LucideIcons.checkCheck,
                          size: 22,
                          color: HundlerColors.accentRed,
                        )
                      : null,
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// Круглая «плашка страны» — SVG-флаг через `country_flags`.
///
/// При selected обводка красная и чуть жирнее. На Windows этот пакет
/// нужен потому что Segoe UI Emoji не рендерит regional-indicator
/// флаги (политическое решение Microsoft).
class _CountryBadge extends StatelessWidget {
  const _CountryBadge({required this.iso, required this.selected});
  final String iso;
  final bool selected;

  @override
  Widget build(BuildContext context) {
    const size = 48.0;
    final border = Border.all(
      color: selected
          ? HundlerColors.accentRed
          : HundlerColors.accentRed.withValues(alpha: 0.35),
      width: selected ? 1.8 : 1.2,
    );
    final shadow = [
      BoxShadow(
        color: HundlerColors.accentRed
            .withValues(alpha: selected ? 0.35 : 0.18),
        blurRadius: 12,
        spreadRadius: 1,
      ),
    ];

    if (iso.length != 2) {
      return Container(
        width: size,
        height: size,
        alignment: Alignment.center,
        decoration: BoxDecoration(
          shape: BoxShape.circle,
          color: HundlerColors.bgElevated,
          border: border,
          boxShadow: shadow,
        ),
        child: const Text(
          '??',
          style: TextStyle(
            fontWeight: FontWeight.w800,
            fontSize: 13,
            color: HundlerColors.textSecondary,
          ),
        ),
      );
    }
    return Container(
      width: size,
      height: size,
      decoration: BoxDecoration(
        shape: BoxShape.circle,
        border: border,
        boxShadow: shadow,
      ),
      clipBehavior: Clip.antiAlias,
      child: CountryFlag.fromCountryCode(
        iso,
        shape: const Circle(),
        width: size,
        height: size,
      ),
    );
  }
}

/// Зелёная dot (8×8) — индикатор «сервер активен».
class _OnlineDot extends StatelessWidget {
  const _OnlineDot();

  @override
  Widget build(BuildContext context) {
    return Container(
      width: 8,
      height: 8,
      decoration: BoxDecoration(
        shape: BoxShape.circle,
        color: HundlerColors.success,
        boxShadow: [
          BoxShadow(
            color: HundlerColors.success.withValues(alpha: 0.6),
            blurRadius: 6,
            spreadRadius: 1,
          ),
        ],
      ),
    );
  }
}

/// Мини-бейдж (PREMIUM / VLESS / REALITY).
class _Pill extends StatelessWidget {
  const _Pill({required this.text, required this.color});
  final String text;
  final Color color;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(
        horizontal: HundlerSpacing.xs,
        vertical: 2,
      ),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(HundlerRadius.xs),
        border: Border.all(color: color.withValues(alpha: 0.35)),
      ),
      child: Text(
        text,
        style: TextStyle(
          color: color,
          fontSize: 9,
          fontWeight: FontWeight.w800,
          letterSpacing: 0.8,
        ),
      ),
    );
  }
}

class _ErrorState extends StatelessWidget {
  const _ErrorState({required this.message, required this.onRetry});
  final String message;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(HundlerSpacing.xl),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(
              width: 64,
              height: 64,
              alignment: Alignment.center,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                color: HundlerColors.danger.withValues(alpha: 0.12),
                border: Border.all(
                  color: HundlerColors.danger.withValues(alpha: 0.35),
                ),
              ),
              child: const Icon(
                LucideIcons.triangleAlert,
                size: 28,
                color: HundlerColors.danger,
              ),
            ),
            const SizedBox(height: HundlerSpacing.md),
            Text(
              'Не удалось загрузить серверы',
              style: Theme.of(context).textTheme.titleMedium,
            ),
            const SizedBox(height: HundlerSpacing.xs),
            Text(
              message,
              textAlign: TextAlign.center,
              style: Theme.of(context).textTheme.bodySmall?.copyWith(
                    color: HundlerColors.textSecondary,
                  ),
            ),
            const SizedBox(height: HundlerSpacing.lg),
            OutlinedButton.icon(
              icon: const Icon(LucideIcons.refreshCw, size: 16),
              label: const Text('Повторить'),
              onPressed: onRetry,
            ),
          ],
        ),
      ),
    );
  }
}

class _EmptyState extends StatelessWidget {
  const _EmptyState({required this.onRetry});
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(HundlerSpacing.xl),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(
              LucideIcons.serverOff,
              size: 40,
              color: HundlerColors.textSecondary,
            ),
            const SizedBox(height: HundlerSpacing.md),
            Text(
              'Серверы не найдены',
              style: Theme.of(context).textTheme.titleMedium,
            ),
            const SizedBox(height: HundlerSpacing.xs),
            Text(
              'Попробуйте обновить список — возможно, проблема со связью.',
              textAlign: TextAlign.center,
              style: Theme.of(context).textTheme.bodySmall?.copyWith(
                    color: HundlerColors.textSecondary,
                  ),
            ),
            const SizedBox(height: HundlerSpacing.lg),
            OutlinedButton.icon(
              icon: const Icon(LucideIcons.refreshCw, size: 16),
              label: const Text('Обновить'),
              onPressed: onRetry,
            ),
          ],
        ),
      ),
    );
  }
}

String _localCountryName(String iso) {
  switch (iso) {
    case 'DE':
      return 'Германия';
    case 'NL':
      return 'Нидерланды';
    case 'RU':
      return 'Россия';
    case 'US':
      return 'США';
    case 'GB':
      return 'Великобритания';
    case 'FR':
      return 'Франция';
    case 'JP':
      return 'Япония';
    default:
      return iso;
  }
}
