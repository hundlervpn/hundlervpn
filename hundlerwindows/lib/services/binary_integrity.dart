import 'dart:io';

import 'package:crypto/crypto.dart';

/// Проверка целостности нативных бинарей (`sing-box.exe`, `wintun.dll`)
/// перед запуском VPN.
///
/// **Зачем нужно**: бинари лежат в `%APPDATA%\com.hundlervpn\hundler\bin\`,
/// в папке доступной на запись текущему юзеру. Атакующий с локальным
/// доступом (вирус, malware-хуйня которая повышает права через UAC
/// bypass) может **подменить** `sing-box.exe` на свою копию которая:
///   - сливает sub_token в C&C,
///   - подменяет VLESS-сервер на MITM,
///   - инжектит трафик в обход VPN.
///
/// Поскольку на момент запуска `sing-box.exe` мы УЖЕ elevated через
/// UAC manifest, malware-исполняемый файл получит admin-токен —
/// последствия катастрофические (TUN-driver, raw socket, всё что
/// угодно).
///
/// **Решение**: перед каждым `vpn.start()` пересчитываем SHA-256 от
/// `sing-box.exe` и `wintun.dll`, сравниваем с захардкоженными
/// эталонами (см. [_expectedSha256]). Если хоть один не совпадает —
/// VPN не стартует, юзер видит ошибку «Бинарник изменён или повреждён,
/// переустановите Hundler VPN».
///
/// **Эталоны** считаются на CI при сборке релиза — для текущей
/// версии sing-box 1.13.11 windows-amd64 (release zip с
/// github.com/SagerNet/sing-box) и wintun 0.14.1 (wintun.net).
/// При обновлении бинарей **обязательно** пересчитать хэши и
/// зафиксировать новые значения здесь — иначе после auto-update VPN
/// перестанет запускаться.
///
/// **Защита эталонов** от подмены кода: можно перенести таблицу в
/// подписанный manifest на бэкенде (`GET /api/binaries/manifest`,
/// HMAC-подпись на shared secret) — TODO для будущей версии. Сейчас
/// эталоны живут в коде → атакующий с правом записи на exe может
/// одновременно подменить и `hundler.exe` (со старыми хэшами на свои).
/// Защита от этого — Authenticode-подпись `hundler.exe` (см. memory
/// `hundlerwindows` → security checklist). Сейчас exe не подписан,
/// поэтому MVP-проверка спасает только от случайной подмены, не от
/// целевой атаки.
class BinaryIntegrity {
  BinaryIntegrity._();

  /// Эталонные хэши. Ключ = имя файла в `bin/`, значение = SHA-256 hex.
  ///
  /// **При обновлении бинарей пересчитать**:
  /// ```powershell
  /// (Get-FileHash "$env:APPDATA\com.hundlervpn\hundler\bin\sing-box.exe"
  ///   -Algorithm SHA256).Hash.ToLower()
  /// ```
  static const Map<String, String> _expectedSha256 = {
    // sing-box 1.13.11 windows-amd64 (release zip,
    // https://github.com/SagerNet/sing-box/releases/tag/v1.13.11)
    'sing-box.exe':
        'd8ef05b096347b1dc22b22d9b19808f7d20b518422b7e1bc3ff10afb64418470',
    // wintun 0.14.1 amd64 (https://www.wintun.net/builds/wintun-0.14.1.zip)
    'wintun.dll':
        'e5da8447dc2c320edc0fc52fa01885c103de8c118481f683643cacc3220dafce',
  };

  /// Проверяет целостность одного файла. Возвращает `null` если всё ок,
  /// либо текст ошибки для UI ("Бинарник X изменён…").
  static Future<String?> verify(File file) async {
    final name = file.uri.pathSegments.last;
    final expected = _expectedSha256[name];
    if (expected == null) {
      // Неизвестный файл — не проверяем, но и не валим. На всякий
      // случай пишем в лог для дебага.
      // ignore: avoid_print
      print('[BinaryIntegrity] Skip $name: no known hash');
      return null;
    }

    if (!await file.exists()) {
      return 'Файл $name не найден по пути ${file.path}';
    }

    final actual = await _sha256Hex(file);
    if (actual.toLowerCase() == expected.toLowerCase()) {
      return null;
    }
    // Не показываем юзеру actual-хэш — это утечка информации
    // которая помогает атакующему подгонять подменённый файл.
    // ignore: avoid_print
    print(
        '[BinaryIntegrity] HASH MISMATCH for $name: expected $expected, got $actual');
    return 'Файл $name изменён или повреждён. Переустановите Hundler VPN.';
  }

  /// Проверяет сразу несколько файлов. Возвращает первую ошибку,
  /// либо `null` если все OK.
  static Future<String?> verifyAll(Iterable<File> files) async {
    for (final f in files) {
      final err = await verify(f);
      if (err != null) return err;
    }
    return null;
  }

  /// Стримовый SHA-256 — читаем файл блоками, не грузим весь в память.
  /// Для sing-box.exe (~45 МБ) это критично на машинах с малым RAM.
  static Future<String> _sha256Hex(File file) async {
    final digest = await file.openRead().transform(sha256).single;
    return digest.toString();
  }
}
