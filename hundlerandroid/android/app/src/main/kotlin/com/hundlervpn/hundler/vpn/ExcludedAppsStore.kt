package com.hundlervpn.hundler.vpn

import android.content.Context
import android.content.SharedPreferences

/**
 * Хранилище списка пакетов, которые НЕ должны идти через VPN.
 *
 * Один из главных анти-детект инструментов: приложения из этого списка
 * полностью обходят VPN-туннель (через `VpnService.Builder.addDisallowedApplication`),
 * поэтому внутри них:
 *   - capability TRANSPORT_VPN отсутствует
 *   - сеть видит обычный wlan0/mobile, без tun
 *   - DNS — системный провайдерский
 *   - IP — настоящий российский
 *
 * Так делают банки, госуслуги, СБП — и они **не палят VPN**, потому что
 * с их стороны VPN физически нет.
 *
 * ## Дефолтный пресет (RU банки + госуслуги + платёжки)
 *
 * Включается автоматически при первом запуске. Список основан на актуальных
 * package name из Google Play (2026) и RuStore. Если приложение не установлено
 * — оно просто молча игнорируется VpnService.Builder.
 *
 * Логика подбора:
 *   - **Банки** (детектят VPN жёстче всех): Сбер, Тинькофф, Альфа, ВТБ,
 *     Райффайзен, Газпромбанк, Открытие, Совкомбанк, Россельхозбанк,
 *     Хоум Кредит, МТС-Банк, Озон-Банк, ЮMoney.
 *   - **Госуслуги + ФНС**: основной gosuslugi-app + налоговое + ГИБДД-штрафы.
 *   - **Платежи**: МирПэй, СБП-app, Tinkoff Pay.
 *   - **Маркетплейсы** (используют ГеоIP + VPN-чекеры на оплату): Wildberries,
 *     Ozon, Yandex.Market, Лента, Магнит, Пятёрочка.
 *   - **Такси / доставка**: Яндекс.Такси, Яндекс.Еда, Купер (бывш. Сбер.Маркет),
 *     Самокат, Деливери.
 *   - **Соцсети / медиа** (любят geoblock'ить): VK, Mail.ru, Дзен, RuTube.
 */
class ExcludedAppsStore(private val context: Context) {

    private val prefs: SharedPreferences =
        context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

    /**
     * Возвращает множество исключённых пакетов. На первый вызов, если
     * пользователь ещё ничего не менял, заполняет дефолтным RU-пресетом
     * и сохраняет — дальше можно редактировать.
     */
    fun getExcludedPackages(): Set<String> {
        if (!prefs.contains(KEY_INITIALIZED)) {
            val defaults = RU_BANK_PRESET.toMutableSet()
            prefs.edit()
                .putStringSet(KEY_EXCLUDED, defaults)
                .putBoolean(KEY_INITIALIZED, true)
                .apply()
            return defaults
        }
        return prefs.getStringSet(KEY_EXCLUDED, emptySet()) ?: emptySet()
    }

    fun setExcludedPackages(packages: Set<String>) {
        prefs.edit()
            .putStringSet(KEY_EXCLUDED, packages)
            .putBoolean(KEY_INITIALIZED, true)
            .apply()
    }

    fun applyRuBankPreset() {
        // Объединяем с существующим списком — юзер мог добавить свои.
        val current = prefs.getStringSet(KEY_EXCLUDED, emptySet()) ?: emptySet()
        setExcludedPackages(current + RU_BANK_PRESET)
    }

    fun clearAll() {
        prefs.edit().putStringSet(KEY_EXCLUDED, emptySet()).apply()
    }

    companion object {
        private const val PREFS_NAME = "hundler_excluded_apps"
        private const val KEY_EXCLUDED = "excluded_packages"
        private const val KEY_INITIALIZED = "initialized_v1"

        /**
         * Дефолтный пресет: RU банки + госуслуги + платёжки + маркетплейсы.
         * Эти приложения 100% детектят VPN и блокируют доступ — исключаем
         * их по умолчанию, чтобы юзер сразу мог пользоваться Сбером, Госуслугами
         * и оплачивать на маркетплейсах без отключения VPN.
         *
         * Package names проверены в Google Play / RuStore (2026-Q2). Если
         * пакета нет на устройстве — VpnService.Builder тихо его игнорирует,
         * никаких ошибок.
         */
        val RU_BANK_PRESET: Set<String> = setOf(
            // ─── Банки ───
            "ru.sberbankmobile",                    // Сбербанк Онлайн
            "com.idamob.tinkoff.android",           // Т-Банк (бывш. Тинькофф)
            "ru.alfabank.mobile.android",           // Альфа-Банк
            "ru.vtb24.mobilebanking.android",       // ВТБ Онлайн
            "ru.raiffeisennews",                    // Райффайзен
            "ru.gazprombank.android.mobilebank.app",// Газпромбанк
            "ru.otkritie.online",                   // Открытие
            "ru.sovcombank.shopping",               // Совкомбанк (Халва)
            "ru.rshb.mbank",                        // Россельхозбанк
            "ru.homecredit.bank",                   // Хоум Кредит
            "ru.mts.money",                         // МТС Банк
            "ru.ozon.bank",                         // Озон Банк
            "ru.yoo.money",                         // ЮMoney (бывш. Я.Деньги)
            "com.dasha.tochka",                     // Точка
            "ru.psbank",                            // Промсвязьбанк
            // ─── Платёжные ───
            "ru.nspk.sbpay",                        // СБПэй
            "ru.nspk.mirpay",                       // Mir Pay
            // ─── Госуслуги / ФНС / ГИБДД ───
            "ru.rostel",                            // Госуслуги
            "ru.gosuslugi.dom",                     // Госуслуги Дом
            "ru.fns.flsmrm",                        // Налоги ФЛ (старый)
            "ru.gnivc.fnsmobile",                   // Налоги ФЛ (новый)
            "ru.gibdd_pay.app",                     // Штрафы ГИБДД
            // ─── Маркетплейсы (геоблок при оплате) ───
            "com.wildberries.ru",                   // Wildberries
            "ru.ozon.app.android",                  // OZON
            "ru.yandex.market",                     // Яндекс Маркет
            "com.lenta.lentochka",                  // Лента
            "ru.tander.magnit",                     // Магнит
            "ru.pyaterochka.app",                   // Пятёрочка
            // ─── Доставка / такси ───
            "ru.yandex.taxi",                       // Яндекс Go (такси)
            "ru.foodfox.client",                    // Яндекс.Еда
            "ru.instamart.android",                 // Купер (бывш. Сбер.Маркет)
            "ru.samokat.client",                    // Самокат
            "com.deliveryclub",                     // Деливери
            // ─── Соцсети / медиа (геоблок контента) ───
            "com.vkontakte.android",                // VK
            "ru.mail.mailapp",                      // Mail.ru почта
            "ru.zen.android",                       // Дзен
            "ru.rutube.app",                        // RuTube
            "ru.kinopoisk",                         // Кинопоиск (геоблок ТВ)
            "ru.ivi.client",                        // ivi
            "com.okko.hd",                          // Okko
        )
    }
}
