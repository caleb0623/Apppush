plugins {
    id("com.android.library")
    id("org.jetbrains.kotlin.android")
    id("maven-publish")
}

group = "com.engagelab"
version = "1.0.0"

android {
    namespace = "com.engagelab.apppush.sdk"
    compileSdk = 33
    buildToolsVersion = "33.0.0"

    // Keeps the SDK's resources from colliding with the host app's.
    resourcePrefix = "apppush_"

    defaultConfig {
        minSdk = 24
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

    publishing {
        singleVariant("release") {
            withSourcesJar()
        }
    }
}

dependencies {
    // Public, because AppPush.register is a suspend function.
    api("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.7.3")

    // A plain version, not the Firebase BOM, so it resolves for any app using this SDK.
    implementation("com.google.firebase:firebase-messaging-ktx:23.2.1")
    implementation("androidx.core:core-ktx:1.10.1")
    implementation("androidx.work:work-runtime-ktx:2.8.1")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-play-services:1.7.3")

    testImplementation("junit:junit:4.13.2")
    testImplementation("org.json:json:20230618")
}

// `gradlew :apppush-sdk:publishReleasePublicationToLocalRepository` writes a Maven repository to
// build/repo. A plain .aar would leave out the dependencies above, which a repository lists.
publishing {
    publications {
        register<MavenPublication>("release") {
            artifactId = "apppush-sdk"
            afterEvaluate { from(components["release"]) }
        }
    }
    repositories {
        maven {
            name = "local"
            url = uri(layout.buildDirectory.dir("repo"))
        }
    }
}
