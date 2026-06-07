import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';
import 'package:package_info_plus/package_info_plus.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../core/api_client.dart';
import '../../core/colors.dart';
import '../../core/typography.dart';
import '../auth/auth_controller.dart';

/// Экран профиля. По аналогии с мини-аппом:
///
/// - Аватар (или инициалы) + имя + email.
/// - Большая карточка подписки: дни / статус / дата окончания + CTA.
/// - Список привязок (Telegram / Google / Email) — со статусом.
/// - Реферальный код (copy-on-tap).
/// - Управление подпиской → открывает hundlervpn.xyz в браузере.
/// - Поддержка → t.me/hundler_support.
/// - Версия приложения + кнопка «Выйти».
///
/// Данные тянутся из:
///  - `authControllerProvider.session` (имя, email из сессии)
///  - `authControllerProvider.state` (HundlerUserState — дни, sub URL)
///  - `_accountProvider` (HundlerAccount — привязки, referral code)
class ProfileScreen extends ConsumerStatefulWidget {
  const ProfileScreen({super.key});

  @override
  ConsumerState<ProfileScreen> createState() => _ProfileScreenState();
}

/// FutureProvider.family — лениво подтянем расширенный профиль ровно один
/// раз. invalidate'ится после `signOut` чтобы при следующем логине данные
/// были свежими.
final accountProvider = FutureProvider.family<HundlerAccount?, int>(
  (ref, userId) async {
    return HundlerApi().fetchAccount(userId: userId);
  },
);

class _ProfileScreenState extends ConsumerState<ProfileScreen> {
  String _appVersion = '';

  @override
  void initState() {
    super.initState();
    PackageInfo.fromPlatform().then((p) {
      if (!mounted) return;
      setState(() => _appVersion = '${p.version} (${p.buildNumber})');
    });
  }

  Future<void> _openUrl(String url) async {
    final uri = Uri.parse(url);
    if (await canLaunchUrl(uri)) {
      await launchUrl(uri, mode: LaunchMode.externalApplication);
    }
  }

