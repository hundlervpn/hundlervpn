package com.hundlervpn.hundler.vpn

import android.content.Context
import android.content.pm.ApplicationInfo
import android.content.pm.PackageManager
import android.os.Build
import android.util.Log
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodCall
import io.flutter.plugin.common.MethodChannel
import java.util.concurrent.Executors

/**
 * Platform-channel мост Flutter ↔ нативная PackageManager + ExcludedAppsStore.
 *
 * Flutter-сторона (`lib/services/app_list_service.dart`) использует канал
 * `com.hundlervpn.android/applist` для:
 *
 *   - `getInstalledApps`       → список установленных user-приложений
 *                                (без системных, без launcher'а самого Hundler'а).
 *   - `getExcludedPackages`    → текущий список исключений из ExcludedAppsStore.
 *   - `setExcludedPackages`    → сохранить новый список.
 *   - `applyRuBankPreset`      → добавить дефолтный пресет RU банков.
 *   - `clearExcludedPackages`  → очистить весь список.
 *   - `getRuBankPreset`        → константный список packages пресета (для UI
 *                                "восстановить дефолты").
 *
 * Лист приложений мы тащим из `PackageManager.getInstalledApplications`,
 * фильтруем `FLAG_SYSTEM` (без прошивных утилит — юзеру не интересно).
 * Иконки **не отдаём** — base64 на 200+ приложений тяжело передать через
 * MethodChannel, UI обходится без них.
 */
class AppListChannel(private val context: Context) : MethodChannel.MethodCallHandler {

    companion object {
        private const val TAG = "HundlerAppList"
        const val METHOD_CHANNEL = "com.hundlervpn.android/applist"
    }

    private var methodChannel: MethodChannel? = null
    private val store = ExcludedAppsStore(context)
    private val executor = Executors.newSingleThreadExecutor { r ->
        Thread(r, "hundler-applist").apply { isDaemon = true }
    }

    fun attach(flutterEngine: FlutterEngine) {
        val messenger = flutterEngine.dartExecutor.binaryMessenger
        methodChannel = MethodChannel(messenger, METHOD_CHANNEL).also {
            it.setMethodCallHandler(this)
        }
        Log.i(TAG, "AppListChannel attached")
    }

    fun detach() {
        methodChannel?.setMethodCallHandler(null)
        methodChannel = null
    }

    override fun onMethodCall(call: MethodCall, result: MethodChannel.Result) {
        when (call.method) {
            "getInstalledApps" -> handleGetInstalledApps(result)
            "getExcludedPackages" -> result.success(store.getExcludedPackages().toList())
            "setExcludedPackages" -> handleSetExcludedPackages(call, result)
            "applyRuBankPreset" -> {
                store.applyRuBankPreset()
                result.success(store.getExcludedPackages().toList())
            }
            "clearExcludedPackages" -> {
                store.clearAll()
                result.success(true)
            }
            "getRuBankPreset" -> result.success(ExcludedAppsStore.RU_BANK_PRESET.toList())
            else -> result.notImplemented()
        }
    }

    private fun handleGetInstalledApps(result: MethodChannel.Result) {
        // PackageManager.getInstalledApplications может занять 200-500мс на
        // устройстве с большим числом приложений — крутим на executor'е
        // чтобы UI не блочило.
        executor.execute {
            try {
                val apps = listInstalledApps()
                Log.i(TAG, "getInstalledApps: ${apps.size} entries")
                // Возвращаем в main thread (Flutter требует).
                android.os.Handler(context.mainLooper).post {
                    result.success(apps)
                }
            } catch (t: Throwable) {
                Log.e(TAG, "getInstalledApps failed", t)
                android.os.Handler(context.mainLooper).post {
                    result.error("LIST_FAILED", t.message, null)
                }
            }
        }
    }

    private fun listInstalledApps(): List<Map<String, Any>> {
        val pm = context.packageManager
        val ownPackage = context.packageName

        // FLAG_SYSTEM фильтрует прошивные системки (Telephony, MediaProvider, …).
        // FLAG_UPDATED_SYSTEM_APP — это системные, но обновлённые юзером
        // (например, Google Play Services) — их СОХРАНЯЕМ, юзер может захотеть
        // исключить.
        val flags = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            PackageManager.ApplicationInfoFlags.of(PackageManager.GET_META_DATA.toLong())
        } else null

        @Suppress("DEPRECATION")
        val installed: List<ApplicationInfo> = if (flags != null) {
            pm.getInstalledApplications(flags)
        } else {
            pm.getInstalledApplications(PackageManager.GET_META_DATA)
        }

        val excluded = store.getExcludedPackages()

        return installed.asSequence()
            .filter { info ->
                // Исключаем сам Hundler — нам нельзя себя добавлять в exclude
                // (иначе наш конфиг-фетчер пойдёт через VPN которого нет).
                info.packageName != ownPackage &&
                    // Скрываем pure system apps; обновлённые системные
                    // (FLAG_UPDATED_SYSTEM_APP, типа Chrome / Google Maps) — оставляем.
                    (info.flags and ApplicationInfo.FLAG_SYSTEM == 0 ||
                        info.flags and ApplicationInfo.FLAG_UPDATED_SYSTEM_APP != 0) &&
                    // Только launchable приложения — без service-only пакетов
                    // (типа `com.google.android.gms`, которые без UI).
                    pm.getLaunchIntentForPackage(info.packageName) != null
            }
            .map { info ->
                val label = runCatching { info.loadLabel(pm).toString() }
                    .getOrDefault(info.packageName)
                mapOf(
                    "packageName" to info.packageName,
                    "appName" to label,
                    "isExcluded" to excluded.contains(info.packageName),
                    "isSystem" to (info.flags and ApplicationInfo.FLAG_SYSTEM != 0),
                )
            }
            .sortedBy { (it["appName"] as String).lowercase() }
            .toList()
    }

    @Suppress("UNCHECKED_CAST")
    private fun handleSetExcludedPackages(call: MethodCall, result: MethodChannel.Result) {
        val list = call.argument<List<String>>("packages")
        if (list == null) {
            result.error("BAD_ARGS", "packages: List<String> required", null)
            return
        }
        store.setExcludedPackages(list.toSet())
        result.success(true)
    }
}
