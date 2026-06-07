import 'dart:async';
import 'dart:convert';
import 'dart:ffi';
import 'dart:io';
import 'dart:typed_data';

import 'package:ffi/ffi.dart';
import 'package:path_provider/path_provider.dart' as pp;
import 'package:win32/win32.dart';

/// **DPAPI-backed key/value store** — наш собственный аналог
/// `FlutterSecureStorage` для Windows. Используем вместо официального
/// плагина потому что `flutter_secure_storage_windows` требует ATL/MFC
/// компонента Visual Studio Build Tools, которого у большинства dev-машин
/// нет — и сборка падает с `atlstr.h: No such file`.
///
/// Реализация:
///
/// - Все ключи лежат в одном файле `secure_store.bin` внутри
///   `getApplicationSupportDirectory()`
///   (`%APPDATA%\com.hundlervpn.hundler\hundler\`).
/// - Файл — это JSON-blob, целиком зашифрованный через
///   [CryptProtectData] (DPAPI, привязка к user-аккаунту Windows).
/// - В памяти держим расшифрованный [_cache] чтобы read был O(1).
/// - Все мутации делают `encrypt + write` сразу — синхронная durability
///   важнее производительности (в нашем случае это десятки байт раз в
///   несколько минут).
///
/// Безопасность совпадает с `flutter_secure_storage`:
/// - Содержимое нечитаемо для других user-аккаунтов на той же машине.
/// - При пересоздании user-учётки Windows DPAPI откажет — `_ensureLoaded`
///   увидит исключение и стартует с пустым кешем (юзер просто перелогинится).
/// - Файл лежит в user-only-readable папке (NTFS ACL по умолчанию).
///
/// Эта реализация **не** thread-safe для multi-process — но Flutter
/// Desktop запускает один процесс на пользователя, так что это
/// не проблема.
class SecureStorage {
  SecureStorage._();

  /// Singleton — один файл на всё приложение.
  static final SecureStorage instance = SecureStorage._();

  static const String _fileName = 'secure_store.bin';

  /// Расшифрованный кеш. `null` до первого `_ensureLoaded()`.
  Map<String, String>? _cache;

  /// Async mutex — защищает _ensureLoaded() от race condition при
  /// одновременном вызове из разных Future'ов на старте.
  final _initLock = _AsyncMutex();

  Future<File> _file() async {
    final dir = await pp.getApplicationSupportDirectory();
    if (!await dir.exists()) await dir.create(recursive: true);
    return File('${dir.path}${Platform.pathSeparator}$_fileName');
  }

  Future<void> _ensureLoaded() async {
    if (_cache != null) return;
    await _initLock.run(() async {
      if (_cache != null) return;
      final f = await _file();
      if (!await f.exists()) {
        _cache = <String, String>{};
        return;
      }
      try {
        final cipher = await f.readAsBytes();
        if (cipher.isEmpty) {
          _cache = <String, String>{};
          return;
        }
        final plain = _dpapiDecrypt(cipher);
        final json =
            jsonDecode(utf8.decode(plain)) as Map<String, dynamic>;
        _cache = json.map((k, v) => MapEntry(k, v.toString()));
      } catch (e) {
        // ignore: avoid_print
        print('[SecureStorage] failed to load: $e — starting with empty cache');
        _cache = <String, String>{};
      }
    });
  }

  Future<void> _persist() async {
    final cache = _cache ?? <String, String>{};
    final plain = utf8.encode(jsonEncode(cache));
    final cipher = _dpapiEncrypt(plain);
    final f = await _file();
    await f.writeAsBytes(cipher, flush: true);
  }

  /// Прочитать значение по ключу (`null` если ключа нет).
  Future<String?> read({required String key}) async {
    await _ensureLoaded();
    return _cache?[key];
  }

  /// Записать значение. Сразу же persistится.
  Future<void> write({required String key, required String value}) async {
    await _ensureLoaded();
    _cache![key] = value;
    await _persist();
  }

  /// Удалить ключ.
  Future<void> delete({required String key}) async {
    await _ensureLoaded();
    if (_cache!.remove(key) != null) {
      await _persist();
    }
  }

