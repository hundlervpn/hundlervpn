package com.hundlervpn.hundler

import android.content.Intent
import com.hundlervpn.hundler.vpn.AppListChannel
import com.hundlervpn.hundler.vpn.VpnChannel
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine

class MainActivity : FlutterActivity() {
    private var vpnChannel: VpnChannel? = null
    private var appListChannel: AppListChannel? = null

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        vpnChannel = VpnChannel(this).also { it.attach(flutterEngine) }
        // AppListChannel — per-app exclusion: даёт Flutter UI'ю список
        // установленных приложений и persistence для исключений из VPN.
        // Использует applicationContext (а не activity), чтобы пережить
        // configuration changes.
        appListChannel = AppListChannel(applicationContext).also { it.attach(flutterEngine) }
    }

    @Deprecated("Deprecated in Java")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        // Сначала отдаём результат VpnChannel'у — он сам решит,
        // относится ли requestCode к нему.
        if (vpnChannel?.onPrepareResult(requestCode, resultCode) == true) return
        @Suppress("DEPRECATION")
        super.onActivityResult(requestCode, resultCode, data)
    }

    override fun onDestroy() {
        vpnChannel?.detach()
        vpnChannel = null
        appListChannel?.detach()
        appListChannel = null
        super.onDestroy()
    }
}
