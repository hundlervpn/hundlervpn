package com.hundlervpn.hundler.vpn

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Intent
import android.net.VpnService
import android.os.Build
import android.os.ParcelFileDescriptor
import android.os.SystemClock
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import com.hundlervpn.hundler.MainActivity
import com.hundlervpn.hundler.R
import io.nekohasekai.libbox.TunOptions

/**
 * VPN-сервис Hundler.
 *
 * Реальная sing-box интеграция:
 *
 * - Принимает `start`/`stop` команды от [VpnChannel] (Dart).
 * - Поднимает foreground-notification (обязательное условие на Android 8+).
 * - Транслирует статусы / стат-трафик через локальные broadcast'ы —
 *   их слушает [VpnChannel.statusReceiver] и пушит в Dart EventChannel.
 * - **`buildTun()` вызывается ИЗ Go-горутины** sing-box'а через
 *   [HundlerPlatformInterface.openTun] и должен быть thread-safe.
 *   Возвращаемый FD передаётся в sing-box на чтение/запись IP-пакетов.
 */
class HundlerVpnService : VpnService() {

    companion object {
        private const val TAG = "HundlerVPN"

        const val ACTION_START = "com.hundlervpn.hundler.vpn.START"
        const val ACTION_STOP = "com.hundlervpn.hundler.vpn.STOP"
        const val EXTRA_CONFIG = "config"
        const val EXTRA_PROFILE_NAME = "profileName"

        private const val NOTIF_CHANNEL_ID = "hundler_vpn_status"
        private const val NOTIF_ID = 7777

        @Volatile var currentStatus: Status = Status.DISCONNECTED
            private set

        @Volatile var uploadBytes: Long = 0L
            private set

        @Volatile var downloadBytes: Long = 0L
            private set

        @Volatile var connectedSinceMs: Long = 0L
            private set
    }

    enum class Status { DISCONNECTED, CONNECTING, CONNECTED, DISCONNECTING, ERROR }

    @Volatile
    var profileName: String = "Hundler VPN"
        private set

    private var configJson: String? = null
    private var coreManager: CoreManager? = null

    /**
     * TUN file descriptor. Хранится до `stop()`/`onDestroy()`, потом
     * закрывается. После `detachFd()` владение fd-int'ом уходит к sing-box,
     * но `ParcelFileDescriptor` нужен чтобы корректно закрыть рутовый
     * объект и освободить native ref.
     */
    private var tunFd: ParcelFileDescriptor? = null

