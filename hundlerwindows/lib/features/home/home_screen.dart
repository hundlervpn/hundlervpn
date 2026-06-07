import 'dart:async';
import 'dart:io';

import 'package:country_flags/country_flags.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';
import 'package:url_launcher/url_launcher.dart';
import 'package:window_manager/window_manager.dart';

import '../../core/api_client.dart';
import '../../core/colors.dart';
import '../../core/typography.dart';
import '../../services/update_checker.dart';
import '../../services/update_installer.dart';
import '../../services/vpn_service.dart';
import '../auth/auth_controller.dart';
import '../servers/servers_controller.dart';
import '../servers/servers_screen.dart';
import '../update/update_controller.dart';
import '../vpn/vpn_controller.dart';
import '../vpn/vpn_mode_controller.dart';
import '../vpn/vpn_protocol_controller.dart';
import 'widgets/connect_tiger.dart';
import 'widgets/particles_background.dart';

/// Главный экран — премиум-вид с тигром как Connect-кнопкой.
///
/// Слушает:
///   - `vpnStatusProvider` `StreamProvider<VpnStatus>` — текущий статус
///     туннеля (sing-box процесс).
///   - `vpnControllerProvider` (busy / lastError) — UI-state кнопки.
///   - `authControllerProvider` — для daysLeft / userInfo плашек.
///   - `selectedServerProvider` — текущая выбранная локация.
///
/// Делает:
///   - Тап по тигру → Connect/Disconnect через
///     `vpnControllerProvider.notifier.toggle()`.
///   - Server chip ниже тигра → `ServersScreen` через `Navigator.push`.
///   - Проверяет наличие sing-box.exe / wintun.dll, плашка с инструкцией
///     если их нет.
///   - Проверяет права admin (для wintun TUN-режима), плашка
///     «Перезапустить от имени админа» если не elevated.
class HomeScreen extends ConsumerStatefulWidget {
  const HomeScreen({super.key});

