package com.focusmodeblocker

import android.app.usage.UsageEvents
import android.app.usage.UsageStatsManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import org.json.JSONArray
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Date
import java.util.Locale

data class BlockDecision(
  val blocked: Boolean,
  val reason: String? = null,
  val requiresPin: Boolean = false,
  val requiresAppChoice: Boolean = false,
  val allowLiveFree: Boolean = false,
)

data class InactivityAlertDecision(
  val shouldAlert: Boolean,
  val action: String = "show_notification",
  val intervalMs: Long = 5 * 60 * 1000L,
  val message: String = "Phone inactive for too long. Time to get moving.",
)

object RuleEvaluator {
  private const val PREFS_NAME = "focus_mode_prefs"
  private const val RULES_KEY = "rules_json"
  private const val PIN_KEY = "app_lock_pin"
  private const val LIMIT_LOCK_PREFIX = "limit_lock_until_"
  private const val LIMIT_TRIGGER_DAY_PREFIX = "limit_trigger_day_"
  private const val PIN_UNLOCK_PREFIX = "pin_unlock_until_"
  private const val LIMIT_LOCK_DURATION_MS = 45 * 60 * 1000L
  private const val PHONE_UNLOCK_RULE_PACKAGE = "__PHONE_UNLOCK_CHOICE_MODE__"
  private const val SESSION_PENDING_KEY = "unlock_session_pending"
  private const val SESSION_SELECTED_PACKAGE_KEY = "unlock_session_selected_package"
  private const val SESSION_LIVE_FREE_KEY = "unlock_session_live_free"
  private const val CURRENT_FOREGROUND_PACKAGE_KEY = "current_foreground_package"
  private const val PREVIOUS_FOREGROUND_PACKAGE_KEY = "previous_foreground_package"
  private const val CURRENT_FOREGROUND_START_TS_KEY = "current_foreground_start_ts"
  private const val LAST_UNLOCK_TIME_KEY = "last_unlock_time"
  private const val CONTINUOUS_LOCK_PREFIX = "continuous_lock_until_"

  fun onUserPresent(context: Context) {
    AutomationDatabaseHelper.getInstance(context).updateDeviceState(
      lastUnlockTime = System.currentTimeMillis(),
      screenState = "unlocked",
    )

    val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
    prefs.edit().putLong(LAST_UNLOCK_TIME_KEY, System.currentTimeMillis()).apply()

    if (!hasPhoneUnlockChoiceRuleEnabled(context)) {
      return
    }

    prefs.edit()
      .putBoolean(SESSION_PENDING_KEY, true)
      .remove(SESSION_SELECTED_PACKAGE_KEY)
      .putBoolean(SESSION_LIVE_FREE_KEY, false)
      .apply()
  }

  fun onForegroundPackageChanged(context: Context, packageName: String) {
    val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
    val current = prefs.getString(CURRENT_FOREGROUND_PACKAGE_KEY, null)
    if (current == packageName) {
      return
    }

    prefs.edit()
      .putString(PREVIOUS_FOREGROUND_PACKAGE_KEY, current)
      .putString(CURRENT_FOREGROUND_PACKAGE_KEY, packageName)
      .putLong(CURRENT_FOREGROUND_START_TS_KEY, System.currentTimeMillis())
      .apply()
  }

  fun evaluateInactivityAlert(context: Context, nowMs: Long): InactivityAlertDecision {
    val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
    val lastUnlock = prefs.getLong(LAST_UNLOCK_TIME_KEY, 0L)
    if (lastUnlock <= 0L) {
      return InactivityAlertDecision(shouldAlert = false)
    }

    val rulesRaw = prefs.getString(RULES_KEY, "[]") ?: "[]"
    val rules = JSONArray(rulesRaw)
    for (i in 0 until rules.length()) {
      val rule = rules.getJSONObject(i)
      val enabled = rule.optBoolean("enabled", false)
      val ruleType = rule.optString("ruleType", "continuous_usage_rule")
      if (!enabled || ruleType != "inactivity_rule") {
        continue
      }

      val thresholdMinutes = rule.optInt("thresholdMinutes", 0)
      if (thresholdMinutes <= 0) {
        continue
      }

      val elapsed = nowMs - lastUnlock
      if (elapsed < thresholdMinutes * 60_000L) {
        continue
      }

      val intervalMinutes = rule.optInt("intervalMinutes", 5)
      val action = rule.optString("action", "show_notification")
      val alertType = rule.optString("alertType", "notification")
      val effectiveAction = if (action == "vibrate") "vibrate" else if (alertType == "vibration") "vibrate" else "show_notification"

      return InactivityAlertDecision(
        shouldAlert = true,
        action = effectiveAction,
        intervalMs = intervalMinutes.coerceAtLeast(1) * 60_000L,
        message = "Device inactive for ${thresholdMinutes} minutes.",
      )
    }

    return InactivityAlertDecision(shouldAlert = false)
  }

