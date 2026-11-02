package com.caleb.engagelab.official;

import android.Manifest;
import android.app.Activity;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;
import android.text.TextUtils;
import android.widget.TextView;
import android.widget.Toast;

import com.engagelab.privates.core.api.MTCorePrivatesApi;

public class MainActivity extends Activity {
    private static final int REQUEST_NOTIFICATIONS = 1;

    private TextView connection;
    private TextView registrationId;
    private TextView lastEvent;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_main);
        connection = findViewById(R.id.connection);
        registrationId = findViewById(R.id.registration_id);
        lastEvent = findViewById(R.id.last_event);
        findViewById(R.id.copy).setOnClickListener(view -> copyRegistrationId());

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
                && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, REQUEST_NOTIFICATIONS);
        }
    }

    @Override
    protected void onStart() {
        super.onStart();
        PushState.listener = this::render;
        render();
    }

    @Override
    protected void onStop() {
        PushState.listener = null;
        super.onStop();
    }

    private String currentRegistrationId() {
        return MTCorePrivatesApi.getRegistrationId(this);
    }

    private void render() {
        connection.setText(PushState.connected ? R.string.connected : R.string.not_connected);
        String id = currentRegistrationId();
        registrationId.setText(TextUtils.isEmpty(id) ? getString(R.string.no_registration_id) : id);
        lastEvent.setText(PushState.lastEvent == null ? getString(R.string.no_event) : PushState.lastEvent);
    }

    private void copyRegistrationId() {
        String id = currentRegistrationId();
        if (TextUtils.isEmpty(id)) return;
        getSystemService(ClipboardManager.class).setPrimaryClip(ClipData.newPlainText("Registration ID", id));
        Toast.makeText(this, R.string.copied, Toast.LENGTH_SHORT).show();
    }
}