  @override
  ConsumerState<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends ConsumerState<HomeScreen> {
  bool _checkingBinaries = true;
  bool _hasBinaries = false;
  String _binDirPath = '';
  // Примечание: admin/UAC больше НЕ чекается в UI — elevation
  // гарантирована через `requireAdministrator` в
  // `windows/runner/runner.exe.manifest`. Windows покажет UAC-prompt
  // при старте exe, юзер кликнет Yes один раз, и процесс уже
  // elevated — плашка «Перезапустить от админа» больше не нужна.

  /// Авто-recheck бинарей пока их нет. Юзер кладёт sing-box.exe + wintun.dll
  /// в плашке-указанную папку, и в течение ≤2 сек UI сам подхватит факт
  /// появления файлов и плашка исчезнет. Останавливается как только
  /// `_hasBinaries == true` — больше recheck не нужен.
  Timer? _binPollTimer;

  @override
  void initState() {
    super.initState();
    _checkBinaries();
  }

  @override
  void dispose() {
    _binPollTimer?.cancel();
    super.dispose();
  }

  Future<void> _checkBinaries() async {
    final svc = VpnService.instance;
    final has = await svc.hasBinaries();
    final path = await svc.binDirPath();
    if (!mounted) return;
    setState(() {
      _hasBinaries = has;
      _binDirPath = path;
      _checkingBinaries = false;
    });
    // Если бинарей всё ещё нет — запустим периодический recheck.
    // Если уже есть — таймер не нужен / останавливаем существующий.
    if (!has) {
      _binPollTimer ??= Timer.periodic(
        const Duration(seconds: 2),
        (_) => _checkBinaries(),
      );
    } else {
      _binPollTimer?.cancel();
      _binPollTimer = null;
    }
  }

  Future<void> _openServers() async {
    await Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) => const ServersScreen(),
        fullscreenDialog: true,
      ),
    );
  }

  void _onLogout() async {
    await ref.read(vpnControllerProvider.notifier).disconnect();
    await ref.read(authControllerProvider.notifier).signOut();
  }

  @override
  Widget build(BuildContext context) {
    final auth = ref.watch(authControllerProvider);
    final selected = ref.watch(selectedServerProvider);
    final protocol = ref.watch(vpnProtocolProvider);
    final vpnStatusAsync = ref.watch(vpnStatusProvider);
    final vpnState = ref.watch(vpnControllerProvider);

    final status = vpnStatusAsync.value ?? VpnStatus.disconnected;
    final connecting = status == VpnStatus.connecting || vpnState.busy;
    final connected = status == VpnStatus.connected;
    final hasError = status == VpnStatus.error || vpnState.lastError != null;

    final daysLeft = auth is AuthSignedIn ? auth.state?.daysLeft ?? 0 : 0;
    final userName =
        auth is AuthSignedIn ? auth.session.displayName : 'Hundler User';

    final canConnect = !connecting && _hasBinaries;

    return Scaffold(
      backgroundColor: HundlerColors.bgPrimary,
      body: Stack(
        children: [
          // ⭐ Анимированный фон с сеткой и бегающими «локаторами».
          // 1-в-1 порт ParticlesBackground.tsx из мини-аппа.
          // pointer-events игнорируются (IgnorePointer), чтобы клики
          // проходили насквозь к контенту выше.
          //
          // Раньше тут были ещё 3 круглых blur-blob (red/red/orange),
          // как в `app/page.tsx:1181-1183` мини-аппа. Но из-за того что
          // окно Windows маленькое (420×720, не fullscreen как mobile),
          // эти blob'ы видны как отдельные красные круги — некрасиво.
          // Оставил только сетку с локаторами.
          const Positioned.fill(
            child: IgnorePointer(child: ParticlesBackground()),
          ),
          // Основной контент.
          SafeArea(
            child: Column(
              children: [
            // Custom title bar — окно frameless.
            _TitleBar(
              userName: userName,
              daysLeft: daysLeft,
              onLogout: _onLogout,
            ),

            Expanded(
              child: SingleChildScrollView(
                padding: const EdgeInsets.symmetric(
                  horizontal: HundlerSpacing.xl,
                  vertical: HundlerSpacing.lg,
                ),
                child: Center(
                  child: ConstrainedBox(
                    constraints: const BoxConstraints(maxWidth: 460),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        const SizedBox(height: HundlerSpacing.md),

                        // Banner об обновлении — виден только если
                        // /api/clients/windows/latest.json вернул
                        // более свежую версию чем package_info.
                        const _UpdateBanner(),

                        // Brand wordmark наверху, мелко.
                        Center(
                          child: Text(
                            'HUNDLER VPN',
                            style: HundlerTypography.brandTitle(size: 18)
                                .copyWith(letterSpacing: 4),
                          ),
                        ),
                        const SizedBox(height: HundlerSpacing.xl),

                        // ⭐ Главный элемент — тигр-кнопка.
                        Center(
                          child: ConnectTiger(
                            connecting: connecting,
                            connected: connected,
                            hasError: hasError,
                            onTap: canConnect
                                ? () => ref
                                    .read(vpnControllerProvider.notifier)
                                    .toggle()
                                : null,
                          ),
                        ),
                        const SizedBox(height: HundlerSpacing.xl),

                        // Server chip — кликабельный, открывает ServersScreen.
                        // Внутри ServersScreen теперь живёт переключатель
                        // VLESS / Hysteria — это объединяет выбор «куда»
                        // и «чем» в одном экране (юзер сначала решает
                        // протокол, потом видит только подходящие локации).
                        _ServerCard(
                          server: selected,
                          protocol: protocol,
                          onTap: _openServers,
                          dimmed: connecting,
                        ),

                        // Errors / warnings.
                        if (vpnState.lastError != null) ...[
                          const SizedBox(height: HundlerSpacing.md),
                          _ErrorCard(message: vpnState.lastError!),
                        ],
                        if (status == VpnStatus.error &&
                            VpnService.instance.lastError != null &&
                            vpnState.lastError == null) ...[
                          const SizedBox(height: HundlerSpacing.md),
                          _ErrorCard(
                              message: VpnService.instance.lastError!),
                        ],
                        if (!_checkingBinaries && !_hasBinaries) ...[
                          const SizedBox(height: HundlerSpacing.md),
                          _BinariesMissingCard(
                            binDir: _binDirPath,
                            onRecheck: _checkBinaries,
                          ),
                        ],
                        if (auth is AuthSignedIn &&
                            auth.state?.subToken == null) ...[
                          const SizedBox(height: HundlerSpacing.md),
                          const _NoSubscriptionCard(),
                        ],
                        if (auth is AuthSignedIn &&
                            auth.state?.daysLeft != null &&
                            auth.state!.daysLeft > 0) ...[
                          const SizedBox(height: HundlerSpacing.md),
                          _SubscriptionCard(
                            daysLeft: auth.state!.daysLeft,
                            status: auth.state!.status,
                          ),
                        ],

                        // Красивая CTA «Продлить подписку» — открывает
                        // hundlervpn.xyz в браузере. Показывается всегда
                        // (даже без подписки — там будет кнопка «купить»).
                        const SizedBox(height: HundlerSpacing.md),
                        const _RenewButton(),

                        // Tun / Proxy — компактный segment control в низу
                        // экрана. Продвинутая опция — юзер обычно оставляет
                        // на Tun, поэтому вынесено из первого экрана в hidden-bottom
                        // (2026-05-15). Дизабляется пока VPN подключён.
                        const SizedBox(height: HundlerSpacing.md),
                        _VpnModeSwitch(enabled: !connecting && !connected),

                        const SizedBox(height: HundlerSpacing.lg),
                      ],
                    ),
                  ),
                ),
              ),
            ),
              ], // Column.children
            ), // Column
          ), // SafeArea
        ], // Stack.children
      ), // Stack body
    );
  }
}

