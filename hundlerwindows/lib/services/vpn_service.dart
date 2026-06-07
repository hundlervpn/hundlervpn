import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:path_provider/path_provider.dart' as pp;

import 'binary_integrity.dart';

/// Состояние туннеля.
enum VpnStatus {
  /// Простой / идле.
  disconnected,

  /// Bootstrap: пишем конфиг, запускаем процесс. Длится ~1-2 сек.
  connecting,

  /// sing-box процесс жив, заявил inbound up.
  connected,

  /// Что-то пошло не так — детали в [VpnService.lastError].
  error,
}

/// Текущая статистика трафика. Обновляется через clash-api у sing-box
/// (если включён `clash-api` inbound в конфиге; в наших конфигах
/// сейчас НЕ включён, поэтому stats пока всегда null — TODO).
class VpnStats {
  const VpnStats({required this.upload, required this.download});
  final int upload;
  final int download;
}

/// Сервис управления sing-box.exe.
///
/// **Архитектура MVP** (без helper-сервиса на Rust):
///
/// 1. sing-box.exe + wintun.dll лежат в `%LOCALAPPDATA%\HundlerVPN\bin\`.
///    Бандлим в installer (Inno Setup) либо предлагаем юзеру скачать
///    при первом запуске (см. [ensureBinaries]).
///
/// 2. При нажатии Connect:
///    a) Пишем sing-box JSON (полученный из `/api/sub/{token}`) в
///       `%LOCALAPPDATA%\HundlerVPN\config\current.json`.
///    b) Запускаем `sing-box.exe run -c current.json` через
///       `Process.start` с `runInShell: false`.
///    c) Если в конфиге есть TUN-inbound (наш стандартный случай) —
///       sing-box попытается создать wintun adapter, что требует
///       admin. Если процесс запущен без admin — sing-box упадёт с
///       "operation not permitted".
///
/// 3. **UAC-elevation**: для admin-rights мы запускаем sing-box.exe
///    через `cmd.exe /c start "Hundler" /B "sing-box.exe" run -c ...`
///    с verb `runas` (через win32 ShellExecute). UAC-prompt появится
///    один раз на сессию (Windows кэширует elevation token).
///
///    *(TODO: правильнее иметь Windows Service который сидит под
///    LocalSystem и сам запускает sing-box без UAC — это 2-й этап,
///    `helper/` папка в WINDOWS-AGENTS.md.)*
///
/// 4. Stop: ловим pid процесса, отправляем `taskkill /T /F /PID <pid>`.
///    sing-box.exe сам отдаёт wintun-adapter обратно ОС при graceful
///    shutdown (SIGINT) — но через `taskkill /F` он умирает резко,
///    wintun остаётся в "DOWN" состоянии и сам убирается через минуту.
class VpnService {
  VpnService._();
  static final VpnService instance = VpnService._();

  /// Поток статусов для UI.
  Stream<VpnStatus> get statusStream => _statusController.stream;
  final _statusController = StreamController<VpnStatus>.broadcast();

  VpnStatus _status = VpnStatus.disconnected;
  VpnStatus get status => _status;

  String? _lastError;
  String? get lastError => _lastError;

  Process? _proc;

  static const _binDirName = 'bin';
  static const _configDirName = 'config';
  static const _singboxExe = 'sing-box.exe';
  static const _wintunDll = 'wintun.dll';
  static const _configFileName = 'current.json';

  /// Папка `%LOCALAPPDATA%\HundlerVPN\` (сама создаётся при первом
  /// `getApplicationSupportDirectory()` — Flutter настраивает её
  /// под bundle ID `com.hundlervpn.hundler`).
  Future<Directory> _appRoot() async {
    final dir = await pp.getApplicationSupportDirectory();
    if (!await dir.exists()) await dir.create(recursive: true);
    return dir;
  }

  Future<Directory> _binDir() async {
    final root = await _appRoot();
    final d = Directory('${root.path}${Platform.pathSeparator}$_binDirName');
    if (!await d.exists()) await d.create(recursive: true);
    return d;
  }

  Future<Directory> _configDir() async {
    final root = await _appRoot();
    final d = Directory(
        '${root.path}${Platform.pathSeparator}$_configDirName');
    if (!await d.exists()) await d.create(recursive: true);
    return d;
  }

  /// Путь к sing-box.exe. Файл может НЕ существовать — нужно проверить
  /// через [hasBinaries] перед запуском.
  Future<File> _singboxFile() async {
    final bin = await _binDir();
    return File('${bin.path}${Platform.pathSeparator}$_singboxExe');
  }

