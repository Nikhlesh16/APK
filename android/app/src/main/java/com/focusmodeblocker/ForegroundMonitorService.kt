package com.focusmodeblocker

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.AlarmManager
import android.app.PendingIntent
import android.app.Service
import android.app.usage.UsageEvents
import android.app.usage.UsageStatsManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.IntentFilter
import android.content.Intent
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import androidx.core.app.NotificationCompat

class ForegroundMonitorService : Service() {
  private val prefsName = "focus_mode_prefs"
  private val serviceRunningKey = "monitoring_service_running"
  private val handler = Handler(Looper.getMainLooper())
  private val monitorIntervalMs = 3000L
  private var lastBlockedPackage: String? = null
  private var lastBlockedAt: Long = 0
  private var lastUnlockPromptAt: Long = 0
  private var lastInactivityAlertAt: Long = 0
  private var lastObservedForeground: String? = null
  private var lastForegroundStartAt: Long = 0
  private var lastKnownForeground: String? = null
  private var lastFallbackLookupAt: Long = 0
  private val alarmAction = "com.focusmodeblocker.HEARTBEAT_WAKE"

  private val screenStateReceiver = object : BroadcastReceiver() {
    override fun onReceive(context: Context?, intent: Intent?) {
      when (intent?.action) {
        Intent.ACTION_USER_PRESENT -> {
          RuleEvaluator.onUserPresent(applicationContext)
          maybeLaunchUnlockChoicePrompt()
        }
        Intent.ACTION_SCREEN_OFF -> {
          lastKnownForeground = null
          RuleEvaluator.onScreenOff(applicationContext)
        }
      }
    }
  }

