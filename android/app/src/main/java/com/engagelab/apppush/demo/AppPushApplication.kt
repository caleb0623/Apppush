package com.engagelab.apppush.demo

import android.app.Application
import com.engagelab.apppush.sdk.AppPush
import com.engagelab.apppush.sdk.AppPushConfig

class AppPushApplication : Application() {
    override fun onCreate() {
        super.onCreate()
        // What was entered on this phone wins over the defaults built into the app.
        val config = AppPush.savedConfig(this)
            ?: AppPushConfig(BuildConfig.DEFAULT_BACKEND_URL, BuildConfig.DEFAULT_APP_KEY)
        AppPush.init(this, config)
    }
}
