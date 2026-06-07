import 'dart:convert';

/// Утилита для патча sing-box JSON конфига от `/api/sub/{token}`.
///
/// **Зачем нужно**: backend отдаёт многосерверный конфиг с
/// `selector` outbound (`tag: 'proxy'`) который по умолчанию выбирает
/// `proxyTags[0]` (первый сервер из списка). Если юзер в UI выбрал
/// конкретную локацию (selectedServer), мы хотим **форсить** этот
/// сервер, а не оставлять auto-selector.
///
/// **Как работает**:
///   1. Парсим JSON в `Map<String, dynamic>`.
///   2. Ищем в `outbounds` запись с `type: 'vless'` чей `tag` содержит
///      русское название страны выбранного сервера ("Германия", "Нидерланды").
///   3. Подменяем у `outbound { tag: 'proxy' }` поле `default` на
///      найденный tag.
///   4. Также обновляем `route.final` если он был `'proxy'` — на тот
///      же tag (чтобы DNS и роутинг тоже шли через наш выбранный сервер).
///
/// **Ограничения**:
///   - Match по country name работает потому что бэкенд формирует tag
///     как `"🇩🇪 Германия | <имя>"` (см. `lib/sub-token.ts::buildServerTag`
///     в hundlerminiapp). Если бэкенд изменит формат — патч сломается
///     "молча" (просто не будет эффекта, упадёт обратно в auto-selector).
///   - Если в одной стране несколько серверов — выбирается первый
///     найденный. Точный match по host'у невозможен потому что
///     `/api/servers` возвращает `host: 'hidden'` (см. memory от 2026-05-12,
///     "RKN Hardering" anti-detection batch).
///   - Если selectedServer == null или country пустой — НЕ патчим,
///     возвращаем JSON как есть (auto-selector).
class SingboxConfigPatch {
  SingboxConfigPatch._();

  /// Главный entry-point. Принимает оригинальный JSON-стринг и country
  /// code (ISO-2). Возвращает новый JSON-стринг с подменённым default.
  ///
  /// На любой ошибке парсинга / отсутствии selector outbound возвращает
  /// исходный JSON без изменений.
  static String pinSelectedServer({
    required String configJson,
    required String? countryIso,
    String protocolType = 'vless',
  }) {
    if (countryIso == null || countryIso.trim().isEmpty) {
      return configJson;
    }
    try {
      final root = jsonDecode(configJson);
      if (root is! Map<String, dynamic>) return configJson;

      final outbounds = root['outbounds'];
      if (outbounds is! List) return configJson;

      final countryName = _countryName(countryIso.toUpperCase());
      if (countryName.isEmpty) return configJson;

      // Шаг 1: ищем outbound запрошенного типа по country.
      String? matchedTag;
      for (final ob in outbounds) {
        if (ob is! Map) continue;
        final type = ob['type'];
        final tag = ob['tag'];
        if (type != protocolType || tag is! String) continue;
        if (tag.contains(countryName)) {
          matchedTag = tag;
          break;
        }
      }
      if (matchedTag == null) return configJson;

      // Шаг 2: меняем selector default.
      bool patched = false;
      for (final ob in outbounds) {
        if (ob is! Map) continue;
        if (ob['type'] == 'selector' && ob['tag'] == 'proxy') {
          ob['default'] = matchedTag;
          patched = true;
        }
      }
      if (!patched) {
        // Если selector'а нет (1 сервер в подписке) — нечего патчить,
        // возвращаем как есть (тот единственный outbound и так используется).
        return configJson;
      }

      // Шаг 3: route.final → matchedTag если был 'proxy'.
      // Это критично: иначе пакеты пойдут через первый сервер, а не выбранный.
      final route = root['route'];
      if (route is Map<String, dynamic>) {
        final finalTag = route['final'];
        if (finalTag == 'proxy' || finalTag == null) {
          // Selector сам разруливает 'proxy' через свой default — оставляем
          // 'proxy'. Менять final напрямую на конкретный outbound не нужно
          // (даже вредно: route.final='proxy' плюс selector default=...
          // даёт ОДИН источник правды — сам selector).
        }
      }

      // Шаг 4: dns.servers[].detour: если detour был proxyTags[0] и он
      // отличается от matchedTag — обновим, чтобы DNS-запросы тоже шли
      // через выбранный сервер.
      final dns = root['dns'];
      if (dns is Map<String, dynamic>) {
        final servers = dns['servers'];
        if (servers is List) {
          for (final s in servers) {
            if (s is Map && s['tag'] == 'dns-proxy') {
              s['detour'] = matchedTag;
            }
          }
        }
      }

      return jsonEncode(root);
    } catch (_) {
      // Любая ошибка → fallback на исходный конфиг.
      return configJson;
    }
  }