  fun isPhoneUnlockChoiceModeEnabled(context: Context): Boolean {
    return hasPhoneUnlockChoiceRuleEnabled(context)
  }

  fun isLiveFreeAllowedForUnlockChoice(context: Context): Boolean {
    return isLiveFreeOptionAllowed(context)
  }

  fun onScreenOff(context: Context) {
    AutomationDatabaseHelper.getInstance(context).updateDeviceState(screenState = "screen_off")

    val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
    prefs.edit()
      .putBoolean(SESSION_PENDING_KEY, false)
      .remove(SESSION_SELECTED_PACKAGE_KEY)
      .putBoolean(SESSION_LIVE_FREE_KEY, false)
      .apply()
  }

  fun chooseSessionApp(context: Context, packageName: String) {
    val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
    prefs.edit()
      .putBoolean(SESSION_PENDING_KEY, true)
      .putString(SESSION_SELECTED_PACKAGE_KEY, packageName)
      .putBoolean(SESSION_LIVE_FREE_KEY, false)
      .apply()
  }

  fun chooseLiveFree(context: Context) {
    val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
    prefs.edit()
      .putBoolean(SESSION_PENDING_KEY, true)
      .remove(SESSION_SELECTED_PACKAGE_KEY)
      .putBoolean(SESSION_LIVE_FREE_KEY, true)
      .apply()
  }

  fun isPackageBlockedNow(context: Context, packageName: String): Boolean {
    return evaluatePackage(context, packageName).blocked
  }