/// Кастомный title-bar для frameless окна.
///
/// Окно создаётся с `titleBarStyle: hidden` (см. `main.dart`), поэтому
/// у него нет стандартных кнопок свернуть/закрыть и нет drag-зоны.
/// Эту полоску мы оборачиваем в [DragToMoveArea] от `window_manager` —
/// весь её фон становится draggable как нативный title bar Windows.
class _TitleBar extends StatelessWidget {
  const _TitleBar({
    required this.userName,
    required this.daysLeft,
    required this.onLogout,
  });
  final String userName;
  final int daysLeft;
  final VoidCallback onLogout;

  @override
  Widget build(BuildContext context) {
    return DragToMoveArea(
      child: Container(
        height: 44,
        padding: const EdgeInsets.only(
          left: HundlerSpacing.md,
          right: 0,
        ),
        decoration: const BoxDecoration(
          border: Border(
            bottom: BorderSide(color: HundlerColors.borderSubtle),
          ),
        ),
        child: Row(
          children: [
            Expanded(
              child: Text(
                userName,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: Theme.of(context).textTheme.bodySmall?.copyWith(
                      fontWeight: FontWeight.w600,
                      color: HundlerColors.textPrimary,
                    ),
              ),
            ),
            if (daysLeft > 0) ...[
              const Icon(
                LucideIcons.clock,
                size: 12,
                color: HundlerColors.textSecondary,
              ),
              const SizedBox(width: 4),
              Text(
                '$daysLeft дн.',
                style: const TextStyle(
                  fontSize: 11,
                  color: HundlerColors.textSecondary,
                  fontWeight: FontWeight.w600,
                ),
              ),
              const SizedBox(width: HundlerSpacing.xs),
            ],
            IconButton(
              tooltip: 'Выйти из аккаунта',
              icon: const Icon(LucideIcons.logOut, size: 16),
              onPressed: onLogout,
            ),
            // Стандартные window controls. Каждая кнопка обёрнута в
            // GestureDetector чтобы блокировать drag-событие
            // DragToMoveArea — иначе клик ловится parent'ом.
            _WindowButton(
              tooltip: 'Свернуть',
              icon: LucideIcons.minus,
              onTap: () => windowManager.minimize(),
            ),
            _WindowButton(
              tooltip: 'Закрыть',
              icon: LucideIcons.x,
              hoverColor: HundlerColors.danger,
              onTap: () => windowManager.close(),
            ),
          ],
        ),
      ),
    );
  }
}

/// Минималистичная кнопка title-bar (свернуть / закрыть) в стиле
/// Win11. `GestureDetector` ловит pointer-down ДО того как `DragToMoveArea`
/// успеет начать drag — иначе на каждый клик окно дёргалось бы.
class _WindowButton extends StatefulWidget {
  const _WindowButton({
    required this.tooltip,
    required this.icon,
    required this.onTap,
    this.hoverColor,
  });
  final String tooltip;
  final IconData icon;
  final VoidCallback onTap;
  final Color? hoverColor;

  @override
  State<_WindowButton> createState() => _WindowButtonState();
}

class _WindowButtonState extends State<_WindowButton> {
  bool _hover = false;

  @override
  Widget build(BuildContext context) {
    final bg = _hover
        ? (widget.hoverColor ?? HundlerColors.bgElevated)
        : Colors.transparent;
    return MouseRegion(
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
            color: bg,
            child: Icon(
              widget.icon,
              size: 14,
              color: HundlerColors.textPrimary,
            ),
          ),
        ),
      ),
    );
  }
}

/// Карточка-чип "Локация" под тигром.
///
/// Стиль премиум: широкая карточка с круглой плашкой страны слева,
/// крупный заголовок (название страны или server.name), subtitle с
/// расширенной инфой (название тарифа / технология). Hover увеличивает
/// border opacity.
class _ServerCard extends StatefulWidget {
  const _ServerCard({
    required this.server,
    required this.protocol,
    required this.onTap,
    this.dimmed = false,
  });
  final HundlerServer? server;
  final VpnProtocol protocol;
  final VoidCallback onTap;
  final bool dimmed;

  @override
  State<_ServerCard> createState() => _ServerCardState();
}

class _ServerCardState extends State<_ServerCard> {
  bool _hover = false;

