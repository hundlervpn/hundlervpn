plugins {
    id("com.android.application")
    id("kotlin-android")
    // The Flutter Gradle Plugin must be applied after the Android and Kotlin Gradle plugins.
    id("dev.flutter.flutter-gradle-plugin")
}

android {
    namespace = "com.hundlervpn.hundler"
    compileSdk = flutter.compileSdkVersion
    ndkVersion = flutter.ndkVersion

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
        // Без явного UTF-8 на русском Windows javac читает .java/.kt в CP1251,
        // и кириллица + non-ASCII символы в комментариях ломают парсер
        // (выдаёт ложные "Missing '}" / "Unclosed comment" ошибки).
        encoding = "UTF-8"
    }

    kotlinOptions {
        jvmTarget = JavaVersion.VERSION_17.toString()
        // Аналогично compileOptions.encoding, но для Kotlin compiler.
        freeCompilerArgs = freeCompilerArgs + listOf("-Xjvm-default=all")
    }

    defaultConfig {
        // Уникальный applicationId для Hundler VPN. Менять нельзя —
        // Google Play Console привязывает релиз к этому ID навсегда.
        applicationId = "com.hundlervpn.hundler"

        // minSdk = 24 (Android 7.0). Ниже — нет VPNService API
        // `addDisallowedApplication`, нужный для split-tunneling.
        minSdk = 24
        // targetSdk = 36 (Flutter 3.41 requires Android SDK 36).
        targetSdk = 36
        versionCode = flutter.versionCode
        versionName = flutter.versionName

        // ABI выбран в splits.abi ниже — Gradle не разрешает одновременно
        // abiFilters в defaultConfig.ndk И splits.abi.include (конфликт
        // "Conflicting configuration"). Оставляем только splits.
    }

    // ABI splits — главная причина почему наш APK раньше весил 161 МБ
    // (libgojni.so из sing-box ≈ 50 МБ × 3 архитектуры = 150 МБ в одном fat-APK).
    // Now: каждый ABI отдельным APK по ~55 МБ → паритет с Happ.
    // - isUniversalApk = false: НЕ собираем дополнительный fat-APK.
    // - Flutter сам выбирает нужный ABI при `adb install` (smart sideload),
    //   и Play Store / RuStore раздаёт пользователям только подходящий ABI.
    splits {
        abi {
            isEnable = true
            reset()
            include("arm64-v8a", "armeabi-v7a", "x86_64")
            isUniversalApk = false
        }
    }

    buildTypes {
        release {
            // TODO: Перед загрузкой в Play Store настроить upload-keystore
            // (см. ANDROID-AGENTS.md секция "Сборка и подписка").
            // Пока — debug-ключи, чтобы `flutter run --release` работал.
            signingConfig = signingConfigs.getByName("debug")
            isMinifyEnabled = true
            isShrinkResources = true
            // Strip native debug symbols + remove unused .so sections.
            // Дополнительно режет libgojni.so на ~5-10 МБ.
            ndk {
                debugSymbolLevel = "NONE"
            }
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
        }
    }
    packaging {
        resources {
            // Кикаем bookkeeping-файлы из META-INF (лицензии, маркеры Kotlin
            // компилятора, proto-описания, kotlin runtime metadata) — Flutter
            // их тянет через транзитивные .aar но в рантайме они не нужны.
            // -1..2 МБ к каждому APK.
            excludes += listOf(
                "META-INF/AL2.0",
                "META-INF/LGPL2.1",
                "META-INF/DEPENDENCIES",
                "META-INF/LICENSE*",
                "META-INF/NOTICE*",
                "META-INF/*.kotlin_module",
                "META-INF/proguard/**",
                "kotlin/**",
                "**/*.proto",
            )
        }
    }

    // Имя выходного APK / AAB — `hundler-{versionName}-{abi}.apk`.
    applicationVariants.all {
        outputs.all {
            val variant = this as com.android.build.gradle.internal.api.BaseVariantOutputImpl
            variant.outputFileName = "hundler-${defaultConfig.versionName}-${variant.name}.apk"
        }
    }
}

flutter {
    source = "../.."
}

dependencies {
    // sing-box VPN core, собранный из github.com/SagerNet/sing-box/experimental/libbox
    // через `gomobile bind`. Источник сборки: M:\GoBuild\build_libbox.bat.
    // Пакет — io.nekohasekai.libbox (см. CoreManager.kt).
    // Содержит jniLibs/{arm64-v8a,armeabi-v7a,x86_64}/libgojni.so,
    // должен совпадать с abiFilters выше.
    implementation(fileTree("libs") { include("*.aar") })
}