  fun evaluatePackage(context: Context, packageName: String): BlockDecision {
    if (isProtectedPackage(context, packageName)) {
      return BlockDecision(blocked = false)
    }

    val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
    val rulesRaw = prefs.getString(RULES_KEY, "[]") ?: "[]"

    val now = Calendar.getInstance()
    val currentDay = convertToRuleDay(now.get(Calendar.DAY_OF_WEEK))
    val previousDay = (currentDay + 6) % 7
    val nowMinutes = now.get(Calendar.HOUR_OF_DAY) * 60 + now.get(Calendar.MINUTE)
    val nowMs = System.currentTimeMillis()
    val dayToken = SimpleDateFormat("yyyyMMdd", Locale.US).format(Date(nowMs))

    val sessionPending = prefs.getBoolean(SESSION_PENDING_KEY, false)
    if (sessionPending && hasPhoneUnlockChoiceRuleEnabled(context)) {
      val isLiveFree = prefs.getBoolean(SESSION_LIVE_FREE_KEY, false)
      if (!isLiveFree) {
        val selectedPackage = prefs.getString(SESSION_SELECTED_PACKAGE_KEY, null)
        if (selectedPackage.isNullOrBlank()) {
          return BlockDecision(
            blocked = true,
            reason = "Select one app for this unlock session. Other apps stay blocked until screen off.",
            requiresAppChoice = true,
            allowLiveFree = isLiveFreeOptionAllowed(context),
          )
        }

        if (packageName != selectedPackage && !isProtectedPackage(context, packageName)) {
          return BlockDecision(
            blocked = true,
            reason = "This unlock session only allows: $selectedPackage",
          )
        }
      }
    }

    val previousForeground = prefs.getString(PREVIOUS_FOREGROUND_PACKAGE_KEY, null)
    val currentForeground = prefs.getString(CURRENT_FOREGROUND_PACKAGE_KEY, null)
    val dependencyDecision = evaluateAppDependencyRules(
      rulesRaw = rulesRaw,
      packageName = packageName,
      previousForeground = previousForeground,
      currentForeground = currentForeground,
    )
    if (dependencyDecision.blocked) {
      return dependencyDecision
    }

    val rules = JSONArray(rulesRaw)
    var scheduleBlocked = false
    for (i in 0 until rules.length()) {
      val rule = rules.getJSONObject(i)
      val enabled = rule.optBoolean("enabled", false)
      val targetPackage = rule.optString("packageName", "")
      if (!enabled || targetPackage != packageName) {
        continue
      }

      val days = rule.optJSONArray("days") ?: JSONArray()
      val start = timeToMinutes(rule.optString("startTime", "00:00"))
      val end = timeToMinutes(rule.optString("endTime", "00:00"))
      val inConfiguredTimeWindow = isInRange(nowMinutes, start, end)

      if (!isRuleApplicableForDay(days, currentDay, previousDay, start, end, nowMinutes)) {
        continue
      }

      val requiresPinForRule = rule.optBoolean("requirePin", false)
      var pinUnlockedForRule = false
      if (requiresPinForRule && hasPinConfigured(context)) {
        val unlockUntil = prefs.getLong("$PIN_UNLOCK_PREFIX$packageName", 0L)
        if (nowMs > unlockUntil) {
          return BlockDecision(
            blocked = true,
            reason = "Enter your 4-digit PIN to open this app.",
            requiresPin = true,
          )
        }
        pinUnlockedForRule = true
      }

      val thresholdMinutes = rule.optInt("thresholdMinutes", 0)
      val continuousLockMinutes = rule.optInt("intervalMinutes", 30).coerceAtLeast(1)
      val lockUntilByContinuous = prefs.getLong("$CONTINUOUS_LOCK_PREFIX$packageName", 0L)

      if (lockUntilByContinuous > nowMs) {
        return BlockDecision(
          blocked = true,
          reason = "Continuous usage limit exceeded. App locked for $continuousLockMinutes minutes.",
        )
      }

      if (thresholdMinutes > 0) {
        val activeForeground = prefs.getString(CURRENT_FOREGROUND_PACKAGE_KEY, null)
        val activeForegroundStart = prefs.getLong(CURRENT_FOREGROUND_START_TS_KEY, 0L)
        if (activeForeground == packageName && activeForegroundStart > 0L && nowMs > activeForegroundStart) {
          val continuousElapsedMs = nowMs - activeForegroundStart
          val thresholdMs = thresholdMinutes * 60_000L
          if (continuousElapsedMs >= thresholdMs) {
            prefs.edit()
              .putLong(
                "$CONTINUOUS_LOCK_PREFIX$packageName",
                nowMs + continuousLockMinutes * 60_000L,
              )
              // Re-arm continuous tracking from now so the next lock requires a fresh continuous window.
              .putLong(CURRENT_FOREGROUND_START_TS_KEY, nowMs)
              .apply()

            return BlockDecision(
              blocked = true,
              reason = "Continuous usage threshold reached. App locked for $continuousLockMinutes minutes.",
            )
          }
        }
      }

      val dailyLimitMinutes = rule.optInt("dailyLimitMinutes", 0)
      // Keep legacy daily-limit behavior only for rules that are not configured
      // as threshold-based continuous usage rules.
      if (thresholdMinutes <= 0 && dailyLimitMinutes > 0) {
        val limitLockKey = "$LIMIT_LOCK_PREFIX$packageName"
        val limitDayKey = "$LIMIT_TRIGGER_DAY_PREFIX$packageName"
        val lockUntil = prefs.getLong(limitLockKey, 0L)
        if (nowMs < lockUntil) {
          return BlockDecision(
            blocked = true,
            reason = "Daily usage limit exceeded. App locked for 45 minutes.",
          )
        }

        val triggeredDay = prefs.getString(limitDayKey, null)
        if (triggeredDay != dayToken) {
          val usageTodayMs = getTodayUsageMillisForPackage(context, packageName, nowMs)
          val limitMs = dailyLimitMinutes * 60_000L
          if (usageTodayMs >= limitMs) {
            prefs.edit()
              .putLong(limitLockKey, nowMs + LIMIT_LOCK_DURATION_MS)
              .putString(limitDayKey, dayToken)
              .apply()

            return BlockDecision(
              blocked = true,
              reason = "Daily usage limit reached. App locked for 45 minutes.",
            )
          }
        }
      }

      // Only apply immediate schedule blocking for pure schedule rules.
      // Threshold/daily-limit rules should block based on those limits, not instantly.
      val shouldApplyScheduleBlock = thresholdMinutes <= 0 && dailyLimitMinutes <= 0
      if (shouldApplyScheduleBlock && inConfiguredTimeWindow) {
        if (requiresPinForRule && pinUnlockedForRule) {
          // The user has already unlocked this app with PIN for the grace window.
          continue
        }
        scheduleBlocked = true
      }
    }

    if (scheduleBlocked) {
      return BlockDecision(
        blocked = true,
        reason = "Focus Mode Active. This app is blocked until the allowed time.",
      )
    }

    return BlockDecision(blocked = false)
  }

