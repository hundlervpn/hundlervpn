import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../core/api_client.dart';
import '../../core/colors.dart';
import '../../core/typography.dart';
import '../../data/repositories/subscription_repository.dart';
import '../../services/vpn_service.dart';
import '../servers/servers_controller.dart';
import '../servers/servers_sheet.dart';
import '../subscription/subscription_controller.dart';
import 'widgets/connect_tiger.dart';

/// Главный экран — тигр-кнопка по центру + минимум всего остального.
///
/// Дизайн-философия: премиум, тёмный, минималистичный. Один primary
/// action — тапнуть тигра — = подключиться/отключиться. Дополнительные
/// контролы (логаут, выбор сервера) спрятаны в subtle UI, не отвлекают.
///
/// Стейт: status подключения держит [VpnService] через event stream.
/// UI чисто реактивный, никакой бизнес-логики здесь нет.
class HomeScreen extends ConsumerStatefulWidget {
  const HomeScreen({super.key});

  @override
  ConsumerState<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends ConsumerState<HomeScreen> {
  final _vpn = VpnService.instance;
  VpnConnectionStatus _status = VpnConnectionStatus.disconnected;

  @override
  void initState() {
    super.initState();
    _vpn.attach();
    _vpn.statusStream.listen((s) {
      if (!mounted) return;
      setState(() => _status = s);
    });
  }

  Future<void> _onTigerTap() async {
    // Уже подключены — отключаемся.
    if (_status == VpnConnectionStatus.connected) {
      await _vpn.disconnect();
      return;
    }
    // В процессе — игнорируем повторный тап (anti-spam).
    if (_status == VpnConnectionStatus.connecting ||
        _status == VpnConnectionStatus.disconnecting) {
      return;
    }

    // 1. Проверяем что выбран сервер (без него не из чего собрать config).
    final selectedServer = ref.read(selectedServerProvider);
    if (selectedServer == null) {
      _showSnack('Сначала выберите сервер');
      _openServerSheet();
      return;
    }

    // 2. Запросить системное VPN-разрешение (только при первом коннекте).
    final granted = await _vpn.prepare();
    if (!granted) {
      if (!mounted) return;
      _showSnack('Нет разрешения на VPN-туннель');
      return;
    }

    // 3. Загрузить sing-box JSON с бэкенда (sub_token уже в auth state).
    final SubscriptionResponse? subscription;
    try {
      subscription = await loadSubscription(ref);
    } on SubscriptionBlockedException catch (e) {
      if (!mounted) return;
      _showSnack(e.message);
      return;
    } catch (e) {
      if (!mounted) return;
      _showSnack('Не удалось получить конфиг: $e');
      return;
    }
    if (subscription == null) {
      if (!mounted) return;
      _showSnack('Нет активной подписки. Откройте мини-апп для оформления.');
      return;
    }

    // 4. Передаём sing-box JSON в нативную сторону.
    //    Сейчас Kotlin-сторона — stub без libcore.aar; при наличии
    //    .aar реальный туннель поднимется без других изменений.
    await _vpn.connect(
      configJson: subscription.configJson,
      profileName: 'Hundler VPN — ${selectedServer.country}',
    );
  }

  void _showSnack(String msg) {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(msg),
        behavior: SnackBarBehavior.floating,
        margin: const EdgeInsets.all(16),
      ),
    );
  }

  void _openServerSheet() {
    showModalBottomSheet<void>(
      context: context,
      backgroundColor: Colors.transparent,
      isScrollControlled: true,
      builder: (_) => const ServersSheet(),
    );
  }

  @override
  Widget build(BuildContext context) {
    final size = MediaQuery.of(context).size;
    final tigerSize = _tigerSize(size);
    return Scaffold(
      extendBodyBehindAppBar: true,
      appBar: _buildAppBar(context),
      body: Stack(
        children: [
          _PremiumBackground(status: _status),
          SafeArea(
            child: Padding(
              padding: const EdgeInsets.fromLTRB(20, 8, 20, 24),
              child: Column(
                children: [
                  const Spacer(flex: 3),
                  ConnectTiger(
                    status: _status,
                    size: tigerSize,
                    onTap: _onTigerTap,
                  ),
                  const SizedBox(height: 28),
                  _StatusText(status: _status),
                  const Spacer(flex: 2),
                  _ServerChip(
                    status: _status,
                    onTap: _openServerSheet,
                  ),
                  const SizedBox(height: 8),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }

  /// AppBar: бренд по центру (как в мини-аппе) + гира справа,
  /// открывающая полноэкранный SettingsScreen. Без хамбургера —
  /// логаут перенесён в Profile-таб, исключения — в Settings.
  PreferredSizeWidget _buildAppBar(BuildContext context) {
    return AppBar(
      backgroundColor: Colors.transparent,
      elevation: 0,
      centerTitle: true,
      title: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          // Мини-тигр + soft red glow слева от названия.
          Container(
            width: 28,
            height: 28,
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              boxShadow: [
                BoxShadow(
                  color: HundlerColors.accentRed.withValues(alpha: 0.35),
                  blurRadius: 14,
                  spreadRadius: 1,
                ),
              ],
            ),
            child: Image.asset(
              'assets/images/tiger.png',
              fit: BoxFit.contain,
              filterQuality: FilterQuality.medium,
            ),
          ),
          const SizedBox(width: 10),
          Text(
            'HUNDLER VPN',
            style: HundlerTypography.brandTitle(size: 18),
          ),
        ],
      ),
      actions: [
        IconButton(
          icon: const Icon(LucideIcons.settings, size: 20),
          tooltip: 'Настройки',
          onPressed: () => Navigator.of(context).pushNamed('/settings'),
        ),
        const SizedBox(width: 4),
      ],
    );
  }

  /// Адаптивный размер тигра. Стараемся чтобы суммарная высота
  /// `tigerSize * 1.6 + 28 + statusText` оставалась в комфортной зоне.
  double _tigerSize(Size screen) {
    if (screen.height < 680) return 140;
    if (screen.height < 800) return 170;
    if (screen.width < 360) return 170;
    return 200;
  }
}

/// Премиум-фон: тёмный base + два radial-glow по углам. При подключении
/// glow усиливается и слегка краснеет — даёт визуальную обратную связь.
class _PremiumBackground extends StatelessWidget {
  const _PremiumBackground({required this.status});
  final VpnConnectionStatus status;

  @override
  Widget build(BuildContext context) {
    final connected = status == VpnConnectionStatus.connected;
    return IgnorePointer(
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 800),
        curve: Curves.easeOutCubic,
        decoration: BoxDecoration(
          gradient: LinearGradient(
            begin: Alignment.topLeft,
            end: Alignment.bottomRight,
            colors: connected
                ? const [Color(0xFF0A0303), Color(0xFF020202)]
                : const [Color(0xFF050505), Color(0xFF020202)],
          ),
        ),
        child: Stack(
          children: [
            Positioned(
              top: -140,
              left: -100,
              child: Container(
                width: 360,
                height: 360,
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  gradient: RadialGradient(
                    colors: [
                      HundlerColors.accentRed.withValues(
                        alpha: connected ? 0.22 : 0.10,
                      ),
                      Colors.transparent,
                    ],
                  ),
                ),
              ),
            ),
            Positioned(
              bottom: -180,
              right: -120,
              child: Container(
                width: 420,
                height: 420,
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  gradient: RadialGradient(
                    colors: [
                      HundlerColors.accentOrange.withValues(
                        alpha: connected ? 0.10 : 0.06,
                      ),
                      Colors.transparent,
                    ],
                  ),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// Большой статусный текст под тигром. AnimatedSwitcher даёт мягкие
/// переходы между состояниями (cross-fade + slight slide).
class _StatusText extends StatelessWidget {
  const _StatusText({required this.status});
  final VpnConnectionStatus status;

  @override
  Widget build(BuildContext context) {
    final (label, hint, color) = _labelFor(status);
    return AnimatedSwitcher(
      duration: const Duration(milliseconds: 320),
      switchInCurve: Curves.easeOutCubic,
      transitionBuilder: (child, anim) => FadeTransition(
        opacity: anim,
        child: SlideTransition(
          position: Tween<Offset>(
            begin: const Offset(0, 0.15),
            end: Offset.zero,
          ).animate(anim),
          child: child,
        ),
      ),
      child: Column(
        key: ValueKey(label),
        children: [
          // Status badge использует Space Grotesk из HundlerTypography —
          // брендовый display шрифт вместо старого обычного жирного
          // sans-serif с фиксированным letterSpacing.
          Text(
            label,
            style: HundlerTypography.statusBadge(size: 26, color: color),
          ),
          const SizedBox(height: 8),
          Text(
            hint,
            style: const TextStyle(
              fontSize: 13,
              color: HundlerColors.textSecondary,
              letterSpacing: 0.3,
            ),
          ),
        ],
      ),
    );
  }

  static (String, String, Color) _labelFor(VpnConnectionStatus s) {
    switch (s) {
      case VpnConnectionStatus.disconnected:
        return ('ОТКЛЮЧЕНО', 'Нажмите на тигра, чтобы подключиться', HundlerColors.textPrimary);
      case VpnConnectionStatus.connecting:
        return ('ПОДКЛЮЧАЕМСЯ', 'Устанавливаем защищённый туннель', HundlerColors.accentOrange);
      case VpnConnectionStatus.disconnecting:
        return ('ОТКЛЮЧАЕМСЯ', 'Закрываем туннель', HundlerColors.accentOrange);
      case VpnConnectionStatus.connected:
        return ('ЗАЩИЩЕНО', 'Нажмите на тигра, чтобы отключиться', HundlerColors.success);
      case VpnConnectionStatus.error:
        return ('ОШИБКА', 'Попробуйте подключиться ещё раз', HundlerColors.danger);
    }
  }
}

/// Server-chip внизу. Тянет текущий сервер из [selectedServerProvider],
/// сам отображает loading / empty state. Кликабельный — открывает sheet.
class _ServerChip extends ConsumerWidget {
  const _ServerChip({
    required this.status,
    required this.onTap,
  });

  final VpnConnectionStatus status;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = Theme.of(context);
    final connected = status == VpnConnectionStatus.connected;
    final selected = ref.watch(selectedServerProvider);
    final serversAsync = ref.watch(serversProvider);

    final (flag, title, subtitle, isLoading) = switch ((selected, serversAsync)) {
      (final s?, _) => (
          s.flag,
          _countryName(s.country),
          // Subtitle = server.name from DB. Но если name == страна ("Россия /
          // Россия" / "Германия / Германия") — прячем subtitle, иначе выглядит
          // дублирующе и ломает иерархию. Для NL это "Обход Глушилок", для RU —
          // "YouTube". IP / port намеренно НЕ рендерим — утечка endpoint'ов
          // даёт анти-VPN сканерам бесплатный target list.
          (s.name.toLowerCase() == _countryName(s.country).toLowerCase())
              ? ''
              : s.name,
          false,
        ),
      (null, AsyncLoading()) => ('🌐', 'Загружаем серверы…', '', true),
      (null, AsyncError()) => ('⚠️', 'Не удалось загрузить', 'Тапните чтобы повторить', false),
      _ => ('🌐', 'Выбрать сервер', 'Список локаций', false),
    };

    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(HundlerRadius.md),
        child: Ink(
          decoration: BoxDecoration(
            color: HundlerColors.bgSurface,
            borderRadius: BorderRadius.circular(HundlerRadius.md),
            border: Border.all(
              color: connected
                  ? HundlerColors.accentRed.withValues(alpha: 0.4)
                  : HundlerColors.borderSubtle,
            ),
          ),
          padding: const EdgeInsets.symmetric(
            horizontal: HundlerSpacing.md,
            vertical: HundlerSpacing.sm + 2,
          ),
          child: Row(
            children: [
              if (isLoading)
                const SizedBox(
                  width: 22,
                  height: 22,
                  child: CircularProgressIndicator(
                    strokeWidth: 2,
                    color: HundlerColors.accentRed,
                  ),
                )
              else
                Text(flag, style: const TextStyle(fontSize: 22)),
              const SizedBox(width: HundlerSpacing.sm),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      title,
                      style: theme.textTheme.titleMedium?.copyWith(
                        fontWeight: FontWeight.w600,
                      ),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                    if (subtitle.isNotEmpty)
                      Text(
                        subtitle,
                        style: theme.textTheme.bodySmall?.copyWith(
                          color: HundlerColors.textSecondary,
                          fontSize: 11,
                          letterSpacing: 0.5,
                        ),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                      ),
                  ],
                ),
              ),
              const Icon(
                LucideIcons.chevronsUpDown,
                color: HundlerColors.textSecondary,
                size: 18,
              ),
            ],
          ),
        ),
      ),
    );
  }
}

String _countryName(String iso) {
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

// _TrafficStats / _StatItem убраны 2026-05-12 — юзер сказал "это
// убери". KB-счётчики выглядели дешёво и всё равно жёстко
// захардкожены на '0 KB' (real-time stats бы требовали push'а
// из sing-box CommandClient'a). Если потом захотим вернуть —
// сделаем явный stat-card с реальным фидом от нативки.
