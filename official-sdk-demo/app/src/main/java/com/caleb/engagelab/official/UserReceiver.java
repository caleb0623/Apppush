package com.caleb.engagelab.official;

import android.content.Context;
import android.util.Log;

import com.engagelab.privates.common.component.MTCommonReceiver;
import com.engagelab.privates.core.api.MTCorePrivatesApi;
import com.engagelab.privates.push.api.NotificationMessage;

/** Receives the SDK's callbacks. The SDK shows notifications itself. */
public class UserReceiver extends MTCommonReceiver {
    private static final String TAG = "EngageLabDemo";

    @Override
    public void onConnectStatus(Context context, boolean enable) {
        Log.i(TAG, "connected: " + enable + ", registrationId: " + MTCorePrivatesApi.getRegistrationId(context));
        PushState.connected = enable;
        PushState.changed();
    }

    @Override
    public void onNotificationStatus(Context context, boolean enable) {
        Log.i(TAG, "notifications enabled: " + enable);
    }

    @Override
    public void onNotificationArrived(Context context, NotificationMessage message) {
        Log.i(TAG, "arrived: " + message.getMessageId());
        record(context.getString(R.string.event_arrived, message.getTitle(), message.getContent()));
    }

    @Override
    public void onNotificationClicked(Context context, NotificationMessage message) {
        Log.i(TAG, "clicked: " + message.getMessageId());
        record(context.getString(R.string.event_clicked, message.getTitle(), message.getContent()));
    }

    private void record(String event) {
        PushState.lastEvent = event;
        PushState.changed();
    }
}
