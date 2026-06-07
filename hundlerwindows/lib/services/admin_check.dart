import 'dart:async';
import 'dart:ffi';
import 'dart:io';

import 'package:ffi/ffi.dart';
import 'package:win32/win32.dart';

/// Утилиты для проверки и получения admin-прав на Windows.
///
/// **Зачем нужно**: sing-box.exe в TUN-режиме требует admin (создаёт
/// wintun-адаптер через `\\.\WINTUN`, что без admin не работает).
/// Если приложение запущено как обычный user, sing-box падает с
/// "operation not permitted" сразу после старта.
///
/// **Решение MVP** — просим юзера перезапустить Hundler VPN от имени
/// администратора через UAC. Альтернатива (helper-сервис под
/// LocalSystem) — 2-я итерация, см. WINDOWS-AGENTS.md секция «План
/// helper-service».
///
/// Реализация:
///
/// 1. [isElevated] — `OpenProcessToken(GetCurrentProcess())` →
///    `GetTokenInformation(TokenElevation = 20)`. Если `TokenIsElevated`
///    DWORD равно 1 — мы admin.
///
/// 2. [relaunchAsAdmin] — `ShellExecuteExW` с `lpVerb = "runas"`.
///    Windows показывает UAC-диалог, и если юзер согласен — стартует
///    новый процесс exe с admin-токеном. Текущий процесс должен сам
///    завершиться (вызывающая сторона делает `windowManager.close()`).
///
/// Используем raw FFI с явными числовыми константами вместо
/// type-aliased структур из `package:win32` — это устойчиво к
/// переименованиям в minor-версиях win32 5.x (которые случались уже
/// дважды и ломали компиляцию).
class AdminCheck {
  AdminCheck._();

  // TOKEN_INFORMATION_CLASS::TokenElevation
  static const int _tokenElevation = 20;

  // ShellExecuteExW flags
  static const int _seeMaskNoCloseProcess = 0x00000040;

  // Window show state
  static const int _swShowNormal = 1;

  /// `true` если текущий процесс запущен с admin-токеном (elevated).
  ///
  /// Безопасный fallback: при любой ошибке возвращаем `true` — лучше
  /// **не** показывать пользователю плашку «нет прав», чем показать её
  /// зря (если плашка покажется в admin-режиме — выглядит дёшево).
  static Future<bool> isElevated() async {
    if (!Platform.isWindows) return true;
    try {
      final hProcess = GetCurrentProcess();
      final phToken = calloc<HANDLE>();
      try {
        final ok = OpenProcessToken(hProcess, TOKEN_QUERY, phToken);
        if (ok == 0) return true;
        final hToken = phToken.value;
        try {
          // TOKEN_ELEVATION = struct { DWORD TokenIsElevated; }
          final pElevation = calloc<DWORD>();
          final pReturn = calloc<DWORD>();
          try {
            final got = GetTokenInformation(
              hToken,
              _tokenElevation,
              pElevation.cast(),
              sizeOf<DWORD>(),
              pReturn,
            );
            if (got == 0) return true;
            return pElevation.value != 0;
          } finally {
            calloc.free(pElevation);
            calloc.free(pReturn);
          }
        } finally {
          CloseHandle(hToken);
        }
      } finally {
        calloc.free(phToken);
      }
    } catch (_) {
      return true;
    }
  }

  /// Запросить у Windows перезапуск текущего exe с UAC-elevation.
  ///
  /// Поведение:
  ///   - **success** → возвращает `true`. UAC показал prompt, юзер
  ///     согласился, новая копия exe уже запущена. Caller должен
  ///     закрыть текущий процесс (`windowManager.close()` или
  ///     `exit(0)`).
  ///   - **cancel** → юзер нажал «Нет» в UAC. `false`. Caller
  ///     остаётся в работе как user.
  ///   - **error** → не Windows / win32 баг. `false`.
  ///
  /// Реализация — `ShellExecuteExW`. Структуру `SHELLEXECUTEINFOW`
  /// собираем как «чистый» байтовый буфер с правильными смещениями,
  /// чтобы не зависеть от того в каком namespace `package:win32` её
  /// держит на конкретной minor-версии.
  static Future<bool> relaunchAsAdmin({List<String>? args}) async {
    if (!Platform.isWindows) return false;
    try {
      final exe = Platform.resolvedExecutable;
      final arguments = (args ?? const <String>[]).join(' ');

      final lpVerb = TEXT('runas');
      final lpFile = TEXT(exe);
      final lpParams = arguments.isEmpty ? nullptr : TEXT(arguments);
      final lpDir = TEXT(File(exe).parent.path);

      // SHELLEXECUTEINFOW layout (x64, packed по умолчанию):
      //   DWORD     cbSize        @ 0
      //   ULONG     fMask         @ 4
      //   HWND      hwnd          @ 8     (8 bytes)
      //   LPCWSTR   lpVerb        @ 16    (8)
      //   LPCWSTR   lpFile        @ 24    (8)
      //   LPCWSTR   lpParameters  @ 32    (8)
      //   LPCWSTR   lpDirectory   @ 40    (8)
      //   int       nShow         @ 48    (4)
      //   HINSTANCE hInstApp      @ 56    (8)
      //   LPVOID    lpIDList      @ 64    (8)
      //   LPCWSTR   lpClass       @ 72    (8)
      //   HKEY      hkeyClass     @ 80    (8)
      //   DWORD     dwHotKey      @ 88    (4)
      //   HANDLE    hMonitor      @ 96    (8) (union with hIcon)
      //   HANDLE    hProcess      @ 104   (8)
      //   total cbSize = 112 bytes
      const cbSize = 112;
      final info = calloc.allocate<Uint8>(cbSize);
      // Обнулять не надо — calloc.allocate уже zero-fills.
      info.cast<Uint32>().value = cbSize;
      // fMask
      (info + 4).cast<Uint32>().value = _seeMaskNoCloseProcess;
      // lpVerb @ 16
      (info + 16).cast<IntPtr>().value = lpVerb.address;
      // lpFile @ 24
      (info + 24).cast<IntPtr>().value = lpFile.address;
      // lpParameters @ 32
      if (lpParams != nullptr) {
        (info + 32).cast<IntPtr>().value = lpParams.address;
      }
      // lpDirectory @ 40
      (info + 40).cast<IntPtr>().value = lpDir.address;
      // nShow @ 48
      (info + 48).cast<Int32>().value = _swShowNormal;

      final ok = ShellExecuteEx(info.cast());
      // hProcess @ 104
      final hProcess =
          (info + 104).cast<IntPtr>().value;

      // Освобождаем строки.
      calloc.free(lpVerb);
      calloc.free(lpFile);
      if (lpParams != nullptr) calloc.free(lpParams);
      calloc.free(lpDir);
      calloc.free(info);

      if (ok == 0) {
        return false;
      }
      if (hProcess != 0) {
        CloseHandle(hProcess);
      }
      return true;
    } catch (_) {
      return false;
    }
  }
}