  private fun evaluateAppDependencyRules(
    rulesRaw: String,
    packageName: String,
    previousForeground: String?,
    currentForeground: String?,
  ): BlockDecision {
    val rules = JSONArray(rulesRaw)
    for (i in 0 until rules.length()) {
      val rule = rules.getJSONObject(i)
      val enabled = rule.optBoolean("enabled", false)
      val ruleType = rule.optString("ruleType", "continuous_usage_rule")
      if (!enabled || ruleType != "app_dependency_rule") {
        continue
      }

      val triggerApp = rule.optString("triggerAppPackage", "")
      if (triggerApp.isBlank()) {
        continue
      }

      val restricted = rule.optJSONArray("restrictedPackages") ?: JSONArray()
      var isRestrictedTarget = false
      for (j in 0 until restricted.length()) {
        if (restricted.optString(j, "") == packageName) {
          isRestrictedTarget = true
          break
        }
      }
      if (!isRestrictedTarget) {
        continue
      }

      val switchedFromTrigger = previousForeground == triggerApp
      val stillOnTrigger = currentForeground == triggerApp
      if (switchedFromTrigger || stillOnTrigger) {
        return BlockDecision(
          blocked = true,
          reason = "Switching from $triggerApp to this app is restricted by your dependency rule.",
        )
      }
    }

    return BlockDecision(blocked = false)
  }

  fun hasAnyActiveRuleNow(context: Context): Boolean {
    val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
    val rulesRaw = prefs.getString(RULES_KEY, "[]") ?: "[]"

    val now = Calendar.getInstance()
    val currentDay = convertToRuleDay(now.get(Calendar.DAY_OF_WEEK))
    val previousDay = (currentDay + 6) % 7
    val nowMinutes = now.get(Calendar.HOUR_OF_DAY) * 60 + now.get(Calendar.MINUTE)

    val rules = JSONArray(rulesRaw)
    for (i in 0 until rules.length()) {
      val rule = rules.getJSONObject(i)
      val enabled = rule.optBoolean("enabled", false)
      if (!enabled) {
        continue
      }

      val days = rule.optJSONArray("days") ?: JSONArray()
      val start = timeToMinutes(rule.optString("startTime", "00:00"))
      val end = timeToMinutes(rule.optString("endTime", "00:00"))

      if (!isRuleApplicableForDay(days, currentDay, previousDay, start, end, nowMinutes)) {
        continue
      }

      if (isInRange(nowMinutes, start, end)) {
        return true
      }
    }

    return false
  }

  fun hasPinConfigured(context: Context): Boolean {
    val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
    val pin = prefs.getString(PIN_KEY, "") ?: ""
    return pin.length == 4 && pin.all { it.isDigit() }
  }

  fun setPin(context: Context, pin: String): Boolean {
    if (pin.length != 4 || !pin.all { it.isDigit() }) {
      return false
    }

    val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
    prefs.edit().putString(PIN_KEY, pin).apply()
    return true
  }

  fun verifyPinAndUnlockPackage(context: Context, packageName: String, pin: String): Boolean {
    val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
    val current = prefs.getString(PIN_KEY, "") ?: ""
    if (current != pin) {
      return false
    }

    prefs.edit()
      .putLong("$PIN_UNLOCK_PREFIX$packageName", System.currentTimeMillis() + 90_000L)
      .apply()
    return true
  }