  /// Защищает DNS-резолв доменов VLESS-серверов от chicken-and-egg.
  ///
  /// **Проблема**: бэкенд отдаёт конфиг с `dns.final = "dns-proxy"`
  /// (DNS по умолчанию идёт через прокси). Это значит когда sing-box
  /// стартует и хочет резолвить адрес VLESS-сервера (например
  /// `de.hundlervpn.xyz`), DNS-запрос **идёт через сам VLESS-outbound**,
  /// который ещё не подключен потому что не знает IP сервера.
  /// Результат: 10-секундный timeout `dns: exchange failed for
  /// de.hundlervpn.xyz: context deadline exceeded`, потом sing-box
  /// падает.
  ///
  /// **Фикс**: вытаскиваем все домены VLESS-серверов из `outbounds`,
  /// добавляем первым правилом `dns.rules`:
  /// `{ "domain": [<server_domains>], "server": "dns-bootstrap" }`.
  /// Bootstrap-DNS (1.1.1.1 UDP) идёт через direct → петли нет.
  ///
  /// Также прописываем `route.default_domain_resolver: "dns-bootstrap"` —
  /// это убирает WARN `missing route.default_domain_resolver or
  /// domain_resolver in dial fields is deprecated in sing-box 1.12.0`.
  static String injectServerDomainBootstrap(String configJson) {
    try {
      final root = jsonDecode(configJson);
      if (root is! Map<String, dynamic>) return configJson;

      // Собрать серверные домены (IP-адреса пропускаем, их не нужно
      // резолвить). hysteria2 включён сюда чтобы при будущей миграции
      // DE Hy2 на полноценное DNS-имя (Let's Encrypt rollout) bootstrap
      // тоже сработал.
      const proxyProtocols = {
        'vless', 'trojan', 'hysteria2', 'hysteria',
        'tuic', 'shadowsocks', 'vmess',
      };
      final outbounds = root['outbounds'];
      final serverDomains = <String>{};
      if (outbounds is List) {
        final ipRegex = RegExp(r'^\d{1,3}(\.\d{1,3}){3}$');
        for (final ob in outbounds) {
          if (ob is! Map) continue;
          if (!proxyProtocols.contains(ob['type'])) continue;
          final server = ob['server'];
          if (server is! String || server.isEmpty) continue;
          if (ipRegex.hasMatch(server)) continue;
          serverDomains.add(server);
        }
      }

      // dns.rules: добавляем правило для server-доменов.
      final dns = root['dns'];
      if (dns is Map<String, dynamic> && serverDomains.isNotEmpty) {
        var dnsRules = dns['rules'];
        if (dnsRules is! List) {
          dnsRules = <dynamic>[];
          dns['rules'] = dnsRules;
        }
        // Не добавляем повторно если уже есть правило с этими
        // доменами → bootstrap.
        final alreadyMapped = dnsRules.any((r) =>
            r is Map &&
            r['server'] == 'dns-bootstrap' &&
            r['domain'] is List &&
            (r['domain'] as List).any(serverDomains.contains));
        if (!alreadyMapped) {
          dnsRules.insert(0, {
            'domain': serverDomains.toList(),
            'server': 'dns-bootstrap',
          });
        }
      }

      // route.default_domain_resolver = dns-bootstrap — убирает WARN
      // `missing route.default_domain_resolver`. Outbound dial fields
      // используют его для резолва server-доменов.
      final route = root['route'];
      if (route is Map<String, dynamic> &&
          (route['default_domain_resolver'] == null ||
              route['default_domain_resolver'] == '')) {
        route['default_domain_resolver'] = 'dns-bootstrap';
      }

      return jsonEncode(root);
    } catch (_) {
      return configJson;
    }
  }

  /// Проверяет есть ли в конфиге хотя бы один outbound данного типа.
  /// Используется vpn_controller'ом перед стартом — если юзер выбрал
  /// Hysteria, но бэкенд её не отдал, показываем понятную ошибку
  /// вместо FATAL "no outbound matched" от sing-box.
  static bool hasOutboundOfType(String configJson, String type) {
    try {
      final root = jsonDecode(configJson);
      if (root is! Map<String, dynamic>) return false;
      final obs = root['outbounds'];
      if (obs is! List) return false;
      return obs.any((o) => o is Map && o['type'] == type);
    } catch (_) {
      return false;
    }
  }