  private val monitorTask = object : Runnable {
    override fun run() {
      try {
        val now = System.currentTimeMillis()
        var packageName = getForegroundAppPackageName()
        var hasFreshForegroundSignal = !packageName.isNullOrBlank()

        if (packageName.isNullOrBlank()) {
          if (now - lastFallbackLookupAt >= 12_000L) {
            lastFallbackLookupAt = now
            packageName = getLikelyCurrentForegroundPackage()
            if (!packageName.isNullOrBlank()) {
              lastKnownForeground = packageName
              hasFreshForegroundSignal = true
            } else {
              // No recent foreground signal. Clear cached app to avoid stale activity heartbeats.
              lastKnownForeground = null
            }
          } else {
            packageName = lastKnownForeground
          }
        } else {
          lastKnownForeground = packageName
        }

        if (!packageName.isNullOrBlank() && packageName != applicationContext.packageName) {
          if (lastObservedForeground != packageName) {
            val changeTs = System.currentTimeMillis()
            val previous = lastObservedForeground
            if (!previous.isNullOrBlank() && lastForegroundStartAt > 0L) {
              AutomationDatabaseHelper
                .getInstance(applicationContext)
                .insertUsageEvent(previous, lastForegroundStartAt, changeTs)
            }

            RuleEvaluator.onForegroundPackageChanged(applicationContext, packageName)
            lastObservedForeground = packageName
            lastForegroundStartAt = changeTs
          }
          val decision = RuleEvaluator.evaluatePackage(applicationContext, packageName)
          if (decision.blocked) {
            launchBlockingScreen(packageName, decision)
          }
        }

        maybeTriggerInactivityAlert(System.currentTimeMillis())
      } catch (_: Exception) {
      } finally {
        handler.postDelayed(this, monitorIntervalMs)
      }
    }
  }

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    return START_STICKY
  }

  override fun onCreate() {
    super.onCreate()
    RuleEvaluator.recordActivityHeartbeat(applicationContext)
    getSharedPreferences(prefsName, Context.MODE_PRIVATE)
      .edit()
      .putBoolean(serviceRunningKey, true)
      .apply()

    createNotificationChannel()
    startForeground(1001, createNotification())
    scheduleHeartbeatAlarm()
    registerReceiver(
      screenStateReceiver,
      IntentFilter().apply {
        addAction(Intent.ACTION_USER_PRESENT)
        addAction(Intent.ACTION_SCREEN_OFF)
      },
    )
    handler.post(monitorTask)
  }

  override fun onDestroy() {
    handler.removeCallbacks(monitorTask)
    cancelHeartbeatAlarm()
    getSharedPreferences(prefsName, Context.MODE_PRIVATE)
      .edit()
      .putBoolean(serviceRunningKey, false)
      .apply()

    val packageName = lastObservedForeground
    if (!packageName.isNullOrBlank() && lastForegroundStartAt > 0L) {
      AutomationDatabaseHelper
        .getInstance(applicationContext)
        .insertUsageEvent(packageName, lastForegroundStartAt, System.currentTimeMillis())
    }
    try {
      unregisterReceiver(screenStateReceiver)
    } catch (_: Exception) {
    }
    super.onDestroy()
  }

  private fun createNotificationChannel() {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      val channel = NotificationChannel(
        "focus_mode_channel",
        "Focus Mode Monitor",
        NotificationManager.IMPORTANCE_LOW,
      )
      val alertsChannel = NotificationChannel(
        "focus_mode_alerts",
        "Focus Mode Alerts",
        NotificationManager.IMPORTANCE_DEFAULT,
      )
      val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
      manager.createNotificationChannel(channel)
      manager.createNotificationChannel(alertsChannel)
    }
  }

  private fun createNotification(): Notification {
    return NotificationCompat.Builder(this, "focus_mode_channel")
      .setContentTitle("Focus Mode Active")
      .setContentText("Monitoring foreground apps")
      .setSmallIcon(android.R.drawable.ic_lock_idle_alarm)
      .setOngoing(true)
      .build()
  }

  private fun getForegroundAppPackageName(): String? {
    val usageStatsManager = getSystemService(Context.USAGE_STATS_SERVICE) as UsageStatsManager
    val end = System.currentTimeMillis()
    val start = end - 15_000
    val events = usageStatsManager.queryEvents(start, end)

    val event = UsageEvents.Event()
    var currentPackage: String? = null

    while (events.hasNextEvent()) {
      events.getNextEvent(event)
      if (event.eventType == UsageEvents.Event.MOVE_TO_FOREGROUND) {
        currentPackage = event.packageName
      }
    }

    return currentPackage
  }

  private fun getLikelyCurrentForegroundPackage(): String? {
    val usageStatsManager = getSystemService(Context.USAGE_STATS_SERVICE) as UsageStatsManager
    val end = System.currentTimeMillis()
    val start = end - 60_000L
    val stats = usageStatsManager.queryUsageStats(UsageStatsManager.INTERVAL_DAILY, start, end)
      ?: return null

    return stats
      .asSequence()
      .filter { it.packageName != applicationContext.packageName }
      .filter { it.lastTimeUsed > end - 20_000L }
      .maxByOrNull { it.lastTimeUsed }
      ?.packageName
  }

  private fun launchBlockingScreen(packageName: String, decision: BlockDecision) {
    val now = System.currentTimeMillis()
    if (lastBlockedPackage == packageName && now - lastBlockedAt < 1500) {
      return
    }

    lastBlockedPackage = packageName
    lastBlockedAt = now

    val intent = Intent(this, BlockingActivity::class.java)
    intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    intent.addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP)
    intent.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP)
    intent.putExtra("blockedPackage", packageName)
    decision.reason?.let { intent.putExtra("blockedReason", it) }
    intent.putExtra("requiresPin", decision.requiresPin)
    intent.putExtra("requiresAppChoice", decision.requiresAppChoice)
    intent.putExtra("allowLiveFree", decision.allowLiveFree)
    startActivity(intent)
  }

  private fun maybeLaunchUnlockChoicePrompt() {
    if (!RuleEvaluator.isPhoneUnlockChoiceModeEnabled(applicationContext)) {
      return
    }

    val now = System.currentTimeMillis()
    if (now - lastUnlockPromptAt < 1200) {
      return
    }
    lastUnlockPromptAt = now

    val intent = Intent(this, BlockingActivity::class.java)
    intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    intent.addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP)
    intent.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP)
    intent.putExtra(
      "blockedReason",
      "Choose one app for this unlock session. Other apps stay blocked until screen off.",
    )
    intent.putExtra("requiresAppChoice", true)
    intent.putExtra(
      "allowLiveFree",
      RuleEvaluator.isLiveFreeAllowedForUnlockChoice(applicationContext),
    )
    startActivity(intent)
  }

  private fun maybeTriggerInactivityAlert(nowMs: Long) {
    val decision = RuleEvaluator.evaluateInactivityAlert(applicationContext, nowMs)
    if (!decision.shouldAlert) {
      return
    }

    if (nowMs - lastInactivityAlertAt < decision.intervalMs) {
      return
    }
    lastInactivityAlertAt = nowMs

    if (decision.action == "vibrate") {
      vibrateAlert()
    }

    val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    val notification = NotificationCompat.Builder(this, "focus_mode_alerts")
      .setContentTitle("Inactivity Alert")
      .setContentText(decision.message)
      .setSmallIcon(android.R.drawable.ic_dialog_alert)
      .setPriority(NotificationCompat.PRIORITY_HIGH)
      .setAutoCancel(true)
      .build()
    manager.notify(1999, notification)
  }

  private fun vibrateAlert() {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      val vm = getSystemService(Context.VIBRATOR_MANAGER_SERVICE) as VibratorManager
      vm.defaultVibrator.vibrate(
        VibrationEffect.createOneShot(700L, VibrationEffect.DEFAULT_AMPLITUDE),
      )
      return
    }

    @Suppress("DEPRECATION")
    val vibrator = getSystemService(Context.VIBRATOR_SERVICE) as Vibrator
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      vibrator.vibrate(VibrationEffect.createOneShot(700L, VibrationEffect.DEFAULT_AMPLITUDE))
    } else {
      @Suppress("DEPRECATION")
      vibrator.vibrate(700L)
    }
  }

  private fun scheduleHeartbeatAlarm() {
    val alarmManager = getSystemService(Context.ALARM_SERVICE) as AlarmManager
    val intent = Intent(this, ForegroundMonitorService::class.java).apply {
      action = alarmAction
    }
    val flags = PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    val pendingIntent = PendingIntent.getService(this, 9001, intent, flags)
    val intervalMs = 5 * 60 * 1000L
    alarmManager.setInexactRepeating(
      AlarmManager.RTC_WAKEUP,
      System.currentTimeMillis() + intervalMs,
      intervalMs,
      pendingIntent,
    )
  }

  private fun cancelHeartbeatAlarm() {
    val alarmManager = getSystemService(Context.ALARM_SERVICE) as AlarmManager
    val intent = Intent(this, ForegroundMonitorService::class.java).apply {
      action = alarmAction
    }
    val flags = PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    val pendingIntent = PendingIntent.getService(this, 9001, intent, flags)
    alarmManager.cancel(pendingIntent)
  }
}
