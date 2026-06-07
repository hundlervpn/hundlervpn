import 'dart:io';

import 'package:crypto/crypto.dart';
import 'package:dio/dio.dart';
import 'package:path_provider/path_provider.dart';

import 'update_checker.dart';

/// In-app installer для обновлений Windows-клиента.
///
/// **Сценарий "юзер увидел баннер → нажал Обновить"**:
///
/// 1. Скачиваем installer.exe из [UpdateInfo.url] в `%TEMP%`,
///    показываем прогресс через [onProgress] (0.0 → 1.0).
/// 2. Если [UpdateInfo.sha256] не пустой — проверяем хеш скачанного
///    файла. Не совпало → возвращаем [UpdateInstallResult.checksumFailed].
///    Это страховка от corrupt-download / MITM на пути к GitHub.
/// 3. Запускаем installer с флагами:
///    ```
///    /SILENT              — wizard молча, только progress bar
///    /CLOSEAPPLICATIONS   — закрыть hundler.exe перед обновлением
///    /RESTARTAPPLICATIONS — после установки запустить hundler.exe
///                          снова (мы сейчас как раз закроемся)
///    /NORESTART           — не предлагать ребут Windows
///    ```
/// 4. Сразу `exit(0)` — наш hundler.exe выходит, installer
///    перехватывает control, обновляет файлы, запускает новый
///    hundler.exe из обновлённой папки.
///
/// Если на любом шаге упало — возвращаем понятный enum, UI показывает
/// сообщение, юзер может попробовать ещё раз или скачать вручную.
class UpdateInstaller {
  UpdateInstaller._();
  static final UpdateInstaller instance = UpdateInstaller._();

  /// Запускает полный flow обновления. Возвращает результат — но
  /// если вернётся [UpdateInstallResult.launched], `exit(0)` уже
  /// выстрелил, эта строчка вообще не достижима.
  Future<UpdateInstallResult> downloadAndInstall(
    UpdateInfo info, {
    void Function(double progress)? onProgress,
  }) async {
    File? downloaded;
    try {
      downloaded = await _download(info, onProgress: onProgress);
    } on DioException catch (e) {
      return UpdateInstallResult.networkError(
        'Не удалось скачать обновление: ${e.message ?? e.type.name}',
      );
    } catch (e) {
      return UpdateInstallResult.networkError(
        'Не удалось скачать обновление: $e',
      );
    }

    // Verify SHA256, если бэкенд прислал. Если не прислал (null) —
    // пропускаем (доверяем GitHub HTTPS), но логируем warning.
    if (info.sha256 != null && info.sha256!.isNotEmpty) {
      final ok = await _verifyChecksum(downloaded, info.sha256!);
      if (!ok) {
        // Удаляем подозрительный файл — не оставляем его в %TEMP%.
        try {
          await downloaded.delete();
        } catch (_) {}
        return const UpdateInstallResult.checksumFailed();
      }
    }

    // Запускаем installer detached. `Process.start` с
    // `ProcessStartMode.detached` — родительский hundler.exe может
    // умереть, installer переживёт.
    try {
      await Process.start(
        downloaded.path,
        const [
          '/SILENT',
          '/CLOSEAPPLICATIONS',
          '/RESTARTAPPLICATIONS',
          '/NORESTART',
          '/SUPPRESSMSGBOXES',
        ],
        mode: ProcessStartMode.detached,
        runInShell: false,
      );
    } catch (e) {
      return UpdateInstallResult.launchError(
        'Не удалось запустить установщик: $e',
      );
    }

    // Дать installer'у пару сотен мс — иначе если мы exit(0) сразу,
    // detached child иногда не успевает прицепиться к нашему PID и
    // умирает вместе с нами на некоторых сборках Windows.
    await Future<void>.delayed(const Duration(milliseconds: 600));

    // Выходим. Inno Setup `/CLOSEAPPLICATIONS` тоже бы нас прибил, но
    // лучше выйти штатно — VpnService.dispose() остановит sing-box.exe
    // через taskkill (см. main.dart::onWindowClose).
    exit(0);
  }