  /// Удаляет из конфига все «proxy»-outbound'ы кроме выбранного типа.
  ///
  /// Это нужно когда юзер переключился с VLESS на Hysteria — иначе
  /// selector default = «vless-de-tag» останется в силе, и sing-box
  /// будет роутить трафик через VLESS даже если юзер выбрал Hy2.
  ///
  /// Селекторы / urltest / direct / dns-outbound — НЕ трогаем
  /// (они служебные). Их `outbounds[]`-listы тоже фильтруем чтобы
  /// убрать tag'и удалённых outbound'ов.
  static String filterOutboundsByProtocol({
    required String configJson,
    required String keepType,
  }) {
    try {
      final root = jsonDecode(configJson);
      if (root is! Map<String, dynamic>) return configJson;
      final obs = root['outbounds'];
      if (obs is! List) return configJson;

      // proxy-types которые надо отфильтровать (всё кроме служебных).
      const proxyTypes = {
        'vless', 'vmess', 'trojan', 'shadowsocks', 'hysteria',
        'hysteria2', 'tuic', 'wireguard', 'socks', 'http',
      };
      // Служебные — оставляем всегда.
      const keepTags = <String>{};

      // Собираем tags которые удаляем (proxy-типа но НЕ keepType).
      final removedTags = <String>{};
      for (final ob in obs) {
        if (ob is! Map) continue;
        final type = ob['type'];
        final tag = ob['tag'];
        if (type is! String || tag is! String) continue;
        if (proxyTypes.contains(type) && type != keepType) {
          removedTags.add(tag);
        }
      }

      // Удаляем сами outbound'ы.
      final filtered = obs.where((ob) {
        if (ob is! Map) return true;
        final tag = ob['tag'];
        if (tag is! String) return true;
        if (keepTags.contains(tag)) return true;
        return !removedTags.contains(tag);
      }).toList();

      // Чистим внутренние outbounds[]-listы у selector / urltest от
      // удалённых тегов.
      for (final ob in filtered) {
        if (ob is! Map) continue;
        final inner = ob['outbounds'];
        if (inner is! List) continue;
        final cleaned = inner
            .where((t) => !(t is String && removedTags.contains(t)))
            .toList();
        ob['outbounds'] = cleaned;

        // Если default указывал на удалённый — переписываем на первый
        // оставшийся (если есть).
        final def = ob['default'];
        if (def is String && removedTags.contains(def)) {
          if (cleaned.isNotEmpty && cleaned.first is String) {
            ob['default'] = cleaned.first;
          } else {
            ob.remove('default');
          }
        }
      }

      root['outbounds'] = filtered;
      return jsonEncode(root);
    } catch (_) {
      return configJson;
    }
  }

  /// Добавляет `mixed` (HTTP+SOCKS5) inbound на `127.0.0.1:7890`
  /// вместо TUN. Используется когда юзер выбрал режим Proxy.
  ///
  /// Mixed inbound принимает И HTTP CONNECT (для браузеров через
  /// настройки прокси), И SOCKS5 (для Telegram / Tg Desktop / приложений
  /// которые умеют SOCKS). Один порт — обе схемы.
  ///
  /// `listen: 127.0.0.1` — **локальный** интерфейс, никто из локальной
  /// сети не может подключиться. Если позже потребуется LAN-share —
  /// поменять на `0.0.0.0` (требует firewall-правило).
  ///
  /// **НЕ** ставит маршруты, **НЕ** трогает системные DNS. Юзер сам
  /// прописывает прокси в браузере (Settings → Network → Proxy →
  /// HTTP/SOCKS5 на 127.0.0.1:7890).
  static String injectProxyInbound(String configJson) {
    try {
      final root = jsonDecode(configJson);
      if (root is! Map<String, dynamic>) return configJson;

      // Убираем существующий TUN-inbound (если уже инжектили).
      final inbounds = root['inbounds'];
      List<dynamic> ibs;
      if (inbounds is List) {
        ibs = inbounds.where((ib) {
          return !(ib is Map && ib['type'] == 'tun');
        }).toList();
      } else {
        ibs = <dynamic>[];
      }

      // Не дублируем mixed.
      final hasMixed = ibs.any((ib) => ib is Map && ib['type'] == 'mixed');
      if (!hasMixed) {
        ibs.insert(0, {
          'type': 'mixed',
          'tag': 'mixed-in',
          'listen': '127.0.0.1',
          'listen_port': 7890,
        });
      }
      root['inbounds'] = ibs;

      // В proxy-mode TUN не нужен → sniff/hijack-dns тоже не критичны.
      // Но если уже добавлены — оставляем (не помешают).
      return jsonEncode(root);
    } catch (_) {
      return configJson;
    }
  }

