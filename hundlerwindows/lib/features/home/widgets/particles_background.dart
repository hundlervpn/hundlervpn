import 'dart:math' as math;
import 'dart:ui' as ui;

import 'package:flutter/material.dart';

import '../../../core/colors.dart';

/// Анимированный фон с сеткой узлов и бегающими по рёбрам «локаторами».
///
/// 1-в-1 порт `hundlerminiapp/components/ParticlesBackground.tsx`:
/// - Узлы расставляются по сетке `spacing` px со случайным джиттером ±20%.
/// - Соседние узлы (расстояние < 1.6 × spacing) соединяются ребром
///   с вероятностью 85%.
/// - Локаторы — точки с радиальным glow, бегают по случайно выбранному
///   ребру, при достижении конца перепрыгивают на смежное ребро того
///   же узла. Это даёт ощущение «трафика бегущего по сети».
///
/// Граф (узлы + рёбра) генерируется ОДИН раз при первом layout
/// и при изменении размера экрана. Анимация — 60 FPS через
/// `AnimationController` с `vsync` (rendering-aware ticker, который
/// идёт ровно с частотой обновления окна).
///
/// Цвета — из палитры Hundler (red-500 + orange-500 для glow).
/// Производительность: ~80-120 узлов и ~150-220 рёбер для окна
/// 420×720, painter работает в 60 FPS даже на интегрированной графике.
class ParticlesBackground extends StatefulWidget {
  const ParticlesBackground({super.key});

  @override
  State<ParticlesBackground> createState() => _ParticlesBackgroundState();
}

class _ParticlesBackgroundState extends State<ParticlesBackground>
    with SingleTickerProviderStateMixin {
  late final AnimationController _ctrl;
  final math.Random _rng = math.Random(42);

  /// Кэш сгенерированного графа. Размер экрана не меняется часто
  /// (Window resize редко), поэтому пере-генерация дешёвая.
  Size? _lastSize;
  List<Offset> _nodes = const [];
  List<_Edge> _edges = const [];
  List<_Locator> _locators = const [];

  @override
  void initState() {
    super.initState();
    // 60 FPS-ish loop через бесконечную анимацию. Period не важен —
    // мы используем только тик-сигнал чтобы перерисовать. Сами
    // координаты локаторов считаются от deltaTime в build/painter.
    _ctrl = AnimationController(
      vsync: this,
      duration: const Duration(seconds: 1),
    )..repeat();
  }

  @override
  void dispose() {
    _ctrl.dispose();
    super.dispose();
  }

  void _regenerate(Size size) {
    final w = size.width;
    final h = size.height;
    // Реже чем в мини-аппе (там 80/120 для fullscreen mobile). На
    // Windows окно 420×720 и сетка получалась слишком плотной/яркой,
    // отвлекая от центрального тигра. 150 даёт ~3 столбца × 5 строк.
    final spacing = math.min(w, h) < 600 ? 110.0 : 150.0;

    final nodes = <Offset>[];
    final edges = <_Edge>[];

    final cols = (w / spacing).ceil() + 2;
    final rows = (h / spacing).ceil() + 2;

    for (var row = -1; row < rows; row++) {
      for (var col = -1; col < cols; col++) {
        final x = col * spacing + (_rng.nextDouble() - 0.5) * spacing * 0.4;
        final y = row * spacing + (_rng.nextDouble() - 0.5) * spacing * 0.4;
        nodes.add(Offset(x, y));
      }
    }

    final maxDistSq = (spacing * 1.6) * (spacing * 1.6);
    for (var i = 0; i < nodes.length; i++) {
      for (var j = i + 1; j < nodes.length; j++) {
        final dx = nodes[j].dx - nodes[i].dx;
        final dy = nodes[j].dy - nodes[i].dy;
        if (dx * dx + dy * dy < maxDistSq && _rng.nextDouble() > 0.15) {
          edges.add(_Edge(i, j));
        }
      }
    }

    final locatorCount = (edges.length * 0.15).floor();
    final locators = <_Locator>[];
    for (var i = 0; i < locatorCount; i++) {
      locators.add(_Locator(
        edgeIndex: _rng.nextInt(edges.length),
        progress: _rng.nextDouble(),
        // speed = доля длины ребра, проходимая за кадр @ 60 FPS.
        // 0.002..0.006 → ребро проходится за 2.7..8 секунд.
        speed: 0.002 + _rng.nextDouble() * 0.004,
        // Чуть мельче (1..3 вместо 2..5) и менее яркие (0.35..0.65
        // вместо 0.6..1.0) против мини-аппа — на desktop окно
        // меньше и яркие точки сильно бросаются в глаза.
        size: 1 + _rng.nextDouble() * 2,
        opacity: 0.35 + _rng.nextDouble() * 0.3,
      ));
    }

    _nodes = nodes;
    _edges = edges;
    _locators = locators;
    _lastSize = size;
  }

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (context, constraints) {
        final size = Size(constraints.maxWidth, constraints.maxHeight);
        if (_lastSize != size) {
          _regenerate(size);
        }
        return AnimatedBuilder(
          animation: _ctrl,
          builder: (_, __) {
            // Шаг по локаторам — один раз за кадр.
            _stepLocators();
            return CustomPaint(
              size: size,
              painter: _ParticlesPainter(
                nodes: _nodes,
                edges: _edges,
                locators: _locators,
              ),
            );
          },
        );
      },
    );
  }

  void _stepLocators() {
    final edges = _edges;
    if (edges.isEmpty) return;
    for (final loc in _locators) {
      loc.progress += loc.speed;
      if (loc.progress >= 1.0) {
        _hopForward(loc);
      } else if (loc.progress <= 0.0) {
        _hopBackward(loc);
      }
    }
  }

  void _hopForward(_Locator loc) {
    final edges = _edges;
    final currentEdge = edges[loc.edgeIndex];
    final endNode =
        _rng.nextDouble() > 0.5 ? currentEdge.to : currentEdge.from;
    final connected = <int>[];
    for (var idx = 0; idx < edges.length; idx++) {
      if (idx == loc.edgeIndex) continue;
      final e = edges[idx];
      if (e.from == endNode || e.to == endNode) connected.add(idx);
    }
    if (connected.isNotEmpty) {
      final nextIdx = connected[_rng.nextInt(connected.length)];
      final nextEdge = edges[nextIdx];
      loc.edgeIndex = nextIdx;
      // Если мы пришли в `endNode` и в новом ребре endNode = from,
      // то двигаться дальше → progress=0, скорость +.
      // Если endNode = to → progress=1, скорость −.
      if (nextEdge.from == endNode) {
        loc.progress = 0.0;
        loc.speed = loc.speed.abs();
      } else {
        loc.progress = 1.0;
        loc.speed = -loc.speed.abs();
      }
    } else {
      loc.speed = -loc.speed;
      loc.progress = 1.0;
    }
  }

  void _hopBackward(_Locator loc) {
    final edges = _edges;
    final currentEdge = edges[loc.edgeIndex];
    final endNode =
        _rng.nextDouble() > 0.5 ? currentEdge.from : currentEdge.to;
    final connected = <int>[];
    for (var idx = 0; idx < edges.length; idx++) {
      if (idx == loc.edgeIndex) continue;
      final e = edges[idx];
      if (e.from == endNode || e.to == endNode) connected.add(idx);
    }
    if (connected.isNotEmpty) {
      final nextIdx = connected[_rng.nextInt(connected.length)];
      final nextEdge = edges[nextIdx];
      loc.edgeIndex = nextIdx;
      if (nextEdge.to == endNode) {
        loc.progress = 1.0;
        loc.speed = -loc.speed.abs();
      } else {
        loc.progress = 0.0;
        loc.speed = loc.speed.abs();
      }
    } else {
      loc.speed = -loc.speed;
      loc.progress = 0.0;
    }
  }
}