  Future<File> _download(
    UpdateInfo info, {
    void Function(double progress)? onProgress,
  }) async {
    final tmpDir = await getTemporaryDirectory();
    final fileName = _filenameFromUrl(info.url) ??
        'HundlerVPN-Setup-${info.latestVersion}.exe';
    final dst = File('${tmpDir.path}${Platform.pathSeparator}$fileName');

    // Если файл уже скачан и его хеш совпадает — переиспользуем.
    if (await dst.exists() &&
        info.sha256 != null &&
        info.sha256!.isNotEmpty) {
      if (await _verifyChecksum(dst, info.sha256!)) {
        onProgress?.call(1.0);
        return dst;
      }
      // Хеш не совпал — выкидываем старый частичный файл.
      try {
        await dst.delete();
      } catch (_) {}
    }

    final dio = Dio(BaseOptions(
      connectTimeout: const Duration(seconds: 15),
      receiveTimeout: const Duration(minutes: 5),
      // GitHub отдаёт installer через раздельный CDN
      // (`objects.githubusercontent.com`) — он медленнее чем сам
      // api.github.com, поэтому таймауты щедрые.
      followRedirects: true,
      maxRedirects: 5,
    ));

    await dio.download(
      info.url,
      dst.path,
      onReceiveProgress: (received, total) {
        if (total <= 0) return;
        onProgress?.call(received / total);
      },
      options: Options(
        responseType: ResponseType.bytes,
        // GitHub Releases требует User-Agent, иначе может вернуть 403.
        headers: {
          'User-Agent': 'HundlerVPN-Updater',
          'Accept': 'application/octet-stream',
        },
      ),
    );

    return dst;
  }

  Future<bool> _verifyChecksum(File file, String expectedHex) async {
    try {
      final digest = await file.openRead().transform(sha256).single;
      final actual = digest.toString().toLowerCase();
      return actual == expectedHex.toLowerCase();
    } catch (_) {
      return false;
    }
  }

  String? _filenameFromUrl(String url) {
    try {
      final uri = Uri.parse(url);
      if (uri.pathSegments.isEmpty) return null;
      final last = uri.pathSegments.last;
      // Sanity check — не позволяем traversal'ом пробраться куда-нибудь
      // ещё. Имя файла не должно содержать `/` `\` `..`
      if (last.contains('/') ||
          last.contains('\\') ||
          last.contains('..')) {
        return null;
      }
      return last;
    } catch (_) {
      return null;
    }
  }
}

/// Результат попытки обновления.
sealed class UpdateInstallResult {
  const UpdateInstallResult();

  /// Установщик успешно запущен, hundler.exe сейчас умрёт. Это значение
  /// в реальности недостижимо (после него exit(0)), но нужно для
  /// строгой типизации.
  const factory UpdateInstallResult.launched() = _Launched;

  /// Сеть отвалилась / файл не нашёлся / GitHub вернул 5xx.
  const factory UpdateInstallResult.networkError(String message) =
      _NetworkError;

  /// SHA256 скачанного файла не совпал с ожидаемым. Это серьёзно —
  /// либо MITM, либо corrupt download. Не запускаем такой installer.
  const factory UpdateInstallResult.checksumFailed() = _ChecksumFailed;

  /// Скачали успешно, но `Process.start` упал. Обычно — антивирус
  /// удалил installer пока мы ему доверяли.
  const factory UpdateInstallResult.launchError(String message) =
      _LaunchError;

  String get userMessage => switch (this) {
        _Launched() => 'Запуск установщика…',
        _NetworkError(message: final m) => m,
        _ChecksumFailed() =>
          'Файл обновления повреждён или подменён. Попробуйте ещё раз '
              'или скачайте установщик с сайта.',
        _LaunchError(message: final m) =>
          'Не удалось запустить установщик: $m. Возможно, антивирус '
              'заблокировал файл.',
      };
}

class _Launched extends UpdateInstallResult {
  const _Launched();
}

class _NetworkError extends UpdateInstallResult {
  const _NetworkError(this.message);
  final String message;
}

class _ChecksumFailed extends UpdateInstallResult {
  const _ChecksumFailed();
}

class _LaunchError extends UpdateInstallResult {
  const _LaunchError(this.message);
  final String message;
}
