package com.engagelab.apppush.demo

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.content.res.ColorStateList
import android.os.Build
import android.os.Bundle
import android.provider.Settings as AndroidSettings
import android.text.format.DateUtils
import android.view.View
import androidx.activity.result.contract.ActivityResultContracts
import androidx.annotation.ColorRes
import androidx.annotation.StringRes
import androidx.appcompat.app.AppCompatActivity
import androidx.appcompat.app.AppCompatDelegate
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import androidx.core.os.LocaleListCompat
import androidx.lifecycle.lifecycleScope
import com.engagelab.apppush.demo.databinding.ActivityMainBinding
import com.engagelab.apppush.demo.databinding.ItemMessageBinding
import com.engagelab.apppush.sdk.AppPush
import com.engagelab.apppush.sdk.AppPushConfig
import com.engagelab.apppush.sdk.AppPushListener
import com.engagelab.apppush.sdk.PushMessage
import com.google.android.material.snackbar.Snackbar
import kotlinx.coroutines.launch

class MainActivity : AppCompatActivity() {
    private lateinit var binding: ActivityMainBinding
    private var backendUnreachable = false

    /** Null until the user chooses, so the section can open by itself when something needs fixing. */
    private var connectionChoice: Boolean? = null

    private val requestPermission =
        registerForActivityResult(ActivityResultContracts.RequestPermission()) { render() }

    private val messageListener = AppPushListener { render() }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityMainBinding.inflate(layoutInflater)
        setContentView(binding.root)
        AppPush.updateNotificationChannels(this)

        val config = AppPush.config
        binding.languageToggle.setOnClickListener { toggleLanguage() }
        binding.backendUrl.setText(config.backendUrl)
        binding.appKey.setText(config.appKey)
        binding.saveAndRegister.setOnClickListener { saveAndRegister() }
        binding.testConnection.setOnClickListener { testConnection() }
        binding.enableNotifications.setOnClickListener { openNotificationControls() }
        binding.connectionHeader.setOnClickListener {
            connectionChoice = binding.connectionBody.visibility != View.VISIBLE
            render()
        }