  /// Добавляет TUN inbound в конфиг если его там нет.
  ///
  /// **Зачем нужно**: бэкенд `app/api/sub/[token]/route.ts` отдаёт
  /// конфиг **без `inbounds`** — потому что разные клиенты создают
  /// inbound по-разному (Android через `VpnService.Builder`, iOS через
  /// `NEPacketTunnelProvider`). Sing-box без inbound просто работает
  /// как прокси-сервер, не перехватывает системный трафик —
  /// именно поэтому на Windows был зелёный «Защищено», но YouTube
  /// открывался напрямую с RU IP.
  ///
  /// **Источник правды для параметров** — Android `CoreManager.kt::
  /// injectTunInboundIfMissing()` (память от 2026-05-12, batch
  /// «RKN Hardering»):
  ///   - address `10.7.0.1/30` (WireGuard-style, не дефолтный
  ///     sing-box `172.19.0.0/30` — RKN-детекторы палят его как
  ///     fingerprint)
  ///   - MTU 1500 (стандарт Ethernet, лучше для Reality TLS framing)
  ///   - `endpoint_independent_nat: false` + `udp_timeout: "30s"` —
  ///     для стабильных UDP-соединений (QUIC, WebRTC)
  ///   - `auto_route: true` — sing-box сам пропишет дефолтный route
  ///   - `strict_route: false` — ВАЖНО: true на Windows ломает
  ///     прямое соединение к VLESS-серверу (блокирует трафик мимо
  ///     туннеля → handshake до сервера невозможен)
  ///   - `stack: "system"` — на Windows = wintun-драйвер (быстрый
  ///     kernel-mode); `"gvisor"` чисто userspace, медленнее в 2x
  ///   - `sniff: true` — позволяет route rules матчить по domain
  ///     даже когда юзер пишет IP напрямую
  static String injectTunInboundIfMissing(String configJson) {
    try {
      final root = jsonDecode(configJson);
      if (root is! Map<String, dynamic>) return configJson;

      // Если уже есть какой-то inbound с type=tun — не трогаем,
      // бэкенд знает лучше. Иначе добавляем дефолтный.
      final inbounds = root['inbounds'];
      if (inbounds is List) {
        for (final ib in inbounds) {
          if (ib is Map && ib['type'] == 'tun') return configJson;
        }
      }

      // Sing-box 1.13+ удалил из inbound поля `sniff`,
      // `sniff_override_destination`, `sniff_timeout`, `domain_strategy`.
      // Их функциональность перенесена в `route.rules` через
      // `action: "sniff"` и `action: "resolve"`. Если оставить старые
      // поля — FATAL `legacy inbound fields are deprecated`. См.
      // https://sing-box.sagernet.org/migration/#migrate-legacy-inbound-fields-to-rule-actions
      //
      // `interface_name` — УНИКАЛЬНЫЙ при каждом запуске. Без этого
      // после disconnect wintun драйвер ~15-30 сек удерживает старый
      // адаптер "Hundler" в реестре, и новый запуск падает с
      // `Cannot create a file when that file already exists.`
      // Имя ≤64 символа, только ASCII (требование wintun).
      final ifaceName =
          'Hundler-${DateTime.now().millisecondsSinceEpoch ~/ 1000}';
      final tunInbound = <String, dynamic>{
        'type': 'tun',
        'tag': 'tun-in',
        'interface_name': ifaceName,
        'address': ['10.7.0.1/30'],
        'mtu': 1500,
        'auto_route': true,
        'strict_route': false,
        'stack': 'system',
        'endpoint_independent_nat': false,
        'udp_timeout': '30s',
      };

      if (inbounds is List) {
        inbounds.insert(0, tunInbound);
      } else {
        root['inbounds'] = [tunInbound];
      }

      // Заменяем legacy `sniff` (из inbound) на route-rule. Также
      // добавляем hijack-dns если бэкенд этого не сделал — иначе
      // DNS-leak: запросы пойдут на системный resolver (RU DNS).
      final route = root['route'];
      if (route is Map<String, dynamic>) {
        var rulesList = route['rules'];
        if (rulesList is! List) {
          rulesList = <dynamic>[];
          route['rules'] = rulesList;
        }

        // 1) sniff первым — анализирует TLS SNI / HTTP Host чтобы
        //    matchить domain-rules даже когда юзер пишет IP.
        final hasSniff = rulesList.any((r) => r is Map && r['action'] == 'sniff');
        if (!hasSniff) {
          rulesList.insert(0, {'action': 'sniff'});
        }

        // 2) hijack-dns — DNS-запросы перехватываются и идут через
        //    sing-box DNS-resolver (а не на системный 127.0.0.53).
        final hasHijack = rulesList.any((r) =>
            r is Map &&
            (r['action'] == 'hijack-dns' ||
                (r['protocol'] == 'dns' && r['outbound'] == 'dns-out')));
        if (!hasHijack) {
          // После sniff (на индекс 1).
          final insertAt = hasSniff ? 0 : 1;
          rulesList.insert(insertAt, {'protocol': 'dns', 'action': 'hijack-dns'});
        }
      }

      return jsonEncode(root);
    } catch (_) {
      return configJson;
    }
  }

