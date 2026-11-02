// Versions are chosen to open in Android Studio Flamingo (2022.2) with SDK 33.
// AGP 8.0 is the newest that IDE supports; see README.md before raising them.
plugins {
    id("com.android.application") version "8.0.2" apply false
    id("com.android.library") version "8.0.2" apply false
    id("org.jetbrains.kotlin.android") version "1.8.22" apply false
    id("com.google.gms.google-services") version "4.3.15" apply false
}
