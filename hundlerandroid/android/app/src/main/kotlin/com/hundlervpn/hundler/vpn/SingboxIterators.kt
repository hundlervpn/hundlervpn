package com.hundlervpn.hundler.vpn

import io.nekohasekai.libbox.Libbox
import io.nekohasekai.libbox.NetworkInterface
import io.nekohasekai.libbox.NetworkInterfaceIterator
import io.nekohasekai.libbox.StringIterator
import java.net.InterfaceAddress

/**
 * Хелперы для работы с iterator-абстракциями `gomobile bind` API libbox.
 *
 * sing-box-овые `*.Iterator` интерфейсы требуют реализации `hasNext()` + `next()`
 * (плюс `len()` у строкового), а возвращаемые элементы — либо примитивы,
 * либо libbox-классы с публичным no-arg конструктором и `setX(...)`-методами,
 * через которые Go-сторона читает поля.
 *
 * Эти хелперы инкапсулируют конвертацию `List<*>` → нужный итератор и
 * избавляют platform-interface от мусора.
 */

/** Итератор по списку Java-строк. Нужен для DNS-серверов, package-фильтров и т.п. */
internal class StringList(private val items: List<String>) : StringIterator {
    private var index = 0
    override fun hasNext(): Boolean = index < items.size
    override fun len(): Int = items.size.toLong().toInt()
    override fun next(): String = items[index++]
}

/**
 * Итератор по сетевым интерфейсам, маппит [java.net.NetworkInterface] →
 * [io.nekohasekai.libbox.NetworkInterface]. sing-box использует этот список
 * чтобы (а) определить какой интерфейс — TUN (`registerMyInterface`),
 * (б) понять какой network up / down, (в) выбрать default route для
 * исходящих соединений.
 */
internal class NetworkInterfaceList(
    private val items: List<NetworkInterface>
) : NetworkInterfaceIterator {
    private var index = 0
    override fun hasNext(): Boolean = index < items.size
    override fun next(): NetworkInterface = items[index++]
}

/**
 * Сконвертировать [java.net.NetworkInterface] в libbox-форму. Адреса
 * пишем с префиксом (`192.168.1.5/24`) — sing-box ждёт CIDR.
 *
 * @param dnsServers резолверы, которые мы знаем для этой подсети
 *                   (обычно — ничего, потому что Android не даёт API
 *                   для per-network DNS без `Network.linkProperties`).
 *                   Передавать стоит из [android.net.LinkProperties] если есть.
 */
internal fun mapNetworkInterface(
    raw: java.net.NetworkInterface,
    dnsServers: List<String> = emptyList(),
    metered: Boolean = false,
    interfaceType: Int = Libbox.InterfaceTypeOther,
): NetworkInterface {
    val ni = NetworkInterface()
    // Используем явные setX() вместо kotlin-property-синтеза, потому что
    // имена с двумя uppercase-префиксами (`MTU`, `DNSServer`) Kotlin
    // мапит как `MTU`/`DNSServer`, а не `mtu`/`dnsServer` — легко
    // напутать. Явные вызовы убирают двусмысленность.
    ni.setIndex(raw.index)
    // `getMTU()` у java.net.NetworkInterface → Kotlin property `MTU`
    // (Java Bean rule для acronym), не `mtu`. Используем явный метод.
    ni.setMTU(runCatching { raw.getMTU() }.getOrDefault(0))
    ni.setName(raw.name)
    ni.setFlags(computeFlags(raw))
    ni.setType(interfaceType)
    ni.setMetered(metered)

    val addresses: List<String> = raw.interfaceAddresses
        .mapNotNull { addr: InterfaceAddress ->
            val host = addr.address ?: return@mapNotNull null
            val prefix = addr.networkPrefixLength.toInt()
            val ipStr = host.hostAddress?.substringBefore('%') ?: return@mapNotNull null
            // sing-box принимает IPv6 zone-id отдельным полем, поэтому
            // зону `%wlan0` режем здесь, иначе getByName внутри Go падает.
            "$ipStr/$prefix"
        }

    ni.setAddresses(StringList(addresses))
    ni.setDNSServer(StringList(dnsServers))
    return ni
}

/** Грубая эмуляция Linux `IFF_*` флагов из доступных Java-полей. */
private fun computeFlags(raw: java.net.NetworkInterface): Int {
    var flags = 0
    runCatching {
        if (raw.isUp) flags = flags or IFF_UP
        if (raw.isLoopback) flags = flags or IFF_LOOPBACK
        if (raw.isPointToPoint) flags = flags or IFF_POINTOPOINT
        if (raw.supportsMulticast()) flags = flags or IFF_MULTICAST
        // BROADCAST — выводим из наличия broadcast-адреса хотя бы у одного inet-адреса.
        if (raw.interfaceAddresses.any { it.broadcast != null }) flags = flags or IFF_BROADCAST
    }
    return flags
}

// IFF_* константы из <linux/if.h>. sing-box на Android читает именно эти
// битовые маски, потому что Go-сторона мапит их в свой `net.Flags`.
private const val IFF_UP = 0x1
private const val IFF_BROADCAST = 0x2
private const val IFF_LOOPBACK = 0x8
private const val IFF_POINTOPOINT = 0x10
private const val IFF_MULTICAST = 0x1000

/**
 * Собрать список не-loopback и не-tun сетевых интерфейсов.
 * `myInterfaceName` — имя нашего собственного TUN (от `registerMyInterface`),
 * чтобы sing-box не маршрутизировал трафик через свой же интерфейс
 * (иначе loop).
 */
internal fun listNetworkInterfaces(myInterfaceName: String?): List<NetworkInterface> {
    val raws = runCatching {
        java.net.NetworkInterface.getNetworkInterfaces()?.toList().orEmpty()
    }.getOrDefault(emptyList())
    return raws
        .asSequence()
        .filter { it.name != myInterfaceName }
        .filter { runCatching { it.isUp }.getOrDefault(false) }
        .map { mapNetworkInterface(it) }
        .toList()
}
