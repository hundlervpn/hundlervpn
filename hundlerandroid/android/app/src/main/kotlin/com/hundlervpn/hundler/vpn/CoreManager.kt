package com.hundlervpn.hundler.vpn

import android.util.Log
import io.nekohasekai.libbox.CommandServer
import io.nekohasekai.libbox.Libbox
import io.nekohasekai.libbox.OverrideOptions
import io.nekohasekai.libbox.SetupOptions
import org.json.JSONObject
import java.io.File
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Менеджер ядра sing-box.
 *
 * Lifecycle совпадает с [HundlerVpnService] — создаётся в `onCreate()`,
 * `start(configJson)` запускает sing-box, `stop()` тушит, инстанс не
 * переиспользуется между подключениями (это сэкономило бы ~50 мс на
 * `Libbox.setup`, но добавило бы возни с lifecycle утечками).
 *
 * ## Архитектура (sing-box libbox 1.13+)
 *
 * Современный sing-box API не имеет `BoxService.newService(...)` — вместо
 * этого ядро живёт **внутри** `CommandServer`'а:
 *
 * ```
 *  ┌──────────────────────────────────────────────┐
 *  │ CommandServer                                │
 *  │   ├── PlatformInterface (наш мост в Android) │
 *  │   ├── CommandServerHandler (stop/reload)     │
 *  │   └── sing-box core (после                   │
 *  │       startOrReloadService(json))            │
 *  └──────────────────────────────────────────────┘
 * ```
 *
 * 1. `Libbox.setup(SetupOptions)` — глобальный setup (paths, OOM,
 *    fixAndroidStack). Вызывается один раз на процесс.
 * 2. `Libbox.checkConfig(json)` — пред-валидация. Если конфиг битый,
 *    лучше упасть здесь чем посреди старта TUN.
 * 3. `Libbox.newCommandServer(handler, platformInterface)` — создаёт
 *    управляющий сервер.
 * 4. `commandServer.start()` — поднимает TCP-listener (нужен для
 *    in-process CommandClient'а, потом подключим для UI-стат).
 * 5. `commandServer.startOrReloadService(json, OverrideOptions)` —
 *    ✦ собственно поднимает sing-box: парсит конфиг, открывает TUN
 *    через `PlatformInterface.openTun(...)`, запускает outbounds.
 * 6. `commandServer.closeService()` — останавливает sing-box core.
 * 7. `commandServer.close()` — закрывает CommandServer + listener.
 *
 * Шаги 4–5 блокирующие (несколько секунд при холодном старте), потому
 * крутим их на background-Executor.
 */
class CoreManager(private val service: HundlerVpnService) {

    companion object {
        private const val TAG = "HundlerCore"

        /**
         * Был ли уже вызван `Libbox.setup`. Setup идемпотентен на Go-стороне,
         * но повторные вызовы пересоздают всё внутри (ресет лога, ресет OOM
         * killer'а) — лишний риск. Делаем один раз на процесс.
         */
        @Volatile
        private var setupDone = false

        /** Версия sing-box, прилинкованного в libbox.aar. Полезно для логов и UA. */
        @JvmStatic
        fun coreVersion(): String = runCatching {
            // Подталкиваем JNI-инициализацию класса Libbox перед первым native
            // вызовом — иначе на некоторых Android можно поймать `UnsatisfiedLinkError`.
            Libbox.touch()
            Libbox.version()
        }.getOrDefault("unknown")
    }

    private val executor = Executors.newSingleThreadExecutor { r ->
        Thread(r, "hundler-core").apply { isDaemon = true }
    }
    private val started = AtomicBoolean(false)

    @Volatile
    private var commandServer: CommandServer? = null

    @Volatile
    private var platformInterface: HundlerPlatformInterface? = null

    /**
     * Запустить туннель с указанным sing-box JSON.
     *
     * `configJson` приходит от бэкенда (`/api/sub/{token}`) и содержит
     * валидные `outbounds` с UUID пользователя. Не модифицируем — просто
     * передаём в ядро.
     *
     * Колбэк [onReady] вызывается в worker-треде:
     * - `Result.success` — sing-box стартанул, TUN открыт.
     * - `Result.failure` — что-то упало (битый JSON, отказ TUN, и т.п.).
     */
    fun start(configJson: String, onReady: (Result<Unit>) -> Unit) {
        Log.i(TAG, "start() entry, configLen=${configJson.length}, started=${started.get()}")
        if (!started.compareAndSet(false, true)) {
            Log.w(TAG, "start() — already started, rejecting")
            onReady(Result.failure(IllegalStateException("CoreManager.start() already invoked")))
            return
        }
        Log.i(TAG, "start() — submitting task to executor")
        try {
            executor.execute {
                Log.i(TAG, "executor task ENTERED (thread=${Thread.currentThread().name})")
                try {
                    Log.i(TAG, "step 1/6: ensureSetup()")
                    ensureSetup()
                    Log.i(TAG, "step 2/6: migrate legacy config + Libbox.checkConfig(json)")
                    val migratedJson = migrateLegacyConfig(configJson)
                    Libbox.checkConfig(migratedJson)
                    Log.i(TAG, "step 3/6: new PlatformInterface")
                    val pi = HundlerPlatformInterface(service)
                    Log.i(TAG, "step 4/6: new CommandServerHandler + newCommandServer")
                    val handler = HundlerCommandServerHandler(service)
                    val cs = Libbox.newCommandServer(handler, pi)
                    Log.i(TAG, "step 5/6: commandServer.start()")
                    cs.start()
                    Log.i(TAG, "step 6/6: commandServer.startOrReloadService()")
                    cs.startOrReloadService(migratedJson, OverrideOptions())

                    commandServer = cs
                    platformInterface = pi
                    Log.i(TAG, "sing-box core started: ${coreVersion()}")
                    onReady(Result.success(Unit))
                } catch (t: Throwable) {
                    Log.e(TAG, "sing-box start failed at native step", t)
                    runCatching { commandServer?.closeService() }
                    runCatching { commandServer?.close() }
                    commandServer = null
                    platformInterface = null
                    started.set(false)
                    onReady(Result.failure(t))
                }
            }
            Log.i(TAG, "start() — task submitted")
        } catch (t: Throwable) {
            Log.e(TAG, "start() — executor.execute threw", t)
            started.set(false)
            onReady(Result.failure(t))
        }
    }

    fun stop() {
        if (!started.compareAndSet(true, false)) return
        executor.execute {
            val cs = commandServer
            commandServer = null
            platformInterface = null
            try {
                cs?.closeService()
            } catch (t: Throwable) {
                Log.w(TAG, "closeService() error", t)
            }
            try {
                cs?.close()
            } catch (t: Throwable) {
                Log.w(TAG, "close() error", t)
            }
            Log.i(TAG, "sing-box core stopped")
        }
    }

    /**
     * Проверить доступность libbox.aar в рантайме. Используется чтобы
     * дать пользователю понятное сообщение «VPN-ядро не подключено» вместо
     * `NoClassDefFoundError` посреди UI.
     */
    fun isCoreAvailable(): Boolean = try {
        Class.forName("io.nekohasekai.libbox.Libbox")
        true
    } catch (_: Throwable) {
        false
    }

    fun shutdown() {
        stop()
        executor.shutdown()
    }

    // ── Legacy config migration ─────────────────────────────────────

    /**
     * Migrate legacy sing-box config to 1.13+ format. Backend (hundlerminiapp)
     * may still emit legacy shapes which libbox.checkConfig() rejects:
     *
     * 1. DNS server format (removed in 1.14):
     *    Legacy: `{ address: "https://8.8.8.8/dns-query" }`
     *    New:    `{ type: "https", server: "8.8.8.8", path: "/dns-query" }`
     *
     * 2. `address_resolver` → `domain_resolver` (1.12).
     *
     * 3. `dns` outbound (removed in 1.13). Old pattern:
     *      outbounds: [..., { type: "dns", tag: "dns-out" }]
     *      route.rules: [..., { protocol: "dns", outbound: "dns-out" }]
     *    New pattern (action-based, no separate outbound):
     *      route.rules: [..., { protocol: "dns", action: "hijack-dns" }]
     *
     * Migration guide: https://sing-box.sagernet.org/migration/
     */
    private fun migrateLegacyConfig(configJson: String): String {
        return try {
            val root = JSONObject(configJson)
            val dnsMigrated = migrateDnsServers(root)
            val (dnsOutMigrated, dnsOutTags) = stripOutboundsByType(root, "dns")
            val (blockOutMigrated, blockOutTags) = stripOutboundsByType(root, "block")
            val dnsRulesMigrated = rewriteOutboundRules(root, dnsOutTags, "hijack-dns")
            val blockRulesMigrated = rewriteOutboundRules(root, blockOutTags, "reject")
            // sing-box 1.13+ rejects `detour` to an "empty" direct outbound.
            val directTags = findEmptyDirectOutbounds(root)
            val dnsDetourStripped = stripDnsServerDetour(root, directTags)
            // Inject TUN inbound — backend produces only outbounds+route, so
            // sing-box never opens a TUN device and no traffic flows. Hiddify,
            // sfa-android, NekoBox all inject TUN inbound client-side; we do
            // the same. Without this, sing-box.checkConfig passes but
            // startOrReloadService runs an idle core with no packet source.
            val tunInjected = injectTunInboundIfMissing(root)
            val perfTweaks = injectPerfTweaks(root)
            if (dnsMigrated + dnsOutMigrated + blockOutMigrated + dnsRulesMigrated + blockRulesMigrated + dnsDetourStripped + tunInjected + perfTweaks > 0) {
                Log.i(TAG, "migrateLegacyConfig: dns-servers=$dnsMigrated, dns-out-removed=$dnsOutMigrated, block-out-removed=$blockOutMigrated, dns-rules=$dnsRulesMigrated, block-rules=$blockRulesMigrated, dns-detour-stripped=$dnsDetourStripped, tun-injected=$tunInjected, perf-tweaks=$perfTweaks")
            }
            root.toString()
        } catch (t: Throwable) {
            Log.w(TAG, "migrateLegacyConfig failed, passing original JSON", t)
            configJson
        }
    }

    /**
     * Inject a TUN inbound if config doesn't already have one. sing-box needs
     * a packet source (inbound), and on Android that's the VPNService TUN fd
     * provided via PlatformInterface.openTun(). Settings tuned for Android +
     * anti-detection + weak-device performance:
     *
     * - `address`: 10.7.0.1/30 (wireguard-style) — sing-box default 172.19.0.1/30
     *   is a known fingerprint that RKN-detection apps (RKN Hardering, etc.)
     *   specifically flag. WG-style 10.7.0.x looks like generic LAN.
     * - IPv6 omitted — many ISPs (esp. RU mobile) don't have v6, and v6 leak
     *   would force sing-box to set inet6_route which then blackholes.
     * - `mtu: 1500` — standard Ethernet MTU. sing-box default 9000 (jumbo)
     *   triggers fragmentation on Reality TLS framing AND eats CPU on weak
     *   devices. 1500 keeps each IP packet under one TCP segment.
     * - `auto_route: true` — sing-box installs IP routes to capture all
     *   traffic. Combined with VpnService.Builder.addRoute("0.0.0.0", 0)
     *   on Android side (HundlerVpnService.buildTun) this is full-tunnel.
     * - `strict_route: false` — don't fight Android's routing tables; we
     *   trust VpnService to put us as default.
     * - `stack: "system"` — kernel TCP/UDP. `gvisor` is more isolated but
     *   ~30% slower on CPU-constrained devices.
     * - `endpoint_independent_nat: false` — simpler NAT, less RAM/CPU. We
     *   already wrap all UDP into XUDP inside the VLESS TCP stream so NAT
     *   matching for P2P UDP isn't needed at the TUN level.
     * - `udp_timeout: "30s"` — release UDP sockets sooner (default 5min wastes
     *   sockets on idle mobile networks).
     * - `interface_name` left unset — Android kernel picks tunN; setting a
     *   custom name doesn't actually rename the kernel interface (VpnService
     *   API doesn't allow that), so it's noise.
     */
    private fun injectTunInboundIfMissing(root: JSONObject): Int {
        val inbounds = root.optJSONArray("inbounds") ?: org.json.JSONArray().also {
            root.put("inbounds", it)
        }
        // Уже есть TUN inbound — только аппендим exclude_package если его там нет.
        for (i in 0 until inbounds.length()) {
            val ib = inbounds.optJSONObject(i)
            if (ib != null && ib.optString("type") == "tun") {
                applyExcludePackage(ib)
                return 0
            }
        }
        val tun = JSONObject().apply {
            put("type", "tun")
            put("tag", "tun-in")
            put("address", org.json.JSONArray().apply { put("10.7.0.1/30") })
            put("mtu", 1500)
            put("auto_route", true)
            put("strict_route", false)
            put("stack", "system")
            put("endpoint_independent_nat", false)
            put("udp_timeout", "30s")
        }
        applyExcludePackage(tun)
        inbounds.put(tun)
        return 1
    }

    /**
     * Прописывает `exclude_package: [...]` в TUN inbound из persistence-store.
     *
     * sing-box потом передаёт этот список в `HundlerPlatformInterface.openTun`
     * через `options.getExcludePackage()`, а `HundlerVpnService.applyPackageFilter`
     * вызывает `VpnService.Builder.addDisallowedApplication(pkg)` для каждого.
     *
     * Эффект на устройстве: эти приложения **физически** не видят VPN —
     * никакого TRANSPORT_VPN, никакого tun0, обычный wlan0/mobile. Это
     * единственный надёжный способ обойти anti-VPN детекторы в банковских
     * приложениях без root-прав.
     *
     * Идемпотентность: если в TUN уже есть exclude_package — мерджим (множество).
     */
    private fun applyExcludePackage(tun: JSONObject) {
        val store = ExcludedAppsStore(service.applicationContext)
        val userExclusions = store.getExcludedPackages()
        if (userExclusions.isEmpty()) return

        val existing = mutableSetOf<String>()
        tun.optJSONArray("exclude_package")?.let { arr ->
            for (i in 0 until arr.length()) {
                existing.add(arr.optString(i))
            }
        }
        existing.addAll(userExclusions)

        val merged = org.json.JSONArray().apply {
            existing.forEach { put(it) }
        }
        tun.put("exclude_package", merged)
        Log.i(TAG, "injected exclude_package: ${existing.size} apps")
    }

    /**
     * Inject `experimental.cache_file` for faster reconnect (DNS cache, RDRC
     * decisions, fakeip mappings persist across restarts) AND low-memory
     * tweaks for weak devices: shared DNS cache, no per-process routing.
     *
     * - `cache_file.enabled: true` — persists ~50KB of DNS/RDRC cache to disk
     *   so a reconnect after device sleep doesn't re-query everything.
     * - `cache_file.store_rdrc: true` — remembers which servers RDRC'd ("ruled
     *   direct"), skipping the DPI-resistance test on next round.
     * - `dns.independent_cache: false` — share one DNS cache across all servers
     *   (saves ~5-10MB RAM on weak phones; default is per-server cache).
     * - `route.find_process: false` — don't track per-process routes; expensive
     *   on Android (requires /proc walks per packet) and we don't use it.
     */
    private fun injectPerfTweaks(root: JSONObject): Int {
        var changes = 0

        // experimental.cache_file
        val experimental = root.optJSONObject("experimental") ?: JSONObject().also {
            root.put("experimental", it)
        }
        if (!experimental.has("cache_file")) {
            experimental.put("cache_file", JSONObject().apply {
                put("enabled", true)
                put("path", "cache.db")
                put("store_rdrc", true)
            })
            changes++
        }

        // dns.independent_cache → false (share cache, lower memory)
        val dns = root.optJSONObject("dns")
        if (dns != null && dns.optBoolean("independent_cache", false)) {
            dns.put("independent_cache", false)
            changes++
        }

        // route.find_process → false (cheaper packet routing on Android)
        val route = root.optJSONObject("route")
        if (route != null && route.optBoolean("find_process", false)) {
            route.put("find_process", false)
            changes++
        }

        return changes
    }

    /**
     * Find tags of `{type:"direct"}` outbounds which have no extra fields beyond
     * type/tag (so-called "empty direct outbound"). sing-box 1.13+ rejects
     * `detour` pointing to such outbounds in DNS servers, because using a detour
     * to a noop direct outbound is meaningless — sing-box's default routing
     * already does direct for unmatched traffic.
     */
    private fun findEmptyDirectOutbounds(root: JSONObject): Set<String> {
        val outbounds = root.optJSONArray("outbounds") ?: return emptySet()
        val tags = mutableSetOf<String>()
        for (i in 0 until outbounds.length()) {
            val ob = outbounds.optJSONObject(i) ?: continue
            if (ob.optString("type") != "direct") continue
            val tag = ob.optString("tag", "")
            if (tag.isEmpty()) continue
            // Check if any field besides type/tag is set
            val keys = ob.keys()
            var hasExtra = false
            while (keys.hasNext()) {
                val k = keys.next()
                if (k != "type" && k != "tag") {
                    hasExtra = true
                    break
                }
            }
            if (!hasExtra) tags.add(tag)
        }
        return tags
    }

    private fun stripDnsServerDetour(root: JSONObject, directTags: Set<String>): Int {
        if (directTags.isEmpty()) return 0
        val dns = root.optJSONObject("dns") ?: return 0
        val servers = dns.optJSONArray("servers") ?: return 0
        var stripped = 0
        for (i in 0 until servers.length()) {
            val srv = servers.optJSONObject(i) ?: continue
            val detour = srv.optString("detour", "")
            if (detour.isNotEmpty() && directTags.contains(detour)) {
                srv.remove("detour")
                stripped++
            }
        }
        return stripped
    }

    private fun migrateDnsServers(root: JSONObject): Int {
        val dns = root.optJSONObject("dns") ?: return 0
        val servers = dns.optJSONArray("servers") ?: return 0
        var migrated = 0
        for (i in 0 until servers.length()) {
            val srv = servers.optJSONObject(i) ?: continue
            if (srv.has("type")) continue  // already new format
            val address = srv.optString("address", "")
            if (address.isEmpty()) continue
            migrated++
            srv.remove("address")
            when {
                address == "fakeip" -> {
                    srv.put("type", "fakeip")
                }
                address.contains("://") -> {
                    val scheme = address.substringBefore("://")
                    val rest = address.substringAfter("://")
                    val hostPart = rest.substringBefore("/")
                    if (hostPart.contains(":")) {
                        srv.put("server", hostPart.substringBefore(":"))
                        srv.put("server_port", hostPart.substringAfter(":").toIntOrNull() ?: 0)
                    } else {
                        srv.put("server", hostPart)
                    }
                    srv.put("type", scheme)
                    if (rest.contains("/")) {
                        val path = "/" + rest.substringAfter("/")
                        if (path != "/") srv.put("path", path)
                    }
                }
                else -> {
                    srv.put("type", "udp")
                    if (address.contains(":")) {
                        srv.put("server", address.substringBefore(":"))
                        srv.put("server_port", address.substringAfter(":").toIntOrNull() ?: 53)
                    } else {
                        srv.put("server", address)
                    }
                }
            }
            if (srv.has("address_resolver")) {
                srv.put("domain_resolver", srv.getString("address_resolver"))
                srv.remove("address_resolver")
            }
        }
        return migrated
    }

    /**
     * Remove outbound entries with matching `type`. Return list of removed tags
     * so we can rewrite route rules that reference them.
     */
    private fun stripOutboundsByType(root: JSONObject, targetType: String): Pair<Int, Set<String>> {
        val outbounds = root.optJSONArray("outbounds") ?: return 0 to emptySet()
        val tags = mutableSetOf<String>()
        val kept = org.json.JSONArray()
        for (i in 0 until outbounds.length()) {
            val ob = outbounds.optJSONObject(i)
            if (ob != null && ob.optString("type") == targetType) {
                val tag = ob.optString("tag", "")
                if (tag.isNotEmpty()) tags.add(tag)
            } else if (ob != null) {
                kept.put(ob)
            }
        }
        if (tags.isEmpty()) return 0 to emptySet()
        root.put("outbounds", kept)
        return tags.size to tags
    }

    /**
     * In `route.rules`, replace `{ outbound: "<removed-tag>" }` with
     * `{ action: "<actionName>" }` for any tag in [removedTags].
     */
    private fun rewriteOutboundRules(root: JSONObject, removedTags: Set<String>, actionName: String): Int {
        if (removedTags.isEmpty()) return 0
        val route = root.optJSONObject("route") ?: return 0
        val rules = route.optJSONArray("rules") ?: return 0
        var rewritten = 0
        for (i in 0 until rules.length()) {
            val r = rules.optJSONObject(i) ?: continue
            val ob = r.optString("outbound", "")
            if (ob.isNotEmpty() && removedTags.contains(ob)) {
                r.remove("outbound")
                r.put("action", actionName)
                rewritten++
            }
        }
        return rewritten
    }

    // ── Internal ────────────────────────────────────────────────────

    private fun ensureSetup() {
        Log.i(TAG, "ensureSetup() entry, setupDone=$setupDone")
        if (setupDone) return
        synchronized(CoreManager::class.java) {
            if (setupDone) return
            val ctx = service.applicationContext
            Log.i(TAG, "ensureSetup: loading libgojni.so")
            try {
                System.loadLibrary("gojni")
                Log.i(TAG, "ensureSetup: libgojni.so loaded OK")
            } catch (e: UnsatisfiedLinkError) {
                Log.e(TAG, "ensureSetup: System.loadLibrary(gojni) failed", e)
                throw e
            }
            Log.i(TAG, "ensureSetup: Class.forName(Libbox)")
            try {
                Class.forName("io.nekohasekai.libbox.Libbox")
                Log.i(TAG, "ensureSetup: Libbox class loaded")
            } catch (t: Throwable) {
                Log.e(TAG, "ensureSetup: Class.forName(Libbox) failed", t)
                throw t
            }
            Log.i(TAG, "ensureSetup: new SetupOptions()")
            val opts = SetupOptions()
            Log.i(TAG, "ensureSetup: configuring paths")
            opts.basePath = ctx.filesDir.absolutePath
            val working = File(ctx.filesDir, "sing-box").apply { mkdirs() }
            opts.workingPath = working.absolutePath
            opts.tempPath = ctx.cacheDir.absolutePath
            opts.fixAndroidStack = true
            opts.oomKillerDisabled = true
            opts.logMaxLines = 2048
            opts.commandServerListenPort = 0

            Log.i(TAG, "ensureSetup: calling Libbox.setup(opts) basePath=${opts.basePath}")
            Libbox.setup(opts)
            setupDone = true
            Log.i(TAG, "Libbox.setup done; basePath=${opts.basePath}, version=${coreVersion()}")
        }
    }
}