  Future<File> _wintunFile() async {
    final bin = await _binDir();
    return File('${bin.path}${Platform.pathSeparator}$_wintunDll');
  }

  /// `true` если sing-box.exe и wintun.dll есть в bin/.
  ///
  /// Если их нет в `%APPDATA%\com.hundlervpn\hundler\bin\` — пытаемся
  /// автоматически скопировать из bundled-папки, которая лежит рядом
  /// с `hundler.exe` (см. `_bootstrapBundledBinaries`). Это даёт
  /// "распаковал zip — запустил — всё работает" UX без installer'a.
  Future<bool> hasBinaries() async {
    final sb = await _singboxFile();
    final wt = await _wintunFile();
    if (await sb.exists() && await wt.exists()) return true;
    await _bootstrapBundledBinaries();
    return await sb.exists() && await wt.exists();
  }

  /// Копирует sing-box.exe + wintun.dll из bundled-папки `<exe-dir>/bin/`
  /// в `%APPDATA%\com.hundlervpn\hundler\bin\` если их там ещё нет.
  ///
  /// Bundled-папка создаётся CI-workflow'ом `release-windows.yml` при
  /// сборке GitHub Release: скачивает sing-box и wintun официальных
  /// сборок и кладёт рядом с `hundler.exe` в zip-артефакте.
  ///
  /// Если папки `bin/` рядом с exe нет (например dev-сборка через
  /// `flutter run`) — функция тихо завершается, UI всё равно покажет
  /// плашку "положите бинари сами".
  Future<void> _bootstrapBundledBinaries() async {
    try {
      final exeDir = File(Platform.resolvedExecutable).parent;
      final bundledBin =
          Directory('${exeDir.path}${Platform.pathSeparator}$_binDirName');
      if (!await bundledBin.exists()) return;

      final dstBin = await _binDir();
      for (final name in const [_singboxExe, _wintunDll]) {
        final src = File('${bundledBin.path}${Platform.pathSeparator}$name');
        final dst = File('${dstBin.path}${Platform.pathSeparator}$name');
        if (await src.exists() && !await dst.exists()) {
          await src.copy(dst.path);
        }
      }
    } catch (_) {
      // Молча игнорируем — UI всё равно покажет плашку "скачайте
      // бинари сами" если файлов нет в %APPDATA%.
    }
  }

  /// Куда положить бинари руками. UI показывает этот путь юзеру
  /// в плашке "Скачайте sing-box.exe и wintun.dll и положите в эту папку".
  Future<String> binDirPath() async => (await _binDir()).path;