class _Edge {
  const _Edge(this.from, this.to);
  final int from;
  final int to;
}

class _Locator {
  _Locator({
    required this.edgeIndex,
    required this.progress,
    required this.speed,
    required this.size,
    required this.opacity,
  });
  int edgeIndex;
  double progress;
  double speed;
  final double size;
  final double opacity;
}

class _ParticlesPainter extends CustomPainter {
  _ParticlesPainter({
    required this.nodes,
    required this.edges,
    required this.locators,
  });

  final List<Offset> nodes;
  final List<_Edge> edges;
  final List<_Locator> locators;

  // Прозрачность снижена против мини-аппа (там 0.15 / 0.06). На
  // Windows desktop сетка видится сильнее (нет затемнения телефона
  // под пальцем), поэтому делаем её ещё тоньше — еле заметная подложка.
  static final Paint _edgePaint = Paint()
    ..style = PaintingStyle.stroke
    ..strokeWidth = 1
    ..color = HundlerColors.accentRed.withValues(alpha: 0.07);

  static final Paint _nodePaint = Paint()
    ..style = PaintingStyle.fill
    ..color = HundlerColors.accentRed.withValues(alpha: 0.04);

  @override
  void paint(Canvas canvas, Size size) {
    if (nodes.isEmpty || edges.isEmpty) return;

    // 1) Рёбра — единый Path для одного draw call.
    final edgePath = ui.Path();
    for (final e in edges) {
      final from = nodes[e.from];
      final to = nodes[e.to];
      edgePath.moveTo(from.dx, from.dy);
      edgePath.lineTo(to.dx, to.dy);
    }
    canvas.drawPath(edgePath, _edgePaint);

    // 2) Узлы (мелкие точки на пересечениях). 1-px радиус, без glow.
    for (final n in nodes) {
      canvas.drawCircle(n, 1, _nodePaint);
    }

    // 3) Локаторы — glow + ядро.
    for (final loc in locators) {
      if (loc.edgeIndex < 0 || loc.edgeIndex >= edges.length) continue;
      final edge = edges[loc.edgeIndex];
      final from = nodes[edge.from];
      final to = nodes[edge.to];
      final p = loc.progress.clamp(0.0, 1.0);
      final pos = Offset(
        from.dx + (to.dx - from.dx) * p,
        from.dy + (to.dy - from.dy) * p,
      );

      // Glow: радиальный градиент через Shader.
      final glowRadius = loc.size * 4;
      final glow = Paint()
        ..shader = ui.Gradient.radial(
          pos,
          glowRadius,
          [
            HundlerColors.accentRed.withValues(alpha: loc.opacity * 0.8),
            HundlerColors.accentRed.withValues(alpha: loc.opacity * 0.3),
            HundlerColors.accentRed.withValues(alpha: 0),
          ],
          const [0.0, 0.5, 1.0],
        );
      canvas.drawCircle(pos, glowRadius, glow);

      // Ядро — яркая точка.
      final corePaint = Paint()
        ..style = PaintingStyle.fill
        ..color = const Color(0xFFFF6464).withValues(alpha: loc.opacity);
      canvas.drawCircle(pos, loc.size, corePaint);
    }
  }

  @override
  bool shouldRepaint(covariant _ParticlesPainter oldDelegate) =>
      // Перерисовываем каждый кадр — locators мутабельные.
      true;
}
