import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../core/colors.dart';
import '../home/home_screen.dart';
import '../profile/profile_screen.dart';

/// Корневая оболочка для залогиненного юзера.
///
/// Держит BottomNavigationBar с двумя табами — «Главная» и «Профиль» —
/// и индексом-стейтом. Между табами переключаемся через `IndexedStack`,
/// чтобы сохранять scroll-позицию HomeScreen (тигр, статус) и список
/// привязок в ProfileScreen, не пересоздавая дерево каждый раз.
///
/// Сами экраны — `HomeScreen` и `ProfileScreen` — owners своего AppBar,
/// чтобы они могли иметь разные центрированные тайтлы / actions без
/// перепрыгиваний.
class MainShell extends ConsumerStatefulWidget {
  const MainShell({super.key});

  @override
  ConsumerState<MainShell> createState() => _MainShellState();
}

class _MainShellState extends ConsumerState<MainShell> {
  int _index = 0;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      // extendBody, чтобы тёмный фон под NavigationBar просвечивал
      // — иначе под полупрозрачным баром появляется заметная серая
      // полоса от Scaffold-background по умолчанию.
      extendBody: true,
      backgroundColor: HundlerColors.bgPrimary,
      body: IndexedStack(
        index: _index,
        children: const [
          HomeScreen(),
          ProfileScreen(),
        ],
      ),
      bottomNavigationBar: _BottomBar(
        index: _index,
        onTap: (i) => setState(() => _index = i),
      ),
    );
  }
}

class _BottomBar extends StatelessWidget {
  const _BottomBar({required this.index, required this.onTap});

  final int index;
  final ValueChanged<int> onTap;

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: const BoxDecoration(
        color: HundlerColors.bgSurface,
        border: Border(
          top: BorderSide(color: HundlerColors.borderSubtle, width: 0.5),
        ),
      ),
      child: SafeArea(
        top: false,
        child: SizedBox(
          height: 64,
          child: Row(
            children: [
              Expanded(
                child: _NavItem(
                  icon: LucideIcons.house,
                  label: 'Главная',
                  selected: index == 0,
                  onTap: () => onTap(0),
                ),
              ),
              Expanded(
                child: _NavItem(
                  icon: LucideIcons.user,
                  label: 'Профиль',
                  selected: index == 1,
                  onTap: () => onTap(1),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _NavItem extends StatelessWidget {
  const _NavItem({
    required this.icon,
    required this.label,
    required this.selected,
    required this.onTap,
  });

  final IconData icon;
  final String label;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final color = selected
        ? HundlerColors.accentRed
        : HundlerColors.textSecondary;
    return InkWell(
      onTap: onTap,
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 220),
        curve: Curves.easeOutCubic,
        alignment: Alignment.center,
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(icon, color: color, size: 22),
            const SizedBox(height: 4),
            Text(
              label,
              style: TextStyle(
                color: color,
                fontSize: 11,
                fontWeight: selected ? FontWeight.w700 : FontWeight.w500,
                letterSpacing: 0.2,
              ),
            ),
          ],
        ),
      ),
    );
  }
}