        // Only a fresh launch: a rotated screen would otherwise report the same tap again.
        if (savedInstanceState == null) handleClick(intent)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU && !hasPermission()) {
            requestPermission.launch(Manifest.permission.POST_NOTIFICATIONS)
        }
        if (AppPush.isFirebaseReady && config.appKey.isNotBlank()) register()
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        handleClick(intent)
    }

    override fun onStart() {
        super.onStart()
        AppPush.addListener(messageListener)
        render()
    }

    override fun onStop() {
        AppPush.removeListener(messageListener)
        super.onStop()
    }

    private fun handleClick(intent: Intent?) {
        if (AppPush.handleIntent(intent)) {
            Snackbar.make(binding.root, R.string.click_reported, Snackbar.LENGTH_SHORT).show()
        }
    }

    /** AppCompat remembers the choice and recreates this screen in the new language. */
    private fun toggleLanguage() {
        val chinese = resources.configuration.locales[0].language == "zh"
        AppCompatDelegate.setApplicationLocales(LocaleListCompat.forLanguageTags(if (chinese) "en" else "zh-CN"))
    }

    private fun openNotificationControls() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            !hasPermission() &&
            shouldShowRequestPermissionRationale(Manifest.permission.POST_NOTIFICATIONS)
        ) {
            requestPermission.launch(Manifest.permission.POST_NOTIFICATIONS)
            return
        }
        // Android stops asking after a second refusal, so only its Settings page can help.
        startActivity(
            Intent(AndroidSettings.ACTION_APP_NOTIFICATION_SETTINGS)
                .putExtra(AndroidSettings.EXTRA_APP_PACKAGE, packageName),
        )
    }

    private fun hasPermission(): Boolean =
        ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) ==
            PackageManager.PERMISSION_GRANTED

    private fun applyConnectionFields() {
        AppPush.init(this, AppPushConfig(binding.backendUrl.text.toString(), binding.appKey.text.toString()))
    }

    private fun saveAndRegister() {
        applyConnectionFields()
        if (!AppPush.isFirebaseReady) {
            render()
            return
        }
        register()
    }

    private fun register() {
        binding.saveAndRegister.isEnabled = false
        binding.connectionResult.setText(R.string.registering)
        lifecycleScope.launch {
            try {
                AppPush.register()
                backendUnreachable = false
                binding.connectionResult.setText(R.string.registered)
            } catch (error: Exception) {
                backendUnreachable = true
                binding.connectionResult.text = getString(R.string.registration_failed, error.message)
            } finally {
                binding.saveAndRegister.isEnabled = true
                render()
            }
        }
    }

    private fun testConnection() {
        applyConnectionFields()
        binding.connectionResult.setText(R.string.connecting)
        lifecycleScope.launch {
            binding.connectionResult.text = try {
                val connection = AppPush.checkConnection()
                val fcm = if (connection.fcmConfigured) R.string.value_configured else R.string.value_not_configured
                listOf(
                    getString(R.string.connected_to, connection.application, connection.environment),
                    getString(R.string.backend_fcm, getString(fcm)),
                    getString(
                        R.string.this_device,
                        connection.tokenStatus?.let { getString(R.string.device_registered, it) }
                            ?: getString(R.string.value_not_registered),
                    ),
                ).joinToString("\n")
            } catch (error: Exception) {
                getString(R.string.connection_failed, error.message)
            }
        }
    }

    private fun render() {
        val notificationsOn = NotificationManagerCompat.from(this).areNotificationsEnabled()
        val firebaseReady = AppPush.isFirebaseReady

        val problem = when {
            !firebaseReady -> Problem(R.string.status_setup, R.color.status_bad, R.string.firebase_missing)
            AppPush.config.appKey.isBlank() -> Problem(R.string.status_setup, R.color.status_bad, R.string.app_key_missing)
            backendUnreachable -> Problem(R.string.status_no_backend, R.color.status_warn, R.string.backend_unreachable)
            !notificationsOn -> Problem(R.string.status_notifications_off, R.color.status_warn, R.string.permission_denied)
            !AppPush.isRegistered -> Problem(R.string.status_not_registered, R.color.status_warn, null)
            else -> null
        }

        binding.statusLabel.setText(problem?.label ?: R.string.status_ready)
        binding.statusDot.backgroundTintList = ColorStateList.valueOf(
            ContextCompat.getColor(this, problem?.color ?: R.color.status_good),
        )
        binding.notice.text = problem?.explanation?.let(::getString)
        binding.noticeCard.visibility = if (problem?.explanation == null) View.GONE else View.VISIBLE
        binding.enableNotifications.visibility = if (notificationsOn) View.GONE else View.VISIBLE

        val connectionOpen = connectionChoice ?: (problem != null)
        binding.connectionBody.visibility = if (connectionOpen) View.VISIBLE else View.GONE
        binding.connectionChevron.rotation = if (connectionOpen) 180f else 0f

        val firebase = if (firebaseReady) R.string.value_ready else R.string.value_not_configured
        val notifications = if (notificationsOn) R.string.value_allowed else R.string.value_not_allowed
        binding.status.text = listOf(
            getString(R.string.detail_firebase, getString(firebase)),
            getString(R.string.detail_notifications, getString(notifications)),
            getString(R.string.detail_token, AppPush.pushToken?.let { "…${it.takeLast(8)}" } ?: getString(R.string.value_none_yet)),
            getString(R.string.detail_registration, AppPush.registrationId ?: getString(R.string.value_not_registered)),
        ).joinToString("\n")

        renderMessages()
        // render() runs only while this screen is visible, so a waiting message has now been seen.
        AppPush.markInAppSeen()
    }

    private fun renderMessages() {
        val messages = AppPush.recentMessages
        binding.emptyMessages.visibility = if (messages.isEmpty()) View.VISIBLE else View.GONE
        binding.messageList.removeAllViews()
        for (message in messages) {
            val row = ItemMessageBinding.inflate(layoutInflater, binding.messageList, true)
            val kind = getString(
                when (message.type) {
                    PushMessage.TYPE_NOTIFICATION -> R.string.message_notification
                    PushMessage.TYPE_IN_APP -> R.string.message_in_app
                    else -> R.string.message_custom
                },
            )
            row.title.text = message.title ?: kind
            row.body.text = message.body
            row.body.visibility = if (message.body.isEmpty()) View.GONE else View.VISIBLE
            row.details.text = getString(R.string.message_details, kind, timeSince(message.receivedAt))
        }
    }

    private fun timeSince(moment: Long): CharSequence {
        val now = System.currentTimeMillis()
        if (now - moment < DateUtils.MINUTE_IN_MILLIS) return getString(R.string.just_now)
        return DateUtils.getRelativeTimeSpanString(moment, now, DateUtils.MINUTE_IN_MILLIS)
    }

    private data class Problem(
        @StringRes val label: Int,
        @ColorRes val color: Int,
        @StringRes val explanation: Int?,
    )
}