  @override
  Widget build(BuildContext context) {
    final s = widget.server;
    final iso = s?.country ?? '';
    final country = _localCountry(iso);
    final title = s == null ? 'Авто-выбор сервера' : country;
    // overline = "Локация · VLESS" / "Локация · Hysteria". Покажем юзеру
    // активный протокол прямо на главной — переключить можно тапнув по
    // карточке, внутри `ServersScreen` есть segment control.
    final overline = 'Локация · ${widget.protocol.displayName}';
    final subtitle =
        s == null ? 'Быстрейший доступный' : (s.name.isEmpty ? 'VLESS · Reality · uTLS' : s.name);

    return Opacity(
      opacity: widget.dimmed ? 0.55 : 1.0,
      child: MouseRegion(
        cursor: SystemMouseCursors.click,
        onEnter: (_) => setState(() => _hover = true),
        onExit: (_) => setState(() => _hover = false),
        child: GestureDetector(
          behavior: HitTestBehavior.opaque,
          onTap: widget.dimmed ? null : widget.onTap,
          child: AnimatedContainer(
            duration: const Duration(milliseconds: 160),
            padding: const EdgeInsets.symmetric(
              horizontal: HundlerSpacing.md,
              vertical: HundlerSpacing.md,
            ),
            decoration: BoxDecoration(
              gradient: LinearGradient(
                colors: [
                  HundlerColors.bgSurface,
                  _hover
                      ? HundlerColors.bgElevated
                      : HundlerColors.bgSurface,
                ],
                begin: Alignment.topLeft,
                end: Alignment.bottomRight,
              ),
              borderRadius: BorderRadius.circular(HundlerRadius.md),
              border: Border.all(
                color: _hover
                    ? HundlerColors.accentRed.withValues(alpha: 0.5)
                    : HundlerColors.borderSubtle,
              ),
              boxShadow: _hover
                  ? [
                      BoxShadow(
                        color: HundlerColors.accentRed.withValues(alpha: 0.18),
                        blurRadius: 18,
                        spreadRadius: 0,
                      ),
                    ]
                  : null,
            ),
            child: Row(
              children: [
                _CountryBadge(iso: iso),
                const SizedBox(width: HundlerSpacing.md),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        overline,
                        style:
                            Theme.of(context).textTheme.bodySmall?.copyWith(
                                  color: HundlerColors.textSecondary,
                                  fontSize: 10,
                                  letterSpacing: 1.2,
                                ),
                      ),
                      const SizedBox(height: 2),
                      Text(
                        title,
                        style: Theme.of(context)
                            .textTheme
                            .titleMedium
                            ?.copyWith(fontWeight: FontWeight.w700),
                      ),
                      Text(
                        subtitle,
                        style: Theme.of(context)
                            .textTheme
                            .bodySmall
                            ?.copyWith(
                              color: HundlerColors.textSecondary,
                              fontSize: 11,
                            ),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                      ),
                    ],
                  ),
                ),
                AnimatedRotation(
                  turns: _hover ? 0.05 : 0.0,
                  duration: const Duration(milliseconds: 160),
                  child: const Icon(
                    LucideIcons.chevronRight,
                    size: 18,
                    color: HundlerColors.textSecondary,
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// Круглая «плашка страны» — SVG-флаг страны через `country_flags`.
///
/// На Windows Segoe UI Emoji **не** рендерит regional-indicator pairs
/// как национальные флаги (политическое решение Microsoft), поэтому
/// используем SVG-набор. Файлы флагов идут вместе с пакетом, lazy-load
/// по ISO-2 коду.
///
/// Если `iso` пустой / неизвестный — показываем placeholder с
/// двухбуквенным fallback в стилизованном круге.
class _CountryBadge extends StatelessWidget {
  const _CountryBadge({required this.iso});
  final String iso;

  @override
  Widget build(BuildContext context) {
    const size = 44.0;
    if (iso.length != 2) {
      return _placeholder(size, '??');
    }
    return Container(
      width: size,
      height: size,
      decoration: BoxDecoration(
        shape: BoxShape.circle,
        border: Border.all(
          color: HundlerColors.accentRed.withValues(alpha: 0.35),
          width: 1.2,
        ),
        boxShadow: [
          BoxShadow(
            color: HundlerColors.accentRed.withValues(alpha: 0.18),
            blurRadius: 12,
            spreadRadius: 1,
          ),
        ],
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

  Widget _placeholder(double size, String text) {
    return Container(
      width: size,
      height: size,
      alignment: Alignment.center,
      decoration: BoxDecoration(
        shape: BoxShape.circle,
        color: HundlerColors.bgElevated,
        border: Border.all(
          color: HundlerColors.borderSubtle,
        ),
      ),
      child: Text(
        text,
        style: const TextStyle(
          fontWeight: FontWeight.w800,
          fontSize: 12,
          color: HundlerColors.textSecondary,
        ),
      ),
    );
  }
}

class _ErrorCard extends StatelessWidget {
  const _ErrorCard({required this.message});
  final String message;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(HundlerSpacing.md),
      decoration: BoxDecoration(
        color: const Color(0x33EF4444),
        borderRadius: BorderRadius.circular(HundlerRadius.sm),
        border: Border.all(
            color: HundlerColors.accentRed.withValues(alpha: 0.4)),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Icon(LucideIcons.triangleAlert,
              size: 18, color: HundlerColors.accentRed),
          const SizedBox(width: HundlerSpacing.sm),
          Expanded(
            child: Text(
              message,
              style: const TextStyle(
                  color: HundlerColors.textPrimary,
                  fontSize: 12,
                  height: 1.4),
            ),
          ),
        ],
      ),
    );
  }
}

class _BinariesMissingCard extends StatelessWidget {
  const _BinariesMissingCard({
    required this.binDir,
    required this.onRecheck,
  });
  final String binDir;

  /// Вызывается при нажатии «Проверить» — родитель пересчитывает
  /// `hasBinaries`. Помимо этого карточка пропадает автоматически
  /// через `_binPollTimer` каждые 2 сек, но кнопка даёт юзеру явный
  /// контроль («положил файлы — сразу хочу увидеть результат»).
  final VoidCallback onRecheck;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(HundlerSpacing.md),
      decoration: BoxDecoration(
        color: const Color(0x33F97316),
        borderRadius: BorderRadius.circular(HundlerRadius.sm),
        border: Border.all(
            color: HundlerColors.accentOrange.withValues(alpha: 0.4)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const Icon(LucideIcons.download,
                  size: 18, color: HundlerColors.accentOrange),
              const SizedBox(width: HundlerSpacing.sm),
              Expanded(
                child: Text(
                  'VPN-движок не установлен',
                  style: Theme.of(context).textTheme.titleMedium,
                ),
              ),
            ],
          ),
          const SizedBox(height: HundlerSpacing.xs),
          Text(
            'Скачайте sing-box.exe (release for windows-amd64) с '
            'github.com/SagerNet/sing-box/releases и wintun.dll '
            '(amd64) с wintun.net, и положите оба файла в папку:',
            style:
                Theme.of(context).textTheme.bodySmall?.copyWith(height: 1.4),
          ),
          const SizedBox(height: HundlerSpacing.xs),
          Container(
            width: double.infinity,
            padding: const EdgeInsets.all(HundlerSpacing.xs),
            decoration: BoxDecoration(
              color: HundlerColors.bgPrimary,
              borderRadius: BorderRadius.circular(HundlerRadius.xs),
            ),
            child: SelectableText(
              binDir,
              style: const TextStyle(
                fontFamily: 'Consolas',
                fontSize: 11,
                color: HundlerColors.textPrimary,
              ),
            ),
          ),
          const SizedBox(height: HundlerSpacing.xs),
          Row(
            children: [
              Expanded(
                child: OutlinedButton.icon(
                  icon: const Icon(LucideIcons.folderOpen, size: 14),
                  label: const Text('Открыть папку'),
                  onPressed: () => _openFolder(binDir),
                ),
              ),
              const SizedBox(width: HundlerSpacing.xs),
              Expanded(
                child: OutlinedButton.icon(
                  icon: const Icon(LucideIcons.externalLink, size: 14),
                  label: const Text('GitHub'),
                  onPressed: () => launchUrl(
                    Uri.parse(
                        'https://github.com/SagerNet/sing-box/releases'),
                    mode: LaunchMode.externalApplication,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: HundlerSpacing.xs),
          SizedBox(
            width: double.infinity,
            child: FilledButton.icon(
              icon: const Icon(LucideIcons.refreshCw, size: 14),
              label: const Text('Проверить'),
              style: FilledButton.styleFrom(
                backgroundColor: HundlerColors.accentOrange,
                foregroundColor: HundlerColors.bgPrimary,
              ),
              onPressed: onRecheck,
            ),
          ),
        ],
      ),
    );
  }

  void _openFolder(String path) {
    Process.run('explorer.exe', [path], runInShell: false);
  }
}

class _NoSubscriptionCard extends StatelessWidget {
  const _NoSubscriptionCard();

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(HundlerSpacing.md),
      decoration: BoxDecoration(
        color: HundlerColors.bgSurface,
        borderRadius: BorderRadius.circular(HundlerRadius.md),
        border: Border.all(color: HundlerColors.borderSubtle),
      ),
      child: Row(
        children: [
          const Icon(LucideIcons.info,
              size: 18, color: HundlerColors.textSecondary),
          const SizedBox(width: HundlerSpacing.sm),
          Expanded(
            child: Text(
              'У вас нет активной подписки. Активируйте триал в '
              'мини-аппе hundlervpn.xyz.',
              style: Theme.of(context)
                  .textTheme
                  .bodySmall
                  ?.copyWith(color: HundlerColors.textSecondary),
            ),
          ),
          TextButton(
            onPressed: () => launchUrl(
              Uri.parse('https://hundlervpn.xyz'),
              mode: LaunchMode.externalApplication,
            ),
            child: const Text('Открыть'),
          ),
        ],
      ),
    );
  }
}

/// Плашка статуса подписки. Минималистичный вид: иконка-щит,
/// "Подписка активна" + дата окончания, дни справа.
///
/// Состояние выражается ТОЛЬКО цветом (зелёный / оранжевый / красный),
/// без капс-заголовков и брендовых эффектов.
class _SubscriptionCard extends StatelessWidget {
  const _SubscriptionCard({
    required this.daysLeft,
    required this.status,
  });

  final int daysLeft;
  final String status;

  /// Цвет для текущего состояния (active / warning / expired).
  Color get _accent {
    if (daysLeft <= 0) return HundlerColors.danger;
    if (daysLeft <= 7) return HundlerColors.accentOrange;
    return HundlerColors.success;
  }

  String get _title {
    if (daysLeft <= 0) return 'Подписка истекла';
    return 'Подписка активна';
  }

  String get _subtitle {
    if (daysLeft <= 0) return 'продлите доступ к VPN';
    final expiry = DateTime.now().add(Duration(days: daysLeft));
    return 'до ${_formatDate(expiry)}';
  }

  IconData get _icon {
    if (daysLeft <= 0) return LucideIcons.shieldOff;
    return LucideIcons.shieldCheck;
  }

  static String _formatDate(DateTime d) {
    const months = [
      'янв', 'фев', 'мар', 'апр', 'мая', 'июн',
      'июл', 'авг', 'сен', 'окт', 'ноя', 'дек',
    ];
    return '${d.day} ${months[d.month - 1]} ${d.year}';
  }

  String get _daysWord {
    final n = daysLeft.abs() % 100;
    final n1 = n % 10;
    if (n > 10 && n < 20) return 'дней';
    if (n1 > 1 && n1 < 5) return 'дня';
    if (n1 == 1) return 'день';
    return 'дней';
  }

  @override
  Widget build(BuildContext context) {
    final accent = _accent;
    return Container(
      padding: const EdgeInsets.symmetric(
        horizontal: HundlerSpacing.md,
        vertical: 14,
      ),
      decoration: BoxDecoration(
        color: HundlerColors.bgSurface,
        borderRadius: BorderRadius.circular(HundlerRadius.md),
        border: Border.all(color: HundlerColors.borderSubtle),
      ),
      child: Row(
        children: [
          Icon(_icon, size: 18, color: accent),
          const SizedBox(width: HundlerSpacing.sm + 2),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(
                  _title,
                  style: const TextStyle(
                    fontSize: 14,
                    fontWeight: FontWeight.w600,
                    color: HundlerColors.textPrimary,
                    height: 1.2,
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  _subtitle,
                  style: const TextStyle(
                    fontSize: 12,
                    fontWeight: FontWeight.w400,
                    color: HundlerColors.textSecondary,
                    height: 1.2,
                  ),
                ),
              ],
            ),
          ),
          if (daysLeft > 0) ...[
            const SizedBox(width: HundlerSpacing.sm),
            Text(
              '$daysLeft $_daysWord',
              style: TextStyle(
                fontSize: 13,
                fontWeight: FontWeight.w600,
                color: accent,
              ),
            ),
          ],
        ],
      ),
    );
  }
}

/// Красивая CTA-кнопка «Продлить подписку».
///
/// Полноширинная, красно-оранжевый градиент в брендовом стиле
/// (см. бренд-токены в AGENTS.md). Hover поднимает свечение, press —
/// scale 0.98. Tap открывает `https://hundlervpn.xyz` в браузере —
/// там юзер увидит свой профиль и кнопки оплаты.
class _RenewButton extends StatefulWidget {
  const _RenewButton();

  @override
  State<_RenewButton> createState() => _RenewButtonState();
}

class _RenewButtonState extends State<_RenewButton> {
  bool _hover = false;
  bool _pressed = false;

  @override
  Widget build(BuildContext context) {
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
        onTap: () => launchUrl(
          Uri.parse('https://hundlervpn.xyz'),
          mode: LaunchMode.externalApplication,
        ),
        child: AnimatedScale(
          duration: const Duration(milliseconds: 120),
          scale: _pressed ? 0.98 : 1.0,
          child: AnimatedContainer(
            duration: const Duration(milliseconds: 200),
            padding: const EdgeInsets.symmetric(
              horizontal: HundlerSpacing.md,
              vertical: 14,
            ),
            decoration: BoxDecoration(
              gradient: const LinearGradient(
                colors: [
                  HundlerColors.accentRed,
                  HundlerColors.accentOrange,
                ],
                begin: Alignment.centerLeft,
                end: Alignment.centerRight,
              ),
              borderRadius: BorderRadius.circular(HundlerRadius.md),
              boxShadow: [
                BoxShadow(
                  color: HundlerColors.accentRed
                      .withValues(alpha: _hover ? 0.55 : 0.30),
                  blurRadius: _hover ? 24 : 16,
                  spreadRadius: 0,
                ),
              ],
            ),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                const Icon(
                  LucideIcons.rocket,
                  size: 16,
                  color: Colors.white,
                ),
                const SizedBox(width: HundlerSpacing.sm),
                const Text(
                  'Продлить подписку',
                  style: TextStyle(
                    fontSize: 14,
                    fontWeight: FontWeight.w800,
                    color: Colors.white,
                    letterSpacing: 0.3,
                  ),
                ),
                const SizedBox(width: HundlerSpacing.xs),
                Icon(
                  LucideIcons.externalLink,
                  size: 13,
                  color: Colors.white.withValues(alpha: 0.85),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// Баннер «Доступна новая версия» с in-app кнопкой "Обновить".
///
/// Жизненный цикл:
///   1. `updateInfoProvider` асинхронно дёргает /api/clients/windows/latest.json.
///   2. Если есть новая версия — рендерим компактную карточку с кнопкой.
///   3. Тап "Обновить" → [UpdateInstaller.downloadAndInstall]:
///      - показываем прогресс-бар
///      - скачиваем installer.exe в %TEMP%
///      - проверяем SHA256
///      - запускаем installer с /SILENT /CLOSEAPPLICATIONS
///      - hundler.exe выходит, installer обновляет файлы и запускает
///        обратно из новой папки.
///
/// Если `mandatory: true` — баннер красный (TODO: заблокировать кнопку
/// Connect через флаг в `vpnControllerProvider`).
class _UpdateBanner extends ConsumerStatefulWidget {
  const _UpdateBanner();

  @override
  ConsumerState<_UpdateBanner> createState() => _UpdateBannerState();
}

class _UpdateBannerState extends ConsumerState<_UpdateBanner> {
  /// `null` — кнопка готова к тапу. `0.0..1.0` — идёт скачивание.
  /// После 1.0 запустится installer и hundler.exe выйдет.
  double? _progress;
  String? _error;

  Future<void> _onUpdate(UpdateInfo info) async {
    setState(() {
      _progress = 0.0;
      _error = null;
    });
    final result = await UpdateInstaller.instance.downloadAndInstall(
      info,
      onProgress: (p) {
        if (!mounted) return;
        setState(() => _progress = p);
      },
    );
    // Сюда мы попадём ТОЛЬКО если installer не запустился. На успешном
    // запуске exit(0) уже выстрелил.
    if (!mounted) return;
    setState(() {
      _progress = null;
      _error = result.userMessage;
    });
  }

  @override
  Widget build(BuildContext context) {
    final updateAsync = ref.watch(updateInfoProvider);
    final info = updateAsync.valueOrNull;
    if (info == null) return const SizedBox.shrink();

    final accent = info.mandatory
        ? HundlerColors.danger
        : HundlerColors.accentOrange;
    final isDownloading = _progress != null;

    return Padding(
      padding: const EdgeInsets.only(bottom: HundlerSpacing.md),
      child: Container(
        padding: const EdgeInsets.symmetric(
          horizontal: HundlerSpacing.md,
          vertical: 12,
        ),
        decoration: BoxDecoration(
          color: accent.withValues(alpha: 0.10),
          borderRadius: BorderRadius.circular(HundlerRadius.md),
          border: Border.all(
            color: accent.withValues(alpha: 0.45),
          ),
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              children: [
                Icon(LucideIcons.download, size: 18, color: accent),
                const SizedBox(width: HundlerSpacing.sm + 2),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Text(
                        info.mandatory
                            ? 'Обязательное обновление ${info.latestVersion}'
                            : 'Доступна версия ${info.latestVersion}',
                        style: const TextStyle(
                          fontSize: 13,
                          fontWeight: FontWeight.w700,
                          color: HundlerColors.textPrimary,
                          height: 1.2,
                        ),
                      ),
                      if (info.releaseNotes.isNotEmpty) ...[
                        const SizedBox(height: 2),
                        Text(
                          info.releaseNotes,
                          maxLines: 2,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(
                            fontSize: 11,
                            color: HundlerColors.textSecondary,
                            height: 1.3,
                          ),
                        ),
                      ],
                    ],
                  ),
                ),
                const SizedBox(width: HundlerSpacing.sm),
                _UpdateButton(
                  accent: accent,
                  progress: _progress,
                  onPressed: isDownloading ? null : () => _onUpdate(info),
                ),
              ],
            ),
            if (isDownloading) ...[
              const SizedBox(height: 10),
              ClipRRect(
                borderRadius: BorderRadius.circular(2),
                child: LinearProgressIndicator(
                  value: _progress,
                  minHeight: 3,
                  backgroundColor: accent.withValues(alpha: 0.15),
                  valueColor: AlwaysStoppedAnimation(accent),
                ),
              ),
              const SizedBox(height: 4),
              Text(
                _progress! < 1.0
                    ? 'Скачивание ${(_progress! * 100).toStringAsFixed(0)}%'
                    : 'Запуск установщика…',
                style: const TextStyle(
                  fontSize: 10,
                  color: HundlerColors.textSecondary,
                  height: 1.2,
                ),
              ),
            ],
            if (_error != null) ...[
              const SizedBox(height: 8),
              Text(
                _error!,
                style: const TextStyle(
                  fontSize: 11,
                  color: HundlerColors.danger,
                  height: 1.3,
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

/// Маленькая «pill»-кнопка справа от текста баннера. Когда идёт
/// скачивание (`progress != null`) — кнопка disabled и выглядит
/// прозрачнее, основное внимание уходит на прогресс-бар ниже.
class _UpdateButton extends StatelessWidget {
  const _UpdateButton({
    required this.accent,
    required this.progress,
    required this.onPressed,
  });
  final Color accent;
  final double? progress;
  final VoidCallback? onPressed;

  @override
  Widget build(BuildContext context) {
    final disabled = onPressed == null;
    return Material(
      color: disabled
          ? accent.withValues(alpha: 0.20)
          : accent,
      borderRadius: BorderRadius.circular(HundlerRadius.sm),
      child: InkWell(
        onTap: onPressed,
        borderRadius: BorderRadius.circular(HundlerRadius.sm),
        child: Padding(
          padding: const EdgeInsets.symmetric(
            horizontal: 12,
            vertical: 7,
          ),
          child: Text(
            disabled ? 'Скачивание…' : 'Обновить',
            style: const TextStyle(
              fontSize: 12,
              fontWeight: FontWeight.w700,
              color: Colors.white,
              height: 1.0,
            ),
          ),
        ),
      ),
    );
  }
}

/// Переключатель режима VPN: TUN (системный туннель) или Proxy
/// (HTTP+SOCKS5 на 127.0.0.1:7890).
///
/// Visually — segment control из двух кнопок. Активная — red-filled с
/// иконкой и подписью. Inactive — outlined.
///
/// Disabled когда VPN уже подключён или подключается — менять inbound
/// на лету нельзя, нужно сначала disconnect.
class _VpnModeSwitch extends ConsumerWidget {
  const _VpnModeSwitch({required this.enabled});
  final bool enabled;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final mode = ref.watch(vpnModeProvider);
    // Компактный вариант (2026-05-15): переехал в низ экрана,
    // кнопки меньше (vertical 8px), лейблы английские (Tun/Proxy)
    // чтобы не путать с русским сегмент-контролом сверху
    // (выбор сервера).
    return Opacity(
      opacity: enabled ? 1.0 : 0.55,
      child: Container(
        padding: const EdgeInsets.all(3),
        decoration: BoxDecoration(
          color: HundlerColors.bgSurface,
          borderRadius: BorderRadius.circular(HundlerRadius.sm),
          border: Border.all(color: HundlerColors.borderSubtle),
        ),
        child: Row(
          children: [
            Expanded(
              child: _ModeButton(
                label: 'Tun',
                icon: LucideIcons.shield,
                active: mode == VpnMode.tun,
                onTap: enabled
                    ? () =>
                        ref.read(vpnModeProvider.notifier).set(VpnMode.tun)
                    : null,
              ),
            ),
            const SizedBox(width: 3),
            Expanded(
              child: _ModeButton(
                label: 'Proxy',
                icon: LucideIcons.cable,
                active: mode == VpnMode.proxy,
                onTap: enabled
                    ? () =>
                        ref.read(vpnModeProvider.notifier).set(VpnMode.proxy)
                    : null,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _ModeButton extends StatelessWidget {
  const _ModeButton({
    required this.label,
    required this.icon,
    required this.active,
    required this.onTap,
  });

  final String label;
  final IconData icon;
  final bool active;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      behavior: HitTestBehavior.opaque,
      onTap: onTap,
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 160),
        padding: const EdgeInsets.symmetric(
          horizontal: HundlerSpacing.xs,
          vertical: 7,
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
              size: 12,
              color: active
                  ? HundlerColors.accentRed
                  : HundlerColors.textSecondary,
            ),
            const SizedBox(width: 6),
            Text(
              label,
              style: TextStyle(
                fontSize: 11,
                fontWeight: FontWeight.w700,
                letterSpacing: 0.3,
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

String _localCountry(String iso) {
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
    case '':
      return 'Авто';
    default:
      return iso;
  }
}