  Future<void> _copyReferral(String code) async {
    await Clipboard.setData(ClipboardData(text: code));
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(
        content: Text('Скопировано'),
        behavior: SnackBarBehavior.floating,
        margin: EdgeInsets.all(16),
        duration: Duration(seconds: 1),
      ),
    );
  }

  Future<void> _logout() async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: HundlerColors.bgElevated,
        title: const Text('Выйти из аккаунта?'),
        content: const Text(
          'Подписка останется активной — войдите снова в любой момент.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, false),
            child: const Text('Отмена'),
          ),
          TextButton(
            onPressed: () => Navigator.pop(ctx, true),
            style: TextButton.styleFrom(foregroundColor: HundlerColors.danger),
            child: const Text('Выйти'),
          ),
        ],
      ),
    );
    if (confirmed == true) {
      await ref.read(authControllerProvider.notifier).signOut();
    }
  }

  @override
  Widget build(BuildContext context) {
    final auth = ref.watch(authControllerProvider);
    if (auth is! AuthSignedIn) {
      return const Scaffold(
        body: Center(child: CircularProgressIndicator()),
      );
    }

    final session = auth.session;
    final userState = auth.state;
    final accountAsync = ref.watch(accountProvider(session.userId));

    return Scaffold(
      backgroundColor: HundlerColors.bgPrimary,
      appBar: AppBar(
        backgroundColor: Colors.transparent,
        elevation: 0,
        centerTitle: true,
        title: Text(
          'ПРОФИЛЬ',
          style: HundlerTypography.brandTitle(size: 16),
        ),
      ),
      body: RefreshIndicator(
        color: HundlerColors.accentRed,
        backgroundColor: HundlerColors.bgSurface,
        onRefresh: () async {
          await ref.read(authControllerProvider.notifier).refreshUserState();
          ref.invalidate(accountProvider(session.userId));
        },
        child: ListView(
          padding: const EdgeInsets.fromLTRB(20, 8, 20, 96),
          physics: const AlwaysScrollableScrollPhysics(),
          children: [
            _ProfileHeader(
              session: session,
              account: accountAsync.valueOrNull,
            ),
            const SizedBox(height: 20),
            _SubscriptionCard(state: userState),
            const SizedBox(height: 20),
            _SectionLabel('Привязки'),
            const SizedBox(height: 8),
            accountAsync.when(
              loading: () => const _LinksLoading(),
              error: (e, _) => _LinksError(message: e.toString()),
              data: (a) => _LinksList(
                account: a,
                onLinkTelegram: () => _openUrl(
                  'https://hundlervpn.xyz/?from=android&open=link_tg',
                ),
                onLinkGoogle: () => _openUrl(
                  'https://hundlervpn.xyz/?from=android&open=link_google',
                ),
                onLinkEmail: () => _openUrl(
                  'https://hundlervpn.xyz/?from=android&open=link_email',
                ),
              ),
            ),
            const SizedBox(height: 20),
            _SectionLabel('Сервис'),
            const SizedBox(height: 8),
            _ActionTile(
              icon: LucideIcons.creditCard,
              title: 'Продлить подписку',
              subtitle: 'Оплата через мини-апп Telegram',
              onTap: () => _openUrl('https://t.me/hundlervpnbot/app'),
            ),
            _ActionTile(
              icon: LucideIcons.shield,
              title: 'Исключения VPN',
              subtitle: 'Какие приложения работают в обход',
              onTap: () => Navigator.of(context).pushNamed('/settings/excluded'),
            ),
            _ActionTile(
              icon: LucideIcons.messageCircle,
              title: 'Поддержка',
              subtitle: '@hundler_support',
              onTap: () => _openUrl('https://t.me/hundler_support'),
            ),
            accountAsync.maybeWhen(
              data: (a) {
                final code = a?.referralCode;
                if (code == null || code.isEmpty) return const SizedBox.shrink();
                return _ActionTile(
                  icon: LucideIcons.gift,
                  title: 'Реферальный код',
                  subtitle: code,
                  trailing: const Icon(
                    LucideIcons.copy,
                    size: 16,
                    color: HundlerColors.textSecondary,
                  ),
                  onTap: () => _copyReferral(code),
                );
              },
              orElse: () => const SizedBox.shrink(),
            ),
            const SizedBox(height: 24),
            _LogoutButton(onPressed: _logout),
            const SizedBox(height: 14),
            Center(
              child: Text(
                _appVersion.isEmpty
                    ? 'Hundler VPN'
                    : 'Hundler VPN · $_appVersion',
                style: TextStyle(
                  color: HundlerColors.textSecondary.withValues(alpha: 0.6),
                  fontSize: 11,
                  letterSpacing: 0.3,
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Header
// ─────────────────────────────────────────────────────────────────────────────

class _ProfileHeader extends StatelessWidget {
  const _ProfileHeader({required this.session, required this.account});

  final HundlerSession session;
  final HundlerAccount? account;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final name = account?.displayName ?? session.displayName;
    final email = account?.email ?? session.email;
    final tgUsername = account?.username;

    return Container(
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        gradient: LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [
            HundlerColors.accentRed.withValues(alpha: 0.12),
            HundlerColors.bgSurface,
          ],
        ),
        borderRadius: BorderRadius.circular(HundlerRadius.md),
        border: Border.all(
          color: HundlerColors.accentRed.withValues(alpha: 0.25),
        ),
      ),
      child: Row(
        children: [
          _BigAvatar(initials: _initials(name)),
          const SizedBox(width: 14),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(
                  name,
                  style: theme.textTheme.titleLarge?.copyWith(
                    fontWeight: FontWeight.w700,
                  ),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
                if (email != null && email.isNotEmpty) ...[
                  const SizedBox(height: 2),
                  Text(
                    email,
                    style: theme.textTheme.bodySmall?.copyWith(
                      color: HundlerColors.textSecondary,
                      fontSize: 12,
                    ),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                ],
                if (tgUsername != null && tgUsername.isNotEmpty) ...[
                  const SizedBox(height: 2),
                  Text(
                    '@$tgUsername',
                    style: theme.textTheme.bodySmall?.copyWith(
                      color: const Color(0xFF2AABEE),
                      fontSize: 12,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                ],
              ],
            ),
          ),
        ],
      ),
    );
  }

  String _initials(String name) {
    final parts = name.trim().split(RegExp(r'\s+'));
    if (parts.isEmpty || parts.first.isEmpty) return '?';
    if (parts.length == 1) return parts.first.characters.first.toUpperCase();
    return (parts.first.characters.first + parts.last.characters.first)
        .toUpperCase();
  }
}

class _BigAvatar extends StatelessWidget {
  const _BigAvatar({required this.initials});
  final String initials;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: 64,
      height: 64,
      decoration: BoxDecoration(
        shape: BoxShape.circle,
        gradient: const LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [Color(0xFF2A0A0A), Color(0xFF1A0606)],
        ),
        border: Border.all(color: HundlerColors.accentRed, width: 2),
        boxShadow: [
          BoxShadow(
            color: HundlerColors.accentRed.withValues(alpha: 0.3),
            blurRadius: 16,
            spreadRadius: 1,
          ),
        ],
      ),
      alignment: Alignment.center,
      child: Text(
        initials,
        style: const TextStyle(
          color: HundlerColors.accentRed,
          fontWeight: FontWeight.w800,
          fontSize: 24,
          letterSpacing: 0.5,
        ),
      ),
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Subscription Card
// ─────────────────────────────────────────────────────────────────────────────

class _SubscriptionCard extends StatelessWidget {
  const _SubscriptionCard({required this.state});

  final HundlerUserState? state;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final (badge, badgeColor, headline, sub) = _resolve(state);

    return Container(
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        color: HundlerColors.bgSurface,
        borderRadius: BorderRadius.circular(HundlerRadius.md),
        border: Border.all(color: HundlerColors.borderSubtle),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Text(
                'ПОДПИСКА',
                style: HundlerTypography.brandTitle(size: 11).copyWith(
                  color: HundlerColors.textSecondary,
                  letterSpacing: 1.5,
                ),
              ),
              const Spacer(),
              Container(
                padding: const EdgeInsets.symmetric(
                  horizontal: 10,
                  vertical: 4,
                ),
                decoration: BoxDecoration(
                  color: badgeColor.withValues(alpha: 0.14),
                  borderRadius: BorderRadius.circular(8),
                  border: Border.all(
                    color: badgeColor.withValues(alpha: 0.4),
                  ),
                ),
                child: Text(
                  badge,
                  style: TextStyle(
                    color: badgeColor,
                    fontWeight: FontWeight.w700,
                    fontSize: 11,
                    letterSpacing: 0.5,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 14),
          Text(
            headline,
            style: HundlerTypography.statusBadge(
              size: 28,
              color: HundlerColors.textPrimary,
            ),
          ),
          const SizedBox(height: 4),
          Text(
            sub,
            style: theme.textTheme.bodyMedium?.copyWith(
              color: HundlerColors.textSecondary,
            ),
          ),
        ],
      ),
    );
  }

  /// Возвращает (badgeText, badgeColor, bigHeadline, subhint).
  (String, Color, String, String) _resolve(HundlerUserState? s) {
    if (s == null) {
      return ('—', HundlerColors.textSecondary, 'Загрузка…', '');
    }
    if (s.isBanned) {
      return (
        'Заблокирован',
        HundlerColors.danger,
        'Аккаунт заблокирован',
        s.banReason ?? 'Обратитесь в поддержку',
      );
    }
    if (s.isActive) {
      final days = s.daysLeft;
      final endText = s.endDate != null
          ? 'До ${_fmtDate(s.endDate!)}'
          : 'Активна';
      return (
        'Активна',
        HundlerColors.success,
        _formatDays(days),
        endText,
      );
    }
    if (s.subscriptionUrl != null && s.subscriptionUrl!.isNotEmpty) {
      return (
        'Истекла',
        HundlerColors.accentOrange,
        'Нет дней',
        'Продлите через мини-апп',
      );
    }
    return (
      'Нет подписки',
      HundlerColors.textSecondary,
      'Триал не активен',
      'Активируйте подписку в мини-аппе',
    );
  }

  String _formatDays(int n) {
    final mod100 = n % 100;
    final mod10 = n % 10;
    if (mod100 >= 11 && mod100 <= 14) return '$n дней';
    if (mod10 == 1) return '$n день';
    if (mod10 >= 2 && mod10 <= 4) return '$n дня';
    return '$n дней';
  }

  String _fmtDate(DateTime dt) {
    const months = [
      'янв', 'фев', 'мар', 'апр', 'мая', 'июн',
      'июл', 'авг', 'сен', 'окт', 'ноя', 'дек',
    ];
    return '${dt.day} ${months[dt.month - 1]} ${dt.year}';
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Links list
// ─────────────────────────────────────────────────────────────────────────────

class _SectionLabel extends StatelessWidget {
  const _SectionLabel(this.text);
  final String text;

  @override
  Widget build(BuildContext context) {
    return Text(
      text.toUpperCase(),
      style: TextStyle(
        color: HundlerColors.textSecondary.withValues(alpha: 0.8),
        fontSize: 11,
        fontWeight: FontWeight.w700,
        letterSpacing: 1.5,
      ),
    );
  }
}

class _LinksList extends StatelessWidget {
  const _LinksList({
    required this.account,
    required this.onLinkTelegram,
    required this.onLinkGoogle,
    required this.onLinkEmail,
  });

  final HundlerAccount? account;
  final VoidCallback onLinkTelegram;
  final VoidCallback onLinkGoogle;
  final VoidCallback onLinkEmail;

  @override
  Widget build(BuildContext context) {
    final a = account;
    return Container(
      decoration: BoxDecoration(
        color: HundlerColors.bgSurface,
        borderRadius: BorderRadius.circular(HundlerRadius.md),
        border: Border.all(color: HundlerColors.borderSubtle),
      ),
      child: Column(
        children: [
          _LinkRow(
            icon: LucideIcons.send,
            iconColor: const Color(0xFF2AABEE),
            label: 'Telegram',
            value: a?.hasTelegram == true
                ? (a?.username != null && a!.username!.isNotEmpty
                    ? '@${a.username}'
                    : 'ID ${a?.telegramId}')
                : null,
            onLink: a?.hasTelegram == true ? null : onLinkTelegram,
          ),
          const _Divider(),
          _LinkRow(
            icon: LucideIcons.mail,
            iconColor: HundlerColors.accentRed,
            label: 'E-mail',
            value: a?.hasEmail == true ? a?.email : null,
            onLink: a?.hasEmail == true ? null : onLinkEmail,
          ),
          const _Divider(),
          _LinkRow(
            icon: LucideIcons.circleUser,
            iconColor: HundlerColors.textPrimary,
            label: 'Google',
            value: a?.hasGoogle == true ? (a?.email ?? 'привязан') : null,
            onLink: a?.hasGoogle == true ? null : onLinkGoogle,
          ),
        ],
      ),
    );
  }
}

class _LinkRow extends StatelessWidget {
  const _LinkRow({
    required this.icon,
    required this.iconColor,
    required this.label,
    required this.value,
    required this.onLink,
  });

  final IconData icon;
  final Color iconColor;
  final String label;
  final String? value;

  /// `null` если уже привязан (показываем галочку), иначе тап = link-flow.
  final VoidCallback? onLink;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final linked = onLink == null;
    return InkWell(
      onTap: onLink,
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
        child: Row(
          children: [
            Container(
              width: 32,
              height: 32,
              decoration: BoxDecoration(
                color: iconColor.withValues(alpha: 0.12),
                borderRadius: BorderRadius.circular(8),
              ),
              alignment: Alignment.center,
              child: Icon(icon, size: 16, color: iconColor),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    label,
                    style: theme.textTheme.bodyMedium?.copyWith(
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                  if (value != null && value!.isNotEmpty) ...[
                    const SizedBox(height: 2),
                    Text(
                      value!,
                      style: theme.textTheme.bodySmall?.copyWith(
                        color: HundlerColors.textSecondary,
                        fontSize: 12,
                      ),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                  ],
                ],
              ),
            ),
            if (linked)
              const Icon(
                LucideIcons.check,
                size: 18,
                color: HundlerColors.success,
              )
            else
              const Text(
                'Привязать',
                style: TextStyle(
                  color: HundlerColors.accentRed,
                  fontSize: 13,
                  fontWeight: FontWeight.w600,
                ),
              ),
          ],
        ),
      ),
    );
  }
}

class _LinksLoading extends StatelessWidget {
  const _LinksLoading();
  @override
  Widget build(BuildContext context) {
    return Container(
      height: 156,
      decoration: BoxDecoration(
        color: HundlerColors.bgSurface,
        borderRadius: BorderRadius.circular(HundlerRadius.md),
        border: Border.all(color: HundlerColors.borderSubtle),
      ),
      child: const Center(
        child: SizedBox(
          width: 22,
          height: 22,
          child: CircularProgressIndicator(
            strokeWidth: 2,
            color: HundlerColors.accentRed,
          ),
        ),
      ),
    );
  }
}

class _LinksError extends StatelessWidget {
  const _LinksError({required this.message});
  final String message;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: HundlerColors.bgSurface,
        borderRadius: BorderRadius.circular(HundlerRadius.md),
        border: Border.all(
          color: HundlerColors.danger.withValues(alpha: 0.4),
        ),
      ),
      child: Row(
        children: [
          const Icon(
            LucideIcons.triangleAlert,
            color: HundlerColors.danger,
            size: 18,
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Text(
              'Не удалось загрузить профиль: $message',
              style: const TextStyle(
                color: HundlerColors.textSecondary,
                fontSize: 12,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _Divider extends StatelessWidget {
  const _Divider();

  @override
  Widget build(BuildContext context) {
    return Container(
      height: 0.5,
      color: HundlerColors.borderSubtle,
      margin: const EdgeInsets.only(left: 60),
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Generic action tile (для нижних разделов «Сервис»)
// ─────────────────────────────────────────────────────────────────────────────

class _ActionTile extends StatelessWidget {
  const _ActionTile({
    required this.icon,
    required this.title,
    required this.subtitle,
    required this.onTap,
    this.trailing,
  });

  final IconData icon;
  final String title;
  final String subtitle;
  final VoidCallback onTap;
  final Widget? trailing;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Container(
      margin: const EdgeInsets.only(bottom: 8),
      decoration: BoxDecoration(
        color: HundlerColors.bgSurface,
        borderRadius: BorderRadius.circular(HundlerRadius.md),
        border: Border.all(color: HundlerColors.borderSubtle),
      ),
      child: Material(
        color: Colors.transparent,
        child: InkWell(
          onTap: onTap,
          borderRadius: BorderRadius.circular(HundlerRadius.md),
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
            child: Row(
              children: [
                Container(
                  width: 32,
                  height: 32,
                  decoration: BoxDecoration(
                    color: HundlerColors.accentRed.withValues(alpha: 0.12),
                    borderRadius: BorderRadius.circular(8),
                  ),
                  alignment: Alignment.center,
                  child: Icon(icon, size: 16, color: HundlerColors.accentRed),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        title,
                        style: theme.textTheme.bodyMedium?.copyWith(
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                      const SizedBox(height: 2),
                      Text(
                        subtitle,
                        style: theme.textTheme.bodySmall?.copyWith(
                          color: HundlerColors.textSecondary,
                          fontSize: 12,
                        ),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                      ),
                    ],
                  ),
                ),
                trailing ??
                    const Icon(
                      LucideIcons.chevronRight,
                      size: 16,
                      color: HundlerColors.textSecondary,
                    ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _LogoutButton extends StatelessWidget {
  const _LogoutButton({required this.onPressed});
  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: double.infinity,
      height: 52,
      child: OutlinedButton.icon(
        onPressed: onPressed,
        icon: const Icon(LucideIcons.logOut, size: 18),
        label: const Text('Выйти из аккаунта'),
        style: OutlinedButton.styleFrom(
          foregroundColor: HundlerColors.danger,
          side: BorderSide(
            color: HundlerColors.danger.withValues(alpha: 0.4),
          ),
          backgroundColor: HundlerColors.danger.withValues(alpha: 0.04),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(HundlerRadius.sm),
          ),
          textStyle: const TextStyle(
            fontWeight: FontWeight.w600,
            fontSize: 15,
          ),
        ),
      ),
    );
  }
}
