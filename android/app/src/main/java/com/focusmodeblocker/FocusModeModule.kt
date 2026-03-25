package com.focusmodeblocker

import android.app.AppOpsManager
import android.app.admin.DevicePolicyManager
import android.app.usage.UsageEvents
import android.app.usage.UsageStatsManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.Settings
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableArray

class FocusModeModule(private val context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
  private val prefsName = "focus_mode_prefs"
  private val uninstallGuardKey = "uninstall_guard_enabled"
  private val serviceRunningKey = "monitoring_service_running"

  override fun getName(): String = "FocusModeModule"

  @ReactMethod
  fun getInstalledApps(promise: Promise) {
    try {
      val packageManager = context.packageManager
      val packages = packageManager.getInstalledApplications(0)
      val protectedPackages = getProtectedPackages(packageManager)
      val result = Arguments.createArray()

      packages.forEach { appInfo ->
        if (
          packageManager.getLaunchIntentForPackage(appInfo.packageName) != null &&
          !protectedPackages.contains(appInfo.packageName)
        ) {
          val map = Arguments.createMap()
          map.putString("packageName", appInfo.packageName)
          map.putString("appName", packageManager.getApplicationLabel(appInfo).toString())
          result.pushMap(map)
        }
      }

      promise.resolve(result)
    } catch (e: Exception) {
      promise.reject("APPS_ERROR", e)
    }
  }

  private fun getProtectedPackages(packageManager: android.content.pm.PackageManager): Set<String> {
    val protected = mutableSetOf(context.packageName)
    val intent = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME)
    packageManager.queryIntentActivities(intent, PackageManager.MATCH_DEFAULT_ONLY).forEach {
      it.activityInfo?.packageName?.let { pkg -> protected.add(pkg) }
    }
    return protected
  }

  @ReactMethod
  fun startMonitoringService(promise: Promise) {
    try {
      val intent = Intent(context, ForegroundMonitorService::class.java)
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        context.startForegroundService(intent)
      } else {
        context.startService(intent)
      }
      promise.resolve(true)
    } catch (e: Exception) {
      promise.reject("START_SERVICE_ERROR", e)
    }
  }

  @ReactMethod
  fun stopMonitoringService(promise: Promise) {
    try {
      val intent = Intent(context, ForegroundMonitorService::class.java)
      context.stopService(intent)
      promise.resolve(true)
    } catch (e: Exception) {
      promise.reject("STOP_SERVICE_ERROR", e)
    }
  }

  @ReactMethod
  fun isMonitoringServiceRunning(promise: Promise) {
    try {
      val prefs = context.getSharedPreferences(prefsName, Context.MODE_PRIVATE)
      promise.resolve(prefs.getBoolean(serviceRunningKey, false))
    } catch (e: Exception) {
      promise.reject("SERVICE_STATUS_ERROR", e)
    }
  }

  @ReactMethod
  fun syncRulesToNative(rulesJson: String, promise: Promise) {
    try {
      val prefs = context.getSharedPreferences(prefsName, Context.MODE_PRIVATE)
      prefs.edit().putString("rules_json", rulesJson).apply()
      AutomationDatabaseHelper.getInstance(context).syncRulesFromJson(rulesJson)
      promise.resolve(true)
    } catch (e: Exception) {
      promise.reject("SYNC_ERROR", e)
    }
  }

  @ReactMethod
  fun setUninstallProtectionEnabled(enabled: Boolean, promise: Promise) {
    try {
      val prefs = context.getSharedPreferences(prefsName, Context.MODE_PRIVATE)
      prefs.edit().putBoolean(uninstallGuardKey, enabled).apply()
      promise.resolve(true)
    } catch (e: Exception) {
      promise.reject("UNINSTALL_GUARD_SET_ERROR", e)
    }
  }

  @ReactMethod
  fun getUninstallProtectionEnabled(promise: Promise) {
    try {
      val prefs = context.getSharedPreferences(prefsName, Context.MODE_PRIVATE)
      val enabled = prefs.getBoolean(uninstallGuardKey, true)
      promise.resolve(enabled)
    } catch (e: Exception) {
      promise.reject("UNINSTALL_GUARD_GET_ERROR", e)
    }
  }

  @ReactMethod
  fun isDeviceAdminEnabled(promise: Promise) {
    try {
      val dpm = context.getSystemService(Context.DEVICE_POLICY_SERVICE) as DevicePolicyManager
      val component = ComponentName(context, FocusDeviceAdminReceiver::class.java)
      promise.resolve(dpm.isAdminActive(component))
    } catch (e: Exception) {
      promise.reject("DEVICE_ADMIN_STATUS_ERROR", e)
    }
  }

  @ReactMethod
  fun requestDeviceAdminEnable(promise: Promise) {
    try {
      val component = ComponentName(context, FocusDeviceAdminReceiver::class.java)
      val intent = Intent(DevicePolicyManager.ACTION_ADD_DEVICE_ADMIN)
      intent.putExtra(DevicePolicyManager.EXTRA_DEVICE_ADMIN, component)
      intent.putExtra(
        DevicePolicyManager.EXTRA_ADD_EXPLANATION,
        "Enable this to make uninstall protection harder to bypass while rules are active.",
      )
      intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      context.startActivity(intent)
      promise.resolve(true)
    } catch (e: Exception) {
      promise.reject("DEVICE_ADMIN_ENABLE_ERROR", e)
    }
  }

  @ReactMethod
  fun hasAppLockPin(promise: Promise) {
    try {
      promise.resolve(RuleEvaluator.hasPinConfigured(context))
    } catch (e: Exception) {
      promise.reject("PIN_STATUS_ERROR", e)
    }
  }

  @ReactMethod
  fun setAppLockPin(pin: String, promise: Promise) {
    try {
      val ok = RuleEvaluator.setPin(context, pin)
      promise.resolve(ok)
    } catch (e: Exception) {
      promise.reject("PIN_SET_ERROR", e)
    }
  }

  @ReactMethod
  fun verifyAppLockPin(pin: String, promise: Promise) {
    try {
      promise.resolve(RuleEvaluator.verifyPin(context, pin))
    } catch (e: Exception) {
      promise.reject("PIN_VERIFY_ERROR", e)
    }
  }

  @ReactMethod
  fun hasUsageAccess(promise: Promise) {
    try {
      val appOps = context.getSystemService(Context.APP_OPS_SERVICE) as AppOpsManager
      val mode = appOps.checkOpNoThrow(
        "android:get_usage_stats",
        android.os.Process.myUid(),
        context.packageName,
      )
      promise.resolve(mode == AppOpsManager.MODE_ALLOWED)
    } catch (e: Exception) {
      promise.reject("USAGE_ACCESS_ERROR", e)
    }
  }

  @ReactMethod
  fun openUsageAccessSettings(promise: Promise) {
    try {
      val intent = Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS)
      intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      context.startActivity(intent)
      promise.resolve(null)
    } catch (e: Exception) {
      promise.reject("USAGE_SETTINGS_ERROR", e)
    }
  }

  @ReactMethod
  fun canDrawOverlays(promise: Promise) {
    try {
      promise.resolve(Settings.canDrawOverlays(context))
    } catch (e: Exception) {
      promise.reject("OVERLAY_ERROR", e)
    }
  }

  @ReactMethod
  fun openOverlaySettings(promise: Promise) {
    try {
      val intent = Intent(
        Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
        Uri.parse("package:${context.packageName}"),
      )
      intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      context.startActivity(intent)
      promise.resolve(null)
    } catch (e: Exception) {
      promise.reject("OVERLAY_SETTINGS_ERROR", e)
    }
  }

  @ReactMethod
  fun isAccessibilityEnabled(promise: Promise) {
    try {
      val expectedComponent = ComponentName(context, FocusAccessibilityService::class.java)
      val enabledServices = Settings.Secure.getString(
        context.contentResolver,
        Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES,
      )
      promise.resolve(enabledServices?.contains(expectedComponent.flattenToString()) == true)
    } catch (e: Exception) {
      promise.reject("ACCESSIBILITY_STATUS_ERROR", e)
    }
  }

  @ReactMethod
  fun openAccessibilitySettings(promise: Promise) {
    try {
      val intent = Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS)
      intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      context.startActivity(intent)
      promise.resolve(null)
    } catch (e: Exception) {
      promise.reject("ACCESSIBILITY_SETTINGS_ERROR", e)
    }
  }

  @ReactMethod
  fun getTodayUsageReport(promise: Promise) {
    try {
      val usageStatsManager =
        context.getSystemService(Context.USAGE_STATS_SERVICE) as UsageStatsManager
      val now = System.currentTimeMillis()
      val dayStart = now - (now % (24 * 60 * 60 * 1000))
      val events = usageStatsManager.queryEvents(dayStart, now)

      val packageManager = context.packageManager
      val timelineByPackage = mutableMapOf<String, MutableList<Triple<Long, Long, Long>>>()
      val appLabels = mutableMapOf<String, String>()
      val lastStart = mutableMapOf<String, Long>()

      val event = UsageEvents.Event()
      while (events.hasNextEvent()) {
        events.getNextEvent(event)

        if (event.eventType == UsageEvents.Event.MOVE_TO_FOREGROUND) {
          lastStart[event.packageName] = event.timeStamp
        }

        if (event.eventType == UsageEvents.Event.MOVE_TO_BACKGROUND) {
          val start = lastStart[event.packageName] ?: continue
          val end = event.timeStamp
          if (end > start) {
            val list = timelineByPackage.getOrPut(event.packageName) { mutableListOf() }
            list.add(Triple(start, end, end - start))
          }
        }
      }

      val result = Arguments.createArray()
      timelineByPackage.forEach { (packageName, entries) ->
        if (entries.isEmpty()) {
          return@forEach
        }

        val total = entries.sumOf { it.third }
        val appName = appLabels.getOrPut(packageName) {
          try {
            val info = packageManager.getApplicationInfo(packageName, 0)
            packageManager.getApplicationLabel(info).toString()
          } catch (_: Exception) {
            packageName
          }
        }

        val summary = Arguments.createMap()
        summary.putString("packageName", packageName)
        summary.putString("appName", appName)
        summary.putDouble("totalDuration", total.toDouble())

        val timeline = Arguments.createArray()
        entries.sortedBy { it.first }.forEach { item ->
          val eventMap = Arguments.createMap()
          eventMap.putString("packageName", packageName)
          eventMap.putString("appName", appName)
          eventMap.putDouble("startTimestamp", item.first.toDouble())
          eventMap.putDouble("endTimestamp", item.second.toDouble())
          eventMap.putDouble("duration", item.third.toDouble())
          timeline.pushMap(eventMap)
        }
        summary.putArray("timeline", timeline)
        result.pushMap(summary)
      }

      promise.resolve(result)
    } catch (e: Exception) {
      promise.reject("USAGE_REPORT_ERROR", e)
    }
  }
}