  /// Запустить туннель.
  ///
  /// [configJson] — sing-box JSON из `/api/sub/{token}`.
  /// На любой ошибке — выставляется `status = error` и `lastError`,
  /// возвращается `false`.
  Future<bool> start({required String configJson}) async {
    if (_status == VpnStatus.connected || _status == VpnStatus.connecting) {
      return true;
    }
    _setStatus(VpnStatus.connecting);

    if (!await hasBinaries()) {
      _setError(
        'sing-box.exe или wintun.dll не найдены в '
        '${await binDirPath()}. См. инструкцию в README.',
      );
      return false;
    }

    // КРИТИЧНО: проверка целостности sing-box.exe и wintun.dll. Если
    // кто-то подменил бинарь — отказываемся запускать. Подмена опасна
    // тем что VPN-процесс наследует admin-токен (см. UAC manifest),
    // и malware-копия sing-box.exe может слить trafic / sub_token /
    // открыть TUN с MITM-сертификатом.
    final integrityErr = await BinaryIntegrity.verifyAll([
      await _singboxFile(),
      await _wintunFile(),
    ]);
    if (integrityErr != null) {
      _setError(integrityErr);
      return false;
    }

    // Чистим висящие sing-box.exe процессы от предыдущих неудачных
    // запусков. Без этого второй запуск падает с
    // `configure tun interface: Cannot create a file when that file
    // already exists` — wintun-адаптер «Hundler» залочен старым
    // процессом sing-box.
    await _killStaleSingboxProcesses();

    // 1. Записать конфиг на диск.
    final configFile = File(
        '${(await _configDir()).path}${Platform.pathSeparator}$_configFileName');
    try {
      await configFile.writeAsString(configJson, flush: true);
    } catch (e) {
      _setError('Не удалось записать конфиг: $e');
      return false;
    }

    // 2. Запустить sing-box.exe run -c <config>.
    //    `run` блокирующий — sing-box живёт пока его не убьют.
    //    UAC elevation гарантируется через manifest
    //    (`windows/runner/runner.exe.manifest` + linker flag
    //    /MANIFESTUAC:level='requireAdministrator') — child-процесс
    //    sing-box наследует admin-токен родителя.
    final exe = (await _singboxFile()).path;
    try {
      _proc = await Process.start(
        exe,
        ['run', '-c', configFile.path, '-D', (await _appRoot()).path],
        // Важно: workingDirectory = bin/, чтобы sing-box нашёл
        // wintun.dll рядом с собой через LoadLibrary.
        workingDirectory: (await _binDir()).path,
        runInShell: false,
        environment: {
          // sing-box 1.12+ deprecate-ит две вещи в DNS/route которые
          // активно использует наш бэкенд (`app/api/sub/[token]/route.ts`
          // `buildSingboxConfig`):
          //
          // 1) `outbound`-rule items в DNS правилах — старый способ
          //    выбора DNS-сервера по outbound-tag. Новый =
          //    `domain_resolver` в outbound-dial-fields.
          //
          // 2) Отсутствие `route.default_domain_resolver` или
          //    `domain_resolver` в dial fields outbound'а — раньше
          //    sing-box неявно делал DNS через `dns-direct`, теперь
          //    требует явного указания.
          //
          // Обе фичи убираются в sing-box 1.14. Пока бэкенд не
          // мигрирован — включаем legacy-режим через env-переменные.
          // См. https://sing-box.sagernet.org/migration/#migrate-outbound-dns-rule-items-to-domain-resolver
          'ENABLE_DEPRECATED_OUTBOUND_DNS_RULE_ITEM': 'true',
          'ENABLE_DEPRECATED_MISSING_DOMAIN_RESOLVER': 'true',
        },
        // Используем pipe чтобы читать stdout/stderr и логировать
        // ошибки sing-box ("operation not permitted" / "address in use").
        mode: ProcessStartMode.normal,
      );
    } catch (e) {
      _setError('Не удалось запустить sing-box.exe: $e');
      return false;
    }

    final proc = _proc!;

    // Буфер последних N stderr-строк — используется в exitCode-handler
    // ниже чтобы показать реальную причину падения вместо общего
    // «возможно нет прав админа».
    final stderrTail = <String>[];

    // Слушаем stdout/stderr — это важно для диагностики.
    proc.stdout.transform(utf8.decoder).listen((line) {
      // ignore: avoid_print
      print('[singbox.stdout] $line');
    });
    proc.stderr.transform(utf8.decoder).listen((line) {
      // ignore: avoid_print
      print('[singbox.stderr] $line');
      // Запомним последние 10 строк stderr для error report.
      stderrTail.add(line.trim());
      if (stderrTail.length > 10) stderrTail.removeAt(0);
      // sing-box пишет в stderr "INFO inbound/tun ... started" когда
      // адаптер поднялся. Это самый надёжный сигнал что мы connected.
      if (_status == VpnStatus.connecting &&
          (line.contains('tun started') ||
              line.contains('mixed inbound started') ||
              line.contains('started'))) {
        _setStatus(VpnStatus.connected);
      }
    });

    // Если sing-box упадёт сам — exitCode придёт быстро, показываем
    // реальную причину из stderr (последняя FATAL/ERROR строка),
    // а не общее «возможно нет прав админа».
    unawaited(proc.exitCode.then((code) {
      _proc = null;
      if (_status == VpnStatus.connecting) {
        final lastFatal = stderrTail.reversed.firstWhere(
          (l) => l.contains('FATAL') || l.contains('ERROR'),
          orElse: () => stderrTail.isNotEmpty ? stderrTail.last : '',
        );
        final reason = lastFatal.isEmpty
            ? 'неизвестная ошибка (нет stderr)'
            : lastFatal;
        _setError('sing-box завершился с кодом $code:\n$reason');
      } else if (_status == VpnStatus.connected) {
        // Внезапная смерть процесса — возвращаемся в disconnected.
        _setStatus(VpnStatus.disconnected);
      }
    }));

    // Дадим sing-box ~3 секунды чтобы поднять inbound. Если за это
    // время в stderr не пришла строка "started" — считаем что
    // соединение всё-таки удалось (некоторые версии sing-box не
    // пишут такую строку, но процесс жив).
    await Future<void>.delayed(const Duration(seconds: 3));
    if (_status == VpnStatus.connecting && _proc != null) {
      _setStatus(VpnStatus.connected);
    }

    // КРИТИЧНО для безопасности: после старта sing-box уже распарсил
    // конфиг в память — файл `current.json` больше НЕ нужен. Удаляем
    // его потому что он содержит **UUID юзера** (== личный VPN-key)
    // и server_name + reality public_key в plain JSON. Если malware
    // под этим же user-аккаунтом сольёт файл — атакующий получит
    // полный доступ к VPN-серверу от имени юзера.
    //
    // При следующем connect SubscriptionRepository всегда тянет
    // свежий конфиг с бэкенда — потеря локального файла не критична.
    //
    // Делаем secure-delete: перезаписываем нулями ПЕРЕД удалением.
    // На SSD это технически не гарантирует физическое удаление
    // (wear-leveling), но защищает от наивной recovery.
    if (_status == VpnStatus.connected) {
      unawaited(_secureDeleteConfig(configFile));
    }

    return _status == VpnStatus.connected;
  }

