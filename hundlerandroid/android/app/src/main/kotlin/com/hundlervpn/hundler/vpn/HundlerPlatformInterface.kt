package com.hundlervpn.hundler.vpn

import android.annotation.SuppressLint
import android.content.Context
import android.net.ConnectivityManager
import android.net.LinkProperties
import android.net.Network
import android.net.NetworkCapabilities
import android.net.NetworkRequest
import android.net.wifi.WifiManager
import android.os.Build
import android.os.Process
import android.util.Log
import io.nekohasekai.libbox.InterfaceUpdateListener
import io.nekohasekai.libbox.LocalDNSTransport
import io.nekohasekai.libbox.NeighborUpdateListener
import io.nekohasekai.libbox.NetworkInterfaceIterator
import io.nekohasekai.libbox.Notification as LibboxNotification
import io.nekohasekai.libbox.PlatformInterface
import io.nekohasekai.libbox.StringIterator
import io.nekohasekai.libbox.TunOptions
import io.nekohasekai.libbox.WIFIState
import java.lang.ref.WeakReference

// Android sing-box PlatformInterface bridge.
// Comments kept ASCII-only because some Kotlin compiler/Windows JVM combos
// mis-decode UTF-8 source files on cyrillic Windows locale (CP1251), which
// breaks parsing of non-ASCII comments. Keep this file ASCII to be safe.
class HundlerPlatformInterface(
    service: HundlerVpnService,
) : PlatformInterface {

    companion object {
        private const val TAG = "HundlerPI"
    }

    private val serviceRef = WeakReference(service)
    private val context: Context = service.applicationContext

    @Volatile
    private var myInterfaceName: String? = null

    private var defaultNetworkCallback: ConnectivityManager.NetworkCallback? = null

    private val service: HundlerVpnService?
        get() = serviceRef.get()

    private val connectivityManager: ConnectivityManager
        get() = context.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager

    // -------- TUN --------

    override fun openTun(options: TunOptions): Int {
        val svc = service ?: throw IllegalStateException("VPN service is gone")
        Log.i(TAG, "openTun(): MTU=${options.getMTU()}, autoRoute=${options.getAutoRoute()}")
        return svc.buildTun(options)
    }

    override fun autoDetectInterfaceControl(fd: Int) {
        val svc = service ?: return
        val ok = svc.protect(fd)
        if (!ok) {
            Log.w(TAG, "VpnService.protect($fd) returned false")
        }
    }

    override fun usePlatformAutoDetectInterfaceControl(): Boolean = true

    override fun useProcFS(): Boolean = true

    // -------- Interface list --------

    override fun getInterfaces(): NetworkInterfaceIterator {
        return NetworkInterfaceList(listNetworkInterfaces(myInterfaceName))
    }

    override fun registerMyInterface(name: String) {
        Log.d(TAG, "registerMyInterface($name)")
        myInterfaceName = name
    }

    override fun includeAllNetworks(): Boolean = false

    // -------- DNS / TLS --------

    override fun localDNSTransport(): LocalDNSTransport? = null

    override fun systemCertificates(): StringIterator? = null

    override fun clearDNSCache() {
        Log.v(TAG, "clearDNSCache() no-op")
    }

    // -------- Per-app routing --------

    @SuppressLint("NewApi")
    override fun findConnectionOwner(
        ipProto: Int,
        sourceAddress: String,
        sourcePort: Int,
        destinationAddress: String,
        destinationPort: Int,
    ): io.nekohasekai.libbox.ConnectionOwner {
        val owner = io.nekohasekai.libbox.ConnectionOwner()
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
            return owner
        }
        val cm = connectivityManager
        val local = try {
            java.net.InetSocketAddress(sourceAddress, sourcePort)
        } catch (_: IllegalArgumentException) {
            return owner
        }
        val remote = try {
            java.net.InetSocketAddress(destinationAddress, destinationPort)
        } catch (_: IllegalArgumentException) {
            return owner
        }
        val uid = try {
            cm.getConnectionOwnerUid(ipProto, local, remote)
        } catch (e: SecurityException) {
            Log.w(TAG, "getConnectionOwnerUid failed", e); -1
        }
        if (uid <= 0 || uid == Process.INVALID_UID) return owner
        owner.setUserId(uid)
        val pm = context.packageManager
        val packages = pm.getPackagesForUid(uid)?.toList().orEmpty()
        if (packages.isNotEmpty()) {
            owner.setUserName(packages.first())
            owner.setAndroidPackageNames(StringList(packages))
        }
        return owner
    }

    // -------- WiFi state --------

    @SuppressLint("MissingPermission")
    override fun readWIFIState(): WIFIState {
        val wm = context.applicationContext
            .getSystemService(Context.WIFI_SERVICE) as? WifiManager
            ?: return WIFIState("", "")
        @Suppress("DEPRECATION")
        val info = runCatching { wm.connectionInfo }.getOrNull()
            ?: return WIFIState("", "")
        @Suppress("DEPRECATION")
        val ssid = info.getSSID().orEmpty().trim('"')
        @Suppress("DEPRECATION")
        val bssid = info.getBSSID().orEmpty()
        return WIFIState(ssid, bssid)
    }

    // -------- Notifications from Go side --------

    override fun sendNotification(notification: LibboxNotification) {
        val title = notification.getTitle().orEmpty()
        val body = notification.getBody().orEmpty()
        Log.i(TAG, "sing-box notif: [$title] $body")
        service?.updateNotificationText("$title: $body")
    }

    // -------- Default network monitor --------

    override fun startDefaultInterfaceMonitor(listener: InterfaceUpdateListener) {
        if (defaultNetworkCallback != null) {
            Log.w(TAG, "default network monitor already started")
            return
        }
        val cm = connectivityManager
        val callback = object : ConnectivityManager.NetworkCallback() {
            override fun onAvailable(network: Network) {
                forwardDefaultNetwork(listener, network, cm)
            }
            override fun onLinkPropertiesChanged(network: Network, lp: LinkProperties) {
                forwardDefaultNetwork(listener, network, cm)
            }
            override fun onLost(network: Network) {
                runCatching {
                    listener.updateDefaultInterface("", -1, false, false)
                }
            }
        }
        defaultNetworkCallback = callback
        val req = NetworkRequest.Builder()
            .addCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
            .build()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
            cm.registerDefaultNetworkCallback(callback)
        } else {
            cm.registerNetworkCallback(req, callback)
        }
    }

    override fun closeDefaultInterfaceMonitor(listener: InterfaceUpdateListener) {
        val cb = defaultNetworkCallback ?: return
        runCatching { connectivityManager.unregisterNetworkCallback(cb) }
        defaultNetworkCallback = null
    }

    private fun forwardDefaultNetwork(
        listener: InterfaceUpdateListener,
        network: Network,
        cm: ConnectivityManager,
    ) {
        val lp = cm.getLinkProperties(network) ?: return
        val name = lp.interfaceName ?: return
        val caps = cm.getNetworkCapabilities(network)
        val isExpensive = caps?.hasCapability(NetworkCapabilities.NET_CAPABILITY_NOT_METERED) == false
        val isConstrained = false
        val idx = runCatching {
            java.net.NetworkInterface.getByName(name)?.index ?: 0
        }.getOrDefault(0)
        runCatching {
            listener.updateDefaultInterface(name, idx, isExpensive, isConstrained)
        }
    }

    // -------- Neighbor table --------

    override fun startNeighborMonitor(listener: NeighborUpdateListener) {
        Log.v(TAG, "startNeighborMonitor unsupported on Android")
    }

    override fun closeNeighborMonitor(listener: NeighborUpdateListener) {
        // no-op
    }

    // -------- Misc --------

    override fun underNetworkExtension(): Boolean = false
}