  private fun getTodayUsageMillisForPackage(context: Context, packageName: String, nowMs: Long): Long {
    val usageStatsManager = context.getSystemService(Context.USAGE_STATS_SERVICE) as UsageStatsManager
    val cal = Calendar.getInstance().apply {
      timeInMillis = nowMs
      set(Calendar.HOUR_OF_DAY, 0)
      set(Calendar.MINUTE, 0)
      set(Calendar.SECOND, 0)
      set(Calendar.MILLISECOND, 0)
    }
    val dayStart = cal.timeInMillis

    val events = usageStatsManager.queryEvents(dayStart, nowMs)
    val event = UsageEvents.Event()

    var activeStart: Long? = null
    var total = 0L

    while (events.hasNextEvent()) {
      events.getNextEvent(event)
      if (event.packageName != packageName) {
        continue
      }

      when (event.eventType) {
        UsageEvents.Event.MOVE_TO_FOREGROUND -> activeStart = event.timeStamp
        UsageEvents.Event.MOVE_TO_BACKGROUND -> {
          val start = activeStart
          if (start != null && event.timeStamp > start) {
            total += event.timeStamp - start
          }
          activeStart = null
        }
      }
    }

    val start = activeStart
    if (start != null && nowMs > start) {
      total += nowMs - start
    }

    return total
  }

  private fun isProtectedPackage(context: Context, packageName: String): Boolean {
    if (packageName == context.packageName) {
      return true
    }

    val intent = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME)
    val launchers = context.packageManager.queryIntentActivities(
      intent,
      PackageManager.MATCH_DEFAULT_ONLY,
    )
    return launchers.any { it.activityInfo?.packageName == packageName }
  }

  private fun hasPhoneUnlockChoiceRuleEnabled(context: Context): Boolean {
    val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
    val rulesRaw = prefs.getString(RULES_KEY, "[]") ?: "[]"
    val rules = JSONArray(rulesRaw)
    for (i in 0 until rules.length()) {
      val rule = rules.getJSONObject(i)
      val enabled = rule.optBoolean("enabled", false)
      val phoneUnlockMode = rule.optBoolean("phoneUnlockChoiceMode", false)
      val packageName = rule.optString("packageName", "")
      if (enabled && (phoneUnlockMode || packageName == PHONE_UNLOCK_RULE_PACKAGE)) {
        return true
      }
    }
    return false
  }

  private fun isLiveFreeOptionAllowed(context: Context): Boolean {
    val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
    val rulesRaw = prefs.getString(RULES_KEY, "[]") ?: "[]"
    val rules = JSONArray(rulesRaw)
    for (i in 0 until rules.length()) {
      val rule = rules.getJSONObject(i)
      val enabled = rule.optBoolean("enabled", false)
      val phoneUnlockMode = rule.optBoolean("phoneUnlockChoiceMode", false)
      val packageName = rule.optString("packageName", "")
      if (enabled && (phoneUnlockMode || packageName == PHONE_UNLOCK_RULE_PACKAGE)) {
        return rule.optBoolean("liveFreeOption", true)
      }
    }
    return true
  }

  private fun isRuleApplicableForDay(
    days: JSONArray,
    currentDay: Int,
    previousDay: Int,
    start: Int,
    end: Int,
    nowMinutes: Int,
  ): Boolean {
    if (start < end || start == end) {
      return containsDay(days, currentDay)
    }

    if (nowMinutes >= start) {
      return containsDay(days, currentDay)
    }

    return containsDay(days, previousDay)
  }

  private fun containsDay(days: JSONArray, day: Int): Boolean {
    for (i in 0 until days.length()) {
      if (days.optInt(i, -1) == day) {
        return true
      }
    }
    return false
  }

  private fun convertToRuleDay(dayOfWeek: Int): Int {
    return when (dayOfWeek) {
      Calendar.SUNDAY -> 0
      Calendar.MONDAY -> 1
      Calendar.TUESDAY -> 2
      Calendar.WEDNESDAY -> 3
      Calendar.THURSDAY -> 4
      Calendar.FRIDAY -> 5
      Calendar.SATURDAY -> 6
      else -> 0
    }
  }

  private fun timeToMinutes(value: String): Int {
    val parts = value.split(":")
    if (parts.size != 2) {
      return 0
    }

    val hour = parts[0].toIntOrNull() ?: 0
    val minute = parts[1].toIntOrNull() ?: 0
    return hour * 60 + minute
  }

  private fun isInRange(now: Int, start: Int, end: Int): Boolean {
    if (start == end) {
      return true
    }

    if (start < end) {
      return now in start until end
    }

    return now >= start || now < end
  }
}