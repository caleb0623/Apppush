import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// Applied only when the file exists, so the app still builds before Firebase is set up.
// It then shows what is missing instead of crashing. See docs/firebase-setup.md.
val hasFirebaseConfig = file("google-services.json").exists()
if (hasFirebaseConfig) apply(plugin = "com.google.gms.google-services")

// Kept out of Git. Without this file the release build is unsigned, and a phone will refuse it.
val keystoreFile = rootProject.file("keystore.properties")
val keystore = Properties().apply { if (keystoreFile.exists()) keystoreFile.inputStream().use(::load) }

android {
    namespace = "com.engagelab.apppush.demo"
    compileSdk = 33
    buildToolsVersion = "33.0.0"

    defaultConfig {
        // Must equal the package registered in Firebase, or google-services.json is rejected.
        applicationId = "com.caleb.engagelab"
        minSdk = 24
        targetSdk = 33
        versionCode = 1
        versionName = "1.0.0"

        val backendUrl = providers.gradleProperty("apppush.backendUrl").get()
        val appKey = providers.gradleProperty("apppush.appKey").get()
        buildConfigField("String", "DEFAULT_BACKEND_URL", "\"$backendUrl\"")
        buildConfigField("String", "DEFAULT_APP_KEY", "\"$appKey\"")
    }

    signingConfigs {
        if (keystoreFile.exists()) {
            create("release") {
                storeFile = rootProject.file(keystore.getProperty("storeFile"))
                storePassword = keystore.getProperty("password")
                keyAlias = keystore.getProperty("keyAlias")
                keyPassword = keystore.getProperty("password")
            }
        }
    }

    buildTypes {
        release {
            signingConfig = signingConfigs.findByName("release")
        }
    }

    buildFeatures {
        buildConfig = true
        viewBinding = true
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }

    testOptions {
        unitTests.isReturnDefaultValues = true
    }
}

dependencies {
    implementation(project(":apppush-sdk"))
    implementation("androidx.core:core-ktx:1.10.1")
    implementation("androidx.appcompat:appcompat:1.6.1")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.6.1")
    implementation("com.google.android.material:material:1.9.0")

    testImplementation("junit:junit:4.13.2")
}
