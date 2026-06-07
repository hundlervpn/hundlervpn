import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';
import 'package:package_info_plus/package_info_plus.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../core/colors.dart';
import '../../core/typography.dart';

/// Экран настроек, открывается из AppBar HomeScreen (gear-икона).
///
/// Список разделов:
/// - **Исключения VPN** — какие приложения работают в обход VPN
///   (open route `/settings/excluded` — ExcludedAppsScreen).
/// - **О приложении** — версия + ссылка на сайт.
/// - **Условия / Политика** — внешние URL.
///
/// Это разные настройки от ProfileScreen: тут — параметры приложения,
/// в Profile — параметры аккаунта.
class SettingsScreen extends StatefulWidget {
  const SettingsScreen({super.key});

  @override
  State<SettingsScreen> createState() => _SettingsScreenState();
}

class _SettingsScreenState extends State<SettingsScreen> {
  String _version = '';

  @override
  void initState() {
    super.initState();
    PackageInfo.fromPlatform().then((p) {
      if (!mounted) return;
      setState(() => _version = '${p.version} (${p.buildNumber})');
    });
  }

  Future<void> _openUrl(String url) async {
    final uri = Uri.parse(url);
    if (await canLaunchUrl(uri)) {
      await launchUrl(uri, mode: LaunchMode.externalApplication);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: HundlerColors.bgPrimary,
      appBar: AppBar(
        backgroundColor: Colors.transparent,
        elevation: 0,
        centerTitle: true,
        title: Text(
          'НАСТРОЙКИ',
          style: HundlerTypography.brandTitle(size: 16),
        ),
        leading: IconButton(
          icon: const Icon(LucideIcons.arrowLeft, size: 20),
          onPressed: () => Navigator.of(context).maybePop(),
        ),
      ),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(20, 8, 20, 32),
        children: [
          _SectionLabel('VPN'),
          const SizedBox(height: 8),
          _SettingsTile(
            icon: LucideIcons.shield,
            iconColor: HundlerColors.accentRed,
            title: 'Исключения VPN',
            subtitle: 'Приложения, работающие в обход',
            onTap: () => Navigator.of(context).pushNamed('/settings/excluded'),
          ),
          const SizedBox(height: 20),
          _SectionLabel('Информация'),
          const SizedBox(height: 8),
          _SettingsTile(
            icon: LucideIcons.globe,
            iconColor: HundlerColors.textPrimary,
            title: 'Сайт hundlervpn.xyz',
            subtitle: 'Открыть в браузере',
            onTap: () => _openUrl('https://hundlervpn.xyz'),
          ),
          _SettingsTile(
            icon: LucideIcons.fileText,
            iconColor: HundlerColors.textPrimary,
            title: 'Условия использования',
            subtitle: 'Правила сервиса',
            onTap: () => _openUrl('https://hundlervpn.xyz/terms'),
          ),
          _SettingsTile(
            icon: LucideIcons.shieldCheck,
            iconColor: HundlerColors.textPrimary,
            title: 'Политика конфиденциальности',
            subtitle: 'Как мы обрабатываем данные',
            onTap: () => _openUrl('https://hundlervpn.xyz/privacy'),
          ),
          const SizedBox(height: 24),
          Center(
            child: Text(
              _version.isEmpty
                  ? 'Hundler VPN'
                  : 'Версия $_version',
              style: TextStyle(
                color: HundlerColors.textSecondary.withValues(alpha: 0.6),
                fontSize: 11,
                letterSpacing: 0.3,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

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

class _SettingsTile extends StatelessWidget {
  const _SettingsTile({
    required this.icon,
    required this.iconColor,
    required this.title,
    required this.subtitle,
    required this.onTap,
  });

  final IconData icon;
  final Color iconColor;
  final String title;
  final String subtitle;
  final VoidCallback onTap;

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