    override fun onCreate() {
        super.onCreate()
        Log.i(TAG, "onCreate(): начало инициализации сервиса")
        ensureNotificationChannel()
        // Eager-load libgojni.so в onCreate. Без этого первая попытка
        // обратиться к io.nekohasekai.libbox.Libbox триггернет ленивый
        // System.loadLibrary("gojni") уже из executor-треда. Если там
        // что-то падает (UnsatisfiedLinkError, text relocation, RX-only
        // memory) — без явного try/catch и Log на main-треде ошибка
        // невидима в logcat. Сначала тут.
        try {
            Log.i(TAG, "onCreate(): System.loadLibrary(gojni) ...")
            System.loadLibrary("gojni")
            Log.i(TAG, "onCreate(): libgojni.so loaded OK")
        } catch (e: UnsatisfiedLinkError) {
            Log.e(TAG, "onCreate(): libgojni.so FAILED to load", e)
        } catch (t: Throwable) {
            Log.e(TAG, "onCreate(): unexpected error loading libgojni", t)
        }
        try {
            Log.i(TAG, "onCreate(): Class.forName(io.nekohasekai.libbox.Libbox) ...")
            Class.forName("io.nekohasekai.libbox.Libbox")
            Log.i(TAG, "onCreate(): Libbox class loaded OK")
        } catch (t: Throwable) {
            Log.e(TAG, "onCreate(): Libbox class FAILED to load", t)
        }
        coreManager = CoreManager(this)
        Log.i(TAG, "onCreate(): CoreManager создан, готов к startTunnel")
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_START -> {
                profileName = intent.getStringExtra(EXTRA_PROFILE_NAME) ?: profileName
                configJson = intent.getStringExtra(EXTRA_CONFIG)
                startTunnel()
            }
            ACTION_STOP -> {
                stopTunnel()
            }
            null -> {
                // Сервис перезапущен системой после kill (START_STICKY).
                // Без сохранённого конфига ничего не делаем — клиент
                // должен заново вызвать `start` с актуальным configJson
                // из flutter_secure_storage кеша.
                Log.w(TAG, "Service restarted by system without intent — staying idle")
            }
        }
        return START_STICKY
    }

    private fun startTunnel() {
        val json = configJson
        if (json.isNullOrBlank()) {
            broadcastError("INVALID_CONFIG", "Пустой sing-box конфиг")
            stopSelf()
            return
        }
        Log.i(TAG, "startTunnel(): profile=$profileName, configLen=${json.length}")
        broadcastStatus(Status.CONNECTING)
        startForeground(NOTIF_ID, buildNotification("Подключение…"))

        val cm = coreManager ?: run {
            broadcastError("INTERNAL", "CoreManager не инициализирован")
            stopSelf()
            return
        }
        cm.start(json) { result ->
            result.onSuccess {
                connectedSinceMs = SystemClock.elapsedRealtime()
                broadcastStatus(Status.CONNECTED)
                updateNotificationText("Подключено · $profileName")
            }.onFailure { t ->
                Log.e(TAG, "core start failed", t)
                broadcastError("CORE_FAILED", t.message ?: t::class.java.simpleName)
                broadcastStatus(Status.ERROR)
                stopTunnel()
            }
        }
    }

    private fun stopTunnel() {
        Log.i(TAG, "stopTunnel()")
        broadcastStatus(Status.DISCONNECTING)
        coreManager?.stop()
        runCatching { tunFd?.close() }
        tunFd = null
        connectedSinceMs = 0L
        uploadBytes = 0L
        downloadBytes = 0L
        broadcastStatus(Status.DISCONNECTED)
        stopForegroundCompat()
        stopSelf()
    }

    /**
     * Вызывается из [HundlerCommandServerHandler] когда sing-box CommandClient
     * шлёт `serviceClose` (например, наш будущий UI-сабскрайбер).
     */
    fun stopFromCore() {
        Log.i(TAG, "stopFromCore() — request from sing-box CommandClient")
        stopTunnel()
    }

    override fun onRevoke() {
        // Пользователь отключил VPN из системных настроек или другое
        // приложение перехватило BIND_VPN_SERVICE.
        Log.w(TAG, "onRevoke() — VPN отключён системой")
        stopTunnel()
        super.onRevoke()
    }

    override fun onDestroy() {
        if (currentStatus != Status.DISCONNECTED) {
            stopTunnel()
        }
        coreManager?.shutdown()
        coreManager = null
        super.onDestroy()
    }

    // ── TUN builder ───────────────────────────────────────────────

    /**
     * Создаёт TUN-устройство по параметрам из sing-box `TunOptions`,
     * возвращает int-fd для передачи Go-стороне. Вызывается ИЗ Go-горутины
     * sing-box через [HundlerPlatformInterface.openTun] — обязан быть
     * thread-safe и **синхронным** (sing-box ждёт fd прежде чем поднимать
     * outbounds).
     *
     * Структура [TunOptions]:
     *
     * - `getInet4Address()` — список наших адресов в TUN (`172.19.0.1/30`).
     * - `getInet4RouteAddress()` — маршруты, что заворачивать в TUN
     *   (обычно `0.0.0.0/0` если autoRoute, иначе конкретные подсети).
     * - `getInet4RouteExcludeAddress()` — что НЕ заворачивать (наш сервер).
     * - `getDNSServerAddress()` — DNS-резолверы (sing-box обычно отдаёт
     *   свой fake DNS на `198.18.0.0/16`).
     * - `getMTU()` — обычно 9000 для wireguard-style.
     * - `getIncludePackage()` / `getExcludePackage()` — per-app split-tunnel.
     */
    @Synchronized
    fun buildTun(options: TunOptions): Int {
        runCatching { tunFd?.close() }
        tunFd = null

        val builder = Builder()
            .setSession(profileName)
            .setMtu(options.getMTU())

        // IPv4 адреса
        val v4Addresses = options.inet4Address
        if (v4Addresses != null) {
            while (v4Addresses.hasNext()) {
                val p = v4Addresses.next()
                builder.addAddress(p.address(), p.prefix())
            }
        }
        // IPv6 адреса
        val v6Addresses = options.inet6Address
        if (v6Addresses != null) {
            while (v6Addresses.hasNext()) {
                val p = v6Addresses.next()
                builder.addAddress(p.address(), p.prefix())
            }
        }

        // IPv4 маршруты. Если autoRoute=true и список пустой, добавляем
        // 0.0.0.0/0 — это full-tunnel режим.
        var v4RoutesAdded = 0
        options.inet4RouteAddress?.let { it ->
            while (it.hasNext()) {
                val p = it.next()
                builder.addRoute(p.address(), p.prefix())
                v4RoutesAdded++
            }
        }
        if (options.autoRoute && v4RoutesAdded == 0) {
            builder.addRoute("0.0.0.0", 0)
        }

        // IPv6 routes
        var v6RoutesAdded = 0
        options.inet6RouteAddress?.let { it ->
            while (it.hasNext()) {
                val p = it.next()
                builder.addRoute(p.address(), p.prefix())
                v6RoutesAdded++
            }
        }
        if (options.autoRoute && v6RoutesAdded == 0) {
            // IPv6 full-tunnel только если хост поддерживает (есть v6 адрес).
            if (v6Addresses != null) {
                builder.addRoute("::", 0)
            }
        }

        // DNS-серверы. ВАЖНО для anti-detection: НЕ прокидываем sing-box'овский
        // внутренний DNS (это 172.19.0.2 — другой конец /30 TUN-подсети). Если
        // прокинуть, RKN-сканеры (RKN Hardering, etc.) видят "DNS в приватной
        // подсети" → флагают как VPN. Прописываем публичные IP — все DNS-запросы
        // идут через TUN и перехватываются sing-box правилом
        // `protocol:"dns", action:"hijack-dns"` → отвечает локальный резолвер
        // (dns-proxy / dns-direct), поэтому 1.1.1.1 и 8.8.8.8 тут — просто
        // "обложка" для системного netd, реальный трафик никогда туда не уходит.
        builder.addDnsServer("1.1.1.1")
        builder.addDnsServer("8.8.8.8")
        // sing-box всё равно вернёт DNS-итератор — пройдёмся, чтобы освободить
        // нативные ресурсы итератора, но значения не используем.
        runCatching {
            val dns = options.getDNSServerAddress()
            if (dns != null) {
                while (dns.hasNext()) {
                    dns.next()
                }
            }
        }

        // Per-app routing (см. ANDROID-AGENTS.md split-tunneling)
        applyPackageFilter(builder, options)

        if (options.strictRoute) {
            // strictRoute=true → блокировать любой трафик мимо TUN.
            // VpnService.Builder это умеет через allowFamily/disallow.
            // Минимально достаточно не делать setBlocking(true) тут;
            // sing-box внутри сам дропнет на route уровне.
        }

        val fd = builder.establish() ?: throw IllegalStateException(
            "VpnService.Builder.establish() returned null — нет VPN-разрешения?"
        )
        tunFd = fd
        Log.i(TAG, "TUN established: fd=${fd.fd}")
        return fd.detachFd()
    }

    private fun applyPackageFilter(builder: Builder, options: TunOptions) {
        val includes = options.includePackage
        val excludes = options.excludePackage
        // VpnService.Builder требует **либо** addAllowedApplication, **либо**
        // addDisallowedApplication, но не оба сразу. include имеет приоритет.
        if (includes != null && includes.hasNext()) {
            while (includes.hasNext()) {
                runCatching { builder.addAllowedApplication(includes.next()) }
                    .onFailure { Log.w(TAG, "addAllowedApplication failed: $it") }
            }
            return
        }
        if (excludes != null) {
            while (excludes.hasNext()) {
                runCatching { builder.addDisallowedApplication(excludes.next()) }
                    .onFailure { Log.w(TAG, "addDisallowedApplication failed: $it") }
            }
        }
        // Защита от бесконечного петля: исключаем самих себя из VPN.
        // Иначе наш `dio` для polling /api/sub/* пойдёт через VPN, а VPN
        // выпадет если сервер сменил UUID, и /api/sub станет недоступен.
        runCatching { builder.addDisallowedApplication(packageName) }
    }

    // ── Notification ──────────────────────────────────────────────

    private fun ensureNotificationChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val nm = getSystemService(NotificationManager::class.java) ?: return
        if (nm.getNotificationChannel(NOTIF_CHANNEL_ID) != null) return
        val channel = NotificationChannel(
            NOTIF_CHANNEL_ID,
            "VPN-статус",
            NotificationManager.IMPORTANCE_LOW
        ).apply {
            description = "Уведомление о статусе подключения Hundler VPN"
            setShowBadge(false)
        }
        nm.createNotificationChannel(channel)
    }

    private fun buildNotification(text: String): Notification {
        val tap = PendingIntent.getActivity(
            this, 0,
            Intent(this, MainActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
            },
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )
        val stopIntent = Intent(this, HundlerVpnService::class.java).apply {
            action = ACTION_STOP
        }
        val stopPi = PendingIntent.getService(
            this, 1, stopIntent,
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )

        return NotificationCompat.Builder(this, NOTIF_CHANNEL_ID)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle("Hundler VPN")
            .setContentText(text)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setContentIntent(tap)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .setVisibility(NotificationCompat.VISIBILITY_SECRET)
            .addAction(0, "Отключить", stopPi)
            .build()
    }

    /**
     * Публичный метод — вызывается из [HundlerPlatformInterface.sendNotification]
     * чтобы прокинуть system-уведомления sing-box (например, deprecated config
     * warning) в наш foreground notification.
     */
    fun updateNotificationText(text: String) {
        val nm = ContextCompat.getSystemService(this, NotificationManager::class.java) ?: return
        nm.notify(NOTIF_ID, buildNotification(text))
    }

    private fun stopForegroundCompat() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
            stopForeground(STOP_FOREGROUND_REMOVE)
        } else {
            @Suppress("DEPRECATION")
            stopForeground(true)
        }
    }

    // ── Broadcasts ────────────────────────────────────────────────

    private fun broadcastStatus(status: Status) {
        currentStatus = status
        val intent = Intent(VpnChannel.ACTION_STATUS).apply {
            setPackage(packageName)
            putExtra(VpnChannel.EXTRA_STATUS, status.name.lowercase())
        }
        sendBroadcast(intent)
    }

    private fun broadcastError(code: String, message: String) {
        val intent = Intent(VpnChannel.ACTION_ERROR).apply {
            setPackage(packageName)
            putExtra(VpnChannel.EXTRA_ERROR_CODE, code)
            putExtra(VpnChannel.EXTRA_ERROR_MESSAGE, message)
        }
        sendBroadcast(intent)
    }
}