  /// Остановить туннель.
  Future<void> stop() async {
    final proc = _proc;
    if (proc == null) {
      _setStatus(VpnStatus.disconnected);
      return;
    }
    try {
      // taskkill убивает ВСЁ дерево процессов (`/T`) и принудительно (`/F`).
      // sing-box.exe может породить wintun-adapter helper'ы — их тоже надо
      // снести.
      await Process.run(
        'taskkill',
        ['/T', '/F', '/PID', '${proc.pid}'],
        runInShell: false,
      );
    } catch (_) {
      // Запасной путь — kill через Process.kill().
      try {
        proc.kill(ProcessSignal.sigkill);
      } catch (_) {}
    }
    _proc = null;
    _setStatus(VpnStatus.disconnected);

    // Безопасность: если конфиг почему-то остался — удалим. Это
    // дублирует secure-delete после старта (на случай сбоя там).
    try {
      final f = File(
          '${(await _configDir()).path}${Platform.pathSeparator}$_configFileName');
      await _secureDeleteConfig(f);
    } catch (_) {}
  }

  /// Secure-delete файла конфига после старта sing-box.
  ///
  /// 1. Перезаписываем содержимое нулями того же размера → если кто-то
  ///    параллельно читает inode, увидит мусор.
  /// 2. Удаляем файл.
  ///
  /// На SSD wear-leveling может физически сохранить старые блоки —
  /// для **полной** anti-forensics-защиты нужно FILE_FLAG_NO_BUFFERING
  /// через win32 FFI. Этого MVP-уровня достаточно от наивной recovery
  /// и от другого процесса, читающего файл в момент удаления.
  Future<void> _secureDeleteConfig(File file) async {
    try {
      if (!await file.exists()) return;
      final len = await file.length();
      // Перезаписываем нулями того же размера, чтобы NTFS не выделил
      // новый sector (in-place overwrite).
      await file.writeAsBytes(List<int>.filled(len, 0), flush: true);
      await file.delete();
    } catch (_) {
      // Не критично — следующий start() перезапишет, secure_delete
      // best-effort.
    }
  }

  /// Убивает все висящие `sing-box.exe` процессы перед стартом нового.
  ///
  /// **Зачем**: если предыдущий запуск упал с FATAL (например DNS-
  /// timeout или legacy inbound fields), процесс может остаться в
  /// памяти удерживая wintun TUN-адаптер `Hundler`. Новый sing-box
  /// тогда падает с `configure tun interface: Cannot create a file
  /// when that file already exists`.
  ///
  /// Также после kill ждём 800мс — wintun драйверу нужно время чтобы
  /// освободить адаптер из реестра (`HKLM\SYSTEM\CurrentControlSet\
  /// Services\Wintun\Adapters\`) и из network stack.
  ///
  /// Игнорируем все ошибки: `taskkill` возвращает exitCode 128 если
  /// процессов нет — это нормально.
  Future<void> _killStaleSingboxProcesses() async {
    try {
      await Process.run(
        'taskkill',
        ['/F', '/IM', _singboxExe, '/T'],
        runInShell: false,
      );
    } catch (_) {/* not critical */}
    // wintun adapter cleanup delay.
    await Future<void>.delayed(const Duration(milliseconds: 800));
  }

  void _setStatus(VpnStatus s) {
    _status = s;
    _lastError = null;
    _statusController.add(s);
  }

  void _setError(String msg) {
    _lastError = msg;
    _status = VpnStatus.error;
    _statusController.add(VpnStatus.error);
    // ignore: avoid_print
    print('[VpnService] ERROR: $msg');
  }

  void dispose() {
    stop();
    _statusController.close();
  }
}
