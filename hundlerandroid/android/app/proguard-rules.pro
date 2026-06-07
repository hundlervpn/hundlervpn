# ProGuard / R8 правила для release-сборки Hundler VPN.
#
# Базовое: оставлять Flutter engine, Kotlin reflection, AndroidX,
# Play services. Это минимальный безопасный набор — добавляй сюда
# `-keep` правила по мере появления реальных краш-репортов из
# Play Console / Crashlytics.

# --- Flutter ---
-keep class io.flutter.** { *; }
-keep class io.flutter.plugins.** { *; }
-keep class io.flutter.plugin.** { *; }
-keep class io.flutter.embedding.** { *; }
-dontwarn io.flutter.embedding.**

# --- Kotlin ---
-keepattributes *Annotation*
-keepattributes SourceFile,LineNumberTable
-keep class kotlin.Metadata { *; }
-keep class kotlin.reflect.** { *; }
-dontwarn kotlin.reflect.**

# --- Coroutines ---
-keepnames class kotlinx.coroutines.internal.MainDispatcherFactory {}
-keepnames class kotlinx.coroutines.CoroutineExceptionHandler {}

# --- Hundler VPN: HundlerVpnService должен быть доступен по имени класса
#     потому что AndroidManifest и Intent ссылаются по строковому пути ---
-keep class com.hundlervpn.hundler.vpn.HundlerVpnService { *; }
-keep class com.hundlervpn.hundler.vpn.VpnChannel { *; }

# --- sing-box libcore.aar (когда добавим) — не вырезать JNI ---
# Раскомментировать после добавления libcore.aar:
# -keep class io.nekohasekai.libbox.** { *; }
# -keep class go.** { *; }
# -dontwarn io.nekohasekai.libbox.**

# --- Скрываем имена строк в release — экономит APK + усложняет
#     reverse-engineering. Если sing-box упадёт с reflection-ошибкой,
#     раскомментировать `-keepnames` для конкретного класса. ---
-renamesourcefileattribute SourceFile
