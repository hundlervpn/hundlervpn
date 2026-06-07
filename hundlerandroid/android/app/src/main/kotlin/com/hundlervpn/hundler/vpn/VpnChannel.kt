package com.hundlervpn.hundler.vpn

import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.net.VpnService
import android.os.Build
import androidx.core.content.ContextCompat
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.EventChannel
import io.flutter.plugin.common.MethodCall
import io.flutter.plugin.common.MethodChannel

/**
 * Мост Flutter ↔ нативный VPN-движок Hundler.
 *
 * Имена каналов фиксированы и должны совпадать с Dart-стороной
 * (см. `lib/services/vpn_service.dart`).
 *
 * Сейчас тут **stub** sing-box интеграции: `start` запускает
 * `HundlerVpnService`, который открывает foreground-notification
 * и сразу рапортует `connected`. Реальный sing-box подключим в
 * следующей итерации (см. ANDROID-AGENTS.md "VPN-интеграция").
 */
class VpnChannel(private val activity: Activity) : MethodChannel.MethodCallHandler {

    companion object {
        const val METHOD_CHANNEL = "com.hundlervpn.android/vpn"
        const val EVENT_CHANNEL = "com.hundlervpn.android/vpn-events"

        // Локальные broadcast-actions от HundlerVpnService для
        // ретрансляции в Flutter (через EventChannel).
        const val ACTION_STATUS = "com.hundlervpn.hundler.STATUS"
        const val ACTION_STATS = "com.hundlervpn.hundler.STATS"
        const val ACTION_ERROR = "com.hundlervpn.hundler.ERROR"

        const val EXTRA_STATUS = "status"
        const val EXTRA_UPLOAD = "upload"
        const val EXTRA_DOWNLOAD = "download"
        const val EXTRA_ERROR_CODE = "code"
        const val EXTRA_ERROR_MESSAGE = "message"

        // requestCode для VpnService.prepare() диалога.
        private const val REQ_VPN_PREPARE = 4242
    }

    private var methodChannel: MethodChannel? = null
    private var eventChannel: EventChannel? = null
    private var eventSink: EventChannel.EventSink? = null

    /** Подвисший callback на результат `prepare()` диалога. */
    private var pendingPrepareResult: MethodChannel.Result? = null

    private val statusReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) {
            when (intent.action) {
                ACTION_STATUS -> {
                    val status = intent.getStringExtra(EXTRA_STATUS) ?: "disconnected"
                    eventSink?.success(
                        mapOf("type" to "status", "value" to status)
                    )
                }
                ACTION_STATS -> {
                    val up = intent.getLongExtra(EXTRA_UPLOAD, 0)
                    val down = intent.getLongExtra(EXTRA_DOWNLOAD, 0)
                    eventSink?.success(
                        mapOf(
                            "type" to "stats",
                            "uploadBytes" to up,
                            "downloadBytes" to down,
                        )
                    )
                }
                ACTION_ERROR -> {
                    val code = intent.getStringExtra(EXTRA_ERROR_CODE) ?: "unknown"
                    val msg = intent.getStringExtra(EXTRA_ERROR_MESSAGE) ?: ""
                    eventSink?.success(
                        mapOf("type" to "error", "code" to code, "message" to msg)
                    )
                }
            }
        }
    }

    fun attach(flutterEngine: FlutterEngine) {
        val messenger = flutterEngine.dartExecutor.binaryMessenger

        methodChannel = MethodChannel(messenger, METHOD_CHANNEL).also {
            it.setMethodCallHandler(this)
        }
        eventChannel = EventChannel(messenger, EVENT_CHANNEL).also {
            it.setStreamHandler(object : EventChannel.StreamHandler {
                override fun onListen(arguments: Any?, events: EventChannel.EventSink?) {
                    eventSink = events
                    // Сразу пушим текущий статус для Dart-стороны.
                    val status = HundlerVpnService.currentStatus.name.lowercase()
                    events?.success(mapOf("type" to "status", "value" to status))
                }

                override fun onCancel(arguments: Any?) {
                    eventSink = null
                }
            })
        }

        val filter = IntentFilter().apply {
            addAction(ACTION_STATUS)
            addAction(ACTION_STATS)
            addAction(ACTION_ERROR)
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            ContextCompat.registerReceiver(
                activity, statusReceiver, filter,
                ContextCompat.RECEIVER_NOT_EXPORTED,
            )
        } else {
            @Suppress("UnspecifiedRegisterReceiverFlag")
            activity.registerReceiver(statusReceiver, filter)
        }
    }

    fun detach() {
        try {
            activity.unregisterReceiver(statusReceiver)
        } catch (_: IllegalArgumentException) {
            // Не был зарегистрирован — ок.
        }
        methodChannel?.setMethodCallHandler(null)
        methodChannel = null
        eventChannel?.setStreamHandler(null)
        eventChannel = null
        eventSink = null
    }

    /**
     * Вызывается из MainActivity.onActivityResult — обрабатывает
     * результат системного VPN-prepare диалога.
     */
    fun onPrepareResult(requestCode: Int, resultCode: Int): Boolean {
        if (requestCode != REQ_VPN_PREPARE) return false
        pendingPrepareResult?.success(resultCode == Activity.RESULT_OK)
        pendingPrepareResult = null
        return true
    }

    override fun onMethodCall(call: MethodCall, result: MethodChannel.Result) {
        when (call.method) {
            "prepare" -> handlePrepare(result)
            "start" -> handleStart(call, result)
            "stop" -> handleStop(result)
            "getStatus" -> result.success(
                HundlerVpnService.currentStatus.name.lowercase()
            )
            "getStats" -> result.success(
                mapOf(
                    "uploadBytes" to HundlerVpnService.uploadBytes,
                    "downloadBytes" to HundlerVpnService.downloadBytes,
                    "sinceMs" to HundlerVpnService.connectedSinceMs,
                )
            )
            else -> result.notImplemented()
        }
    }

    private fun handlePrepare(result: MethodChannel.Result) {
        val intent = VpnService.prepare(activity)
        if (intent == null) {
            // Уже разрешено — повторно показывать не нужно.
            result.success(true)
            return
        }
        if (pendingPrepareResult != null) {
            result.error("ALREADY_PENDING", "VPN prepare уже запрошен", null)
            return
        }
        pendingPrepareResult = result
        try {
            activity.startActivityForResult(intent, REQ_VPN_PREPARE)
        } catch (e: ActivityNotFoundException) {
            pendingPrepareResult = null
            result.error("NO_VPN_SUPPORT", "На устройстве нет VPN API", e.message)
        }
    }

    private fun handleStart(call: MethodCall, result: MethodChannel.Result) {
        val config = call.argument<String>("config")
        if (config.isNullOrBlank()) {
            result.error("INVALID_CONFIG", "Пустой sing-box конфиг", null)
            return
        }
        val profileName = call.argument<String>("profileName") ?: "Hundler VPN"

        val intent = Intent(activity, HundlerVpnService::class.java).apply {
            action = HundlerVpnService.ACTION_START
            putExtra(HundlerVpnService.EXTRA_CONFIG, config)
            putExtra(HundlerVpnService.EXTRA_PROFILE_NAME, profileName)
        }
        ContextCompat.startForegroundService(activity, intent)
        result.success(null)
    }

    private fun handleStop(result: MethodChannel.Result) {
        val intent = Intent(activity, HundlerVpnService::class.java).apply {
            action = HundlerVpnService.ACTION_STOP
        }
        activity.startService(intent)
        result.success(null)
    }
}