  /// Полный wipe — стираем файл и кеш.
  Future<void> deleteAll() async {
    _cache = <String, String>{};
    final f = await _file();
    if (await f.exists()) {
      try {
        await f.delete();
      } catch (_) {
        // Файл занят/недоступен — не критично, persist перезапишет.
      }
    }
  }

  // ============================ DPAPI ============================
  //
  // CryptProtectData / CryptUnprotectData с дефолтным entropy и нулевыми
  // flags — это самый простой и кросс-Windows-стабильный режим.
  // CRYPTPROTECT_LOCAL_MACHINE можно было бы добавить чтобы шифровать
  // ключом машины (тогда secrets читались бы любым user-аккаунтом этой
  // машины) — но нам это НЕ нужно, мы хотим именно per-user privacy.

  /// Шифруем utf8-байты → DPAPI ciphertext bytes.
  Uint8List _dpapiEncrypt(List<int> plaintext) {
    final inBlob = calloc<CRYPT_INTEGER_BLOB>();
    final inBuf = calloc<Uint8>(plaintext.length);
    final outBlob = calloc<CRYPT_INTEGER_BLOB>();
    try {
      for (var i = 0; i < plaintext.length; i++) {
        inBuf[i] = plaintext[i];
      }
      inBlob.ref.cbData = plaintext.length;
      inBlob.ref.pbData = inBuf;

      final ok = CryptProtectData(
        inBlob,
        nullptr, // szDataDescr
        nullptr, // pOptionalEntropy
        nullptr, // pvReserved
        nullptr, // pPromptStruct
        0,       // dwFlags
        outBlob,
      );
      if (ok == 0) {
        final err = GetLastError();
        throw StateError(
            'CryptProtectData failed (Win32 GetLastError=$err)');
      }
      final len = outBlob.ref.cbData;
      final src = outBlob.ref.pbData;
      final result = Uint8List(len);
      for (var i = 0; i < len; i++) {
        result[i] = src[i];
      }
      // pbData выделена системой через LocalAlloc — освобождаем LocalFree.
      LocalFree(src.cast());
      return result;
    } finally {
      calloc.free(inBuf);
      calloc.free(inBlob);
      calloc.free(outBlob);
    }
  }

  /// DPAPI ciphertext bytes → utf8 plaintext bytes.
  Uint8List _dpapiDecrypt(Uint8List cipher) {
    final inBlob = calloc<CRYPT_INTEGER_BLOB>();
    final inBuf = calloc<Uint8>(cipher.length);
    final outBlob = calloc<CRYPT_INTEGER_BLOB>();
    try {
      for (var i = 0; i < cipher.length; i++) {
        inBuf[i] = cipher[i];
      }
      inBlob.ref.cbData = cipher.length;
      inBlob.ref.pbData = inBuf;

      final ok = CryptUnprotectData(
        inBlob,
        nullptr, // ppszDataDescr
        nullptr, // pOptionalEntropy
        nullptr, // pvReserved
        nullptr, // pPromptStruct
        0,       // dwFlags
        outBlob,
      );
      if (ok == 0) {
        final err = GetLastError();
        throw StateError(
            'CryptUnprotectData failed (Win32 GetLastError=$err)');
      }
      final len = outBlob.ref.cbData;
      final src = outBlob.ref.pbData;
      final result = Uint8List(len);
      for (var i = 0; i < len; i++) {
        result[i] = src[i];
      }
      LocalFree(src.cast());
      return result;
    } finally {
      calloc.free(inBuf);
      calloc.free(inBlob);
      calloc.free(outBlob);
    }
  }
}

/// Простой async-mutex для сериализации записей.
class _AsyncMutex {
  Completer<void>? _busy;

  Future<T> run<T>(Future<T> Function() body) async {
    while (_busy != null) {
      await _busy!.future;
    }
    final c = Completer<void>();
    _busy = c;
    try {
      return await body();
    } finally {
      _busy = null;
      c.complete();
    }
  }
}
