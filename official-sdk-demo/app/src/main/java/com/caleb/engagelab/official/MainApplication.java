package com.caleb.engagelab.official;

import android.app.Application;

import com.engagelab.privates.core.api.MTCorePrivatesApi;
import com.engagelab.privates.push.api.MTPushPrivatesApi;

public class MainApplication extends Application {
    @Override
    public void onCreate() {
        super.onCreate();
        MTCorePrivatesApi.configDebugMode(this, true);
        MTPushPrivatesApi.init(this);
    }
}
