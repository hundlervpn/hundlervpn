package com.hundlervpn.hundler.vpn

import android.util.Log
import io.nekohasekai.libbox.CommandServerHandler
import io.nekohasekai.libbox.SystemProxyStatus
import java.lang.ref.WeakReference

/**
 * Обработчик команд от sing-box CommandClient → нашему CommandServer.
 *
 * Используется когда какой-нибудь внешний UI (например, наш Dart-фронт
 * подключается через [io.nekohasekai.libbox.CommandClient]) шлёт команды
 * «остановить сервис», «выключить системный прокси» и т.п.
 *
 * Для MVP большая часть — no-op:
 *
 * - **serviceStop** — основное: дёргается из [io.nekohasekai.libbox.CommandClient.serviceClose].
 *   Останавливаем наш [HundlerVpnService] изнутри.
 * - **serviceReload** — горячий restart sing-box без рестарта VPN-фд.
 *   На MVP не поддерживаем — клиент должен сам остановить и заново стартовать.
 * - **getSystemProxyStatus** — на Android нет API «общесистемный HTTP
 *   прокси». Возвращаем пустой статус.
 * - **setSystemProxyEnabled** — то же, no-op.
 * - **triggerNativeCrash** — debug-команда для тестирования crash handler.
 *   Делаем `RuntimeException` чтобы Crashlytics поймал.
 * - **writeDebugMessage** — sing-box пишет debug-логи; форвардим в logcat.
 */
class HundlerCommandServerHandler(
    service: HundlerVpnService,
) : CommandServerHandler {

    companion object {
        private const val TAG = "HundlerCmdSrv"
    }

    private val serviceRef = WeakReference(service)

    override fun serviceStop() {
        Log.i(TAG, "serviceStop() command from sing-box")
        serviceRef.get()?.stopFromCore()
    }

    override fun serviceReload() {
        // Горячий перезапуск без teardown TUN. В sing-box-for-android это
        // реализовано через `CommandServer.startOrReloadService` со
        // свежим JSON. Мы сейчас не пересоздаём конфиг динамически —
        // если backend обновил UUID/SNI, лучше полный stop+start.
        Log.w(TAG, "serviceReload() requested — not implemented, ignoring")
    }

    override fun getSystemProxyStatus(): SystemProxyStatus {
        // Android Settings.Secure.HTTP_PROXY устарел и не работает с
        // приложениями, использующими собственный networking stack
        // (а у Flutter/dart:io так и есть). Возвращаем пустой объект.
        return SystemProxyStatus()
    }

    override fun setSystemProxyEnabled(enabled: Boolean) {
        Log.v(TAG, "setSystemProxyEnabled($enabled) — no-op on Android")
    }

    override fun triggerNativeCrash() {
        // Только для debug-сборки. В release это никогда не должно вызываться,
        // но если кто-то всё же дёрнул — лучше пусть crash попадёт в логи,
        // чем тихо проигнорить.
        throw RuntimeException("triggerNativeCrash() called by sing-box CommandClient")
    }

    override fun writeDebugMessage(message: String) {
        Log.d(TAG, "sing-box: $message")
    }
}