  /// Чинит конфиг под sing-box 1.12+ который ужесточил валидацию
  /// `detour` в DNS-серверах.
  ///
  /// **Проблема**: бэкенд отдаёт DNS-сервера с `detour: "direct"`,
  /// а `direct` outbound у нас пустой (`{ type: "direct", tag: "direct" }`)
  /// без явных dial-параметров. sing-box 1.12+ требует «осмысленный»
  /// detour и падает с FATAL:
  ///
  ///   start service: start dns/udp[dns-bootstrap]:
  ///   detour to an empty direct outbound makes no sense
  ///
  /// **Фикс**: убираем поле `detour` у тех DNS-серверов где значение
  /// равно `"direct"`. Без detour sing-box использует дефолтный route,
  /// который и есть direct → поведение идентичное, просто без явной
  /// ссылки на пустой outbound.
  ///
  /// На любой ошибке парсинга → возвращает исходный JSON.
  static String applySingbox12Compat(String configJson) {
    try {
      final root = jsonDecode(configJson);
      if (root is! Map<String, dynamic>) return configJson;
      final dns = root['dns'];
      if (dns is! Map<String, dynamic>) return configJson;
      final servers = dns['servers'];
      if (servers is! List) return configJson;

      var changed = false;
      for (final s in servers) {
        if (s is! Map) continue;
        if (s['detour'] == 'direct') {
          s.remove('detour');
          changed = true;
        }
        // Также для нового формата с `domain_resolver` — если он
        // ссылается на сервер чей detour мы только что сняли,
        // ничего не делаем (domain_resolver — это tag DNS-сервера,
        // а не outbound, остаётся валидным).
      }
      if (!changed) return configJson;
      return jsonEncode(root);
    } catch (_) {
      return configJson;
    }
  }

  /// ISO-2 → русское название страны как его пишет бэкенд в outbound.tag.
  ///
  /// Источник правды: `hundlerminiapp/lib/sub-token.ts::COUNTRY_NAMES_RU`.
  /// Дублируем здесь чтобы избежать рантайм-зависимости от формата API.
  static String _countryName(String iso) {
    switch (iso) {
      case 'DE':
        return 'Германия';
      case 'NL':
        return 'Нидерланды';
      case 'RU':
        return 'Россия';
      case 'US':
        return 'США';
      case 'GB':
        return 'Великобритания';
      case 'FR':
        return 'Франция';
      case 'JP':
        return 'Япония';
      case 'FI':
        return 'Финляндия';
      case 'SE':
        return 'Швеция';
      case 'PL':
        return 'Польша';
      case 'TR':
        return 'Турция';
      case 'CH':
        return 'Швейцария';
      case 'AT':
        return 'Австрия';
      case 'IT':
        return 'Италия';
      case 'ES':
        return 'Испания';
      case 'CZ':
        return 'Чехия';
      case 'NO':
        return 'Норвегия';
      case 'LT':
        return 'Литва';
      case 'LV':
        return 'Латвия';
      case 'EE':
        return 'Эстония';
      default:
        return '';
    }
  }
}
