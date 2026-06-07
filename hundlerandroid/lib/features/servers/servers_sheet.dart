import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../core/api_client.dart';
import '../../core/colors.dart';
import 'servers_controller.dart';

/// Bottom-sheet с выбором серверов.
///
/// Подписан на [serversProvider] (`AsyncValue<List<HundlerServer>>`) —
/// сам справляется со state'ами loading/error/data, не требует от
/// родителя пропсов. Pull-to-refresh обновляет список.
class ServersSheet extends ConsumerWidget {
  const ServersSheet({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final servers = ref.watch(serversProvider);
    final selected = ref.watch(selectedServerProvider);
    final theme = Theme.of(context);

    return Container(
      decoration: const BoxDecoration(
        color: HundlerColors.bgElevated,
        borderRadius: BorderRadius.vertical(top: Radius.circular(28)),
      ),
      child: SafeArea(
        top: false,
        child: ConstrainedBox(
          constraints: BoxConstraints(
            maxHeight: MediaQuery.of(context).size.height * 0.75,
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const SizedBox(height: 12),
              Center(
                child: Container(
                  width: 40,
                  height: 4,
                  decoration: BoxDecoration(
                    color: HundlerColors.borderStrong,
                    borderRadius: BorderRadius.circular(4),
                  ),
                ),
              ),
              const SizedBox(height: 16),
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 24),
                child: Row(
                  children: [
                    Expanded(
                      child: Text(
                        'Локации',
                        style: theme.textTheme.headlineSmall,
                      ),
                    ),
                    IconButton(
                      onPressed: () =>
                          ref.read(serversProvider.notifier).refresh(),
                      icon: const Icon(LucideIcons.refreshCw, size: 18),
                      tooltip: 'Обновить',
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 8),
              Flexible(
                child: servers.when(
                  loading: () => const _LoadingState(),
                  error: (e, _) => _ErrorState(
                    error: e,
                    onRetry: () =>
                        ref.read(serversProvider.notifier).refresh(),
                  ),
                  data: (list) {
                    if (list.isEmpty) return const _EmptyState();
                    return _ServerList(
                      servers: list,
                      selectedId: selected?.id,
                      onSelect: (server) {
                        ref.read(selectedServerProvider.notifier).select(server);
                        Navigator.of(context).maybePop();
                      },
                    );
                  },
                ),
              ),
              const SizedBox(height: 16),
            ],
          ),
        ),
      ),
    );
  }
}

class _LoadingState extends StatelessWidget {
  const _LoadingState();
  @override
  Widget build(BuildContext context) => const Padding(
        padding: EdgeInsets.symmetric(vertical: 48),
        child: Center(
          child: CircularProgressIndicator(
            color: HundlerColors.accentRed,
            strokeWidth: 2.5,
          ),
        ),
      );
}

class _ErrorState extends StatelessWidget {
  const _ErrorState({required this.error, required this.onRetry});
  final Object error;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(24, 32, 24, 32),
      child: Column(
        children: [
          const Icon(LucideIcons.wifiOff,
              color: HundlerColors.textSecondary, size: 32),
          const SizedBox(height: 12),
          Text(
            'Не удалось загрузить серверы',
            style: Theme.of(context).textTheme.titleMedium,
          ),
          const SizedBox(height: 4),
          Text(
            '$error',
            style: Theme.of(context).textTheme.bodySmall?.copyWith(
                  color: HundlerColors.textSecondary,
                ),
            textAlign: TextAlign.center,
            maxLines: 2,
            overflow: TextOverflow.ellipsis,
          ),
          const SizedBox(height: 16),
          OutlinedButton.icon(
            onPressed: onRetry,
            icon: const Icon(LucideIcons.refreshCw, size: 16),
            label: const Text('Повторить'),
          ),
        ],
      ),
    );
  }
}

class _EmptyState extends StatelessWidget {
  const _EmptyState();
  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 32),
      child: Column(
        children: [
          const Icon(LucideIcons.globe,
              color: HundlerColors.textSecondary, size: 32),
          const SizedBox(height: 12),
          Text(
            'Нет доступных серверов',
            style: Theme.of(context).textTheme.titleMedium,
          ),
          const SizedBox(height: 4),
          Text(
            'Похоже все локации временно отключены. Попробуйте позже.',
            style: Theme.of(context).textTheme.bodySmall?.copyWith(
                  color: HundlerColors.textSecondary,
                ),
            textAlign: TextAlign.center,
          ),
        ],
      ),
    );
  }
}

class _ServerList extends StatelessWidget {
  const _ServerList({
    required this.servers,
    required this.selectedId,
    required this.onSelect,
  });

  final List<HundlerServer> servers;
  final int? selectedId;
  final ValueChanged<HundlerServer> onSelect;

  @override
  Widget build(BuildContext context) {
    return ListView.separated(
      shrinkWrap: true,
      padding: const EdgeInsets.symmetric(horizontal: 16),
      itemCount: servers.length,
      separatorBuilder: (_, __) => const SizedBox(height: 8),
      itemBuilder: (context, i) {
        final server = servers[i];
        final isSelected = server.id == selectedId;
        return _ServerTile(
          server: server,
          isSelected: isSelected,
          onTap: () => onSelect(server),
        );
      },
    );
  }
}

class _ServerTile extends StatelessWidget {
  const _ServerTile({
    required this.server,
    required this.isSelected,
    required this.onTap,
  });

  final HundlerServer server;
  final bool isSelected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(HundlerRadius.md),
        child: Ink(
          padding: const EdgeInsets.symmetric(
            horizontal: HundlerSpacing.md,
            vertical: HundlerSpacing.sm + 2,
          ),
          decoration: BoxDecoration(
            color: isSelected
                ? HundlerColors.accentRed.withValues(alpha: 0.08)
                : HundlerColors.bgSurface,
            borderRadius: BorderRadius.circular(HundlerRadius.md),
            border: Border.all(
              color: isSelected
                  ? HundlerColors.accentRed.withValues(alpha: 0.5)
                  : HundlerColors.borderSubtle,
              width: isSelected ? 1.5 : 1,
            ),
          ),
          child: Row(
            children: [
              Text(server.flag, style: const TextStyle(fontSize: 26)),
              const SizedBox(width: HundlerSpacing.md),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      server.displayName,
                      style: theme.textTheme.titleMedium?.copyWith(
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                    Text(
                      'VLESS · Reality · uTLS',
                      style: theme.textTheme.bodySmall?.copyWith(
                        color: HundlerColors.textSecondary,
                        fontSize: 11,
                        letterSpacing: 0.4,
                      ),
                    ),
                  ],
                ),
              ),
              if (isSelected)
                const Icon(
                  LucideIcons.check,
                  color: HundlerColors.accentRed,
                  size: 20,
                ),
            ],
          ),
        ),
      ),
    );
  }
}
