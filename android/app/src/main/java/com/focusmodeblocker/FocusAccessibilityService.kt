package com.focusmodeblocker

import android.accessibilityservice.AccessibilityService
import android.app.admin.DevicePolicyManager
import android.content.Intent
import android.view.accessibility.AccessibilityNodeInfo
import android.view.accessibility.AccessibilityEvent

class FocusAccessibilityService : AccessibilityService() {
  private val prefsName = "focus_mode_prefs"
  private val uninstallGuardKey = "uninstall_guard_enabled"
  private val whatsappPackage = "com.whatsapp"
  private val redirectWindowMs = 15_000L
  private val uninstallFlowPackages = setOf(
    "com.google.android.packageinstaller",
    "com.android.packageinstaller",
    "com.samsung.android.packageinstaller",
    "com.android.settings",
  )
  private val blockedRedirectTargets = setOf(
    "com.google.android.youtube",
    "com.google.android.apps.youtube.music",
    "com.instagram.android",
    "com.instagram.lite",
    "com.facebook.katana",
    "com.facebook.lite",
  )
  private val reelTargetPackages = setOf(
    "com.google.android.youtube",
    "com.instagram.android",
    "com.instagram.lite",
    "com.facebook.katana",
    "com.facebook.lite",
    "com.zhiliaoapp.musically",
  )
  private val reelKeywords = listOf(
    "reel",
    "reels",
    "short",
    "shorts",
    "for you",
    "watch reel",
    "watch reels",
    "suggested reel",
  )
  private val videoClassHints = listOf(
    "videoview",
    "playerview",
    "textureview",
    "surfaceview",
    "exoplayer",
  )
  private val fastReelPackages = setOf(
    "com.google.android.youtube",
    "com.instagram.android",
    "com.instagram.lite",
    "com.zhiliaoapp.musically",
  )
  private val reelSignalDebounceMs = 1200L
  private val reelTriggerCooldownMs = 6_000L
  private val maxNodeScanCount = 220

  private var lastBlockedPackage: String? = null
  private var lastBlockedAt: Long = 0
  private var lastWhatsAppSeenAt: Long = 0
  private var lastForegroundPackage: String? = null
  private var reelSignalSinceByPackage = mutableMapOf<String, Long>()
  private var reelCooldownUntilByPackage = mutableMapOf<String, Long>()

  override fun onAccessibilityEvent(event: AccessibilityEvent?) {
    if (event == null) {
      return
    }

    val packageName = event.packageName?.toString() ?: return
    if (packageName == applicationContext.packageName) {
      return
    }

    val now = System.currentTimeMillis()
    if (
      (isUninstallAttemptForThisApp(event, packageName) ||
        isAdminDisableAttemptForThisApp(event, packageName)) &&
        shouldBlockUninstall()
    ) {
      if (lastBlockedPackage == "uninstall_guard" && now - lastBlockedAt < 1200) {
        return
      }

      lastBlockedPackage = "uninstall_guard"
      lastBlockedAt = now
      performGlobalAction(GLOBAL_ACTION_BACK)

      val intent = Intent(this, BlockingActivity::class.java)
      intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      intent.addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP)
      intent.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP)
      intent.putExtra(
        "blockedReason",
        "Uninstall is locked while any rule is active. Try again when no rules are active.",
      )
      startActivity(intent)
      return
    }

    if (packageName == whatsappPackage) {
      lastWhatsAppSeenAt = now
      lastForegroundPackage = packageName
      return
    }

    val blockDecision = RuleEvaluator.evaluatePackage(applicationContext, packageName)
    val blockedByScheduleRule = blockDecision.blocked
    val blockedByRedirectRule =
      blockedRedirectTargets.contains(packageName) && (
        lastForegroundPackage == whatsappPackage ||
        (now - lastWhatsAppSeenAt) <= redirectWindowMs
      )
    val blockedByReelDetection = isLikelyReelSession(packageName, event, now)

    if (!blockedByScheduleRule && !blockedByRedirectRule && !blockedByReelDetection) {
      lastForegroundPackage = packageName
      return
    }

    if (lastBlockedPackage == packageName && now - lastBlockedAt < 1200) {
      return
    }

    if (
      blockDecision.requiresAppChoice &&
      lastBlockedPackage == "unlock_choice" &&
      now - lastBlockedAt < 1200
    ) {
      return
    }

    lastBlockedPackage = packageName
    lastBlockedAt = now

    performGlobalAction(GLOBAL_ACTION_BACK)

    val intent = Intent(this, BlockingActivity::class.java)
    intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    intent.addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP)
    intent.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP)
    intent.putExtra("blockedPackage", packageName)
    blockDecision.reason?.let { intent.putExtra("blockedReason", it) }
    intent.putExtra("requiresPin", blockDecision.requiresPin)
    intent.putExtra("requiresAppChoice", blockDecision.requiresAppChoice)
    intent.putExtra("allowLiveFree", blockDecision.allowLiveFree)
    if (blockedByRedirectRule) {
      intent.putExtra(
        "blockedReason",
        "Redirect from WhatsApp to this app is blocked by your safety rule.",
      )
    } else if (blockedByReelDetection) {
      intent.putExtra(
        "blockedReason",
        "Reels/shorts session detected. This content type is currently restricted.",
      )
    }
    startActivity(intent)
    if (blockDecision.requiresAppChoice) {
      lastBlockedPackage = "unlock_choice"
    }
    lastForegroundPackage = packageName
  }

  override fun onInterrupt() {
  }

  private fun shouldBlockUninstall(): Boolean {
    val prefs = applicationContext.getSharedPreferences(prefsName, MODE_PRIVATE)
    val guardEnabled = prefs.getBoolean(uninstallGuardKey, true)
    return guardEnabled && RuleEvaluator.hasAnyActiveRuleNow(applicationContext)
  }

  private fun isAdminDisableAttemptForThisApp(event: AccessibilityEvent, packageName: String): Boolean {
    if (packageName != "com.android.settings") {
      return false
    }

    val dpm = applicationContext.getSystemService(DEVICE_POLICY_SERVICE) as DevicePolicyManager
    val component = android.content.ComponentName(applicationContext, FocusDeviceAdminReceiver::class.java)
    if (!dpm.isAdminActive(component)) {
      return false
    }

    val className = event.className?.toString()?.lowercase() ?: ""
    val eventText = event.text.joinToString(" ").lowercase()

    return className.contains("deviceadmin") ||
      eventText.contains("deactivate") ||
      eventText.contains("device admin") ||
      eventText.contains("focusmodeblocker") ||
      eventText.contains("focus mode app blocker")
  }

  private fun isUninstallAttemptForThisApp(event: AccessibilityEvent, packageName: String): Boolean {
    if (!uninstallFlowPackages.contains(packageName)) {
      return false
    }

    val className = event.className?.toString()?.lowercase() ?: ""
    if (
      className.contains("uninstall") ||
      className.contains("delete") ||
      className.contains("appinfodashboard")
    ) {
      return true
    }

    val eventText = event.text.joinToString(" ").lowercase()
    return eventText.contains("focusmodeblocker") ||
      eventText.contains("focus mode app blocker") ||
      eventText.contains("com.focusmodeblocker")
  }

  private fun isLikelyReelSession(
    packageName: String,
    event: AccessibilityEvent,
    now: Long,
  ): Boolean {
    if (!reelTargetPackages.contains(packageName)) {
      reelSignalSinceByPackage.remove(packageName)
      reelCooldownUntilByPackage.remove(packageName)
      return false
    }

    val cooldownUntil = reelCooldownUntilByPackage[packageName] ?: 0L
    if (now < cooldownUntil) {
      return false
    }

    val signal = computeReelSignal(event)
    if (signal.score <= 0) {
      reelSignalSinceByPackage.remove(packageName)
      return false
    }

    val startedAt = reelSignalSinceByPackage[packageName] ?: now.also {
      reelSignalSinceByPackage[packageName] = it
    }

    if (now - startedAt < reelSignalDebounceMs) {
      return false
    }

    val strongByScore = signal.score >= 2
    val fastPath = fastReelPackages.contains(packageName) &&
      signal.hasVideoClassHint &&
      signal.isScrollingSignal
    if (!strongByScore && !fastPath) {
      return false
    }

    reelSignalSinceByPackage.remove(packageName)
    reelCooldownUntilByPackage[packageName] = now + reelTriggerCooldownMs
    return true
  }

  private fun computeReelSignal(event: AccessibilityEvent): ReelSignal {
    var score = 0
    val isScrollingSignal = event.eventType == AccessibilityEvent.TYPE_VIEW_SCROLLED

    val eventBlob = buildString {
      append(event.className?.toString()?.lowercase().orEmpty())
      append(' ')
      append(event.contentDescription?.toString()?.lowercase().orEmpty())
      append(' ')
      append(event.text.joinToString(" ") { it?.toString().orEmpty().lowercase() })
    }

    val hasEventKeyword = reelKeywords.any { eventBlob.contains(it) }
    val hasEventVideoClass = videoClassHints.any { eventBlob.contains(it) }

    if (hasEventKeyword) {
      score += 2
    }
    if (hasEventVideoClass) {
      score += 1
    }

    val windowSignal = scanRootWindowSignals(rootInActiveWindow)
    if (windowSignal.hasReelKeyword) {
      score += 1
    }
    if (windowSignal.hasVideoClassHint) {
      score += 1
    }

    return ReelSignal(
      score = score,
      hasReelKeyword = hasEventKeyword || windowSignal.hasReelKeyword,
      hasVideoClassHint = hasEventVideoClass || windowSignal.hasVideoClassHint,
      isScrollingSignal = isScrollingSignal,
    )
  }

  private data class ReelSignal(
    val score: Int,
    val hasReelKeyword: Boolean,
    val hasVideoClassHint: Boolean,
    val isScrollingSignal: Boolean,
  )

  private data class WindowSignal(
    val hasReelKeyword: Boolean,
    val hasVideoClassHint: Boolean,
  )

  private fun scanRootWindowSignals(root: AccessibilityNodeInfo?): WindowSignal {
    if (root == null) {
      return WindowSignal(hasReelKeyword = false, hasVideoClassHint = false)
    }

    val queue = ArrayDeque<AccessibilityNodeInfo>()
    queue.add(root)
    var scanned = 0
    var hasReelKeyword = false
    var hasVideoClassHint = false

    while (queue.isNotEmpty() && scanned < maxNodeScanCount) {
      val node = queue.removeFirst()
      scanned += 1

      val nodeBlob = buildString {
        append(node.className?.toString()?.lowercase().orEmpty())
        append(' ')
        append(node.contentDescription?.toString()?.lowercase().orEmpty())
        append(' ')
        append(node.text?.toString()?.lowercase().orEmpty())
      }

      if (!hasReelKeyword && reelKeywords.any { nodeBlob.contains(it) }) {
        hasReelKeyword = true
      }
      if (!hasVideoClassHint && videoClassHints.any { nodeBlob.contains(it) }) {
        hasVideoClassHint = true
      }

      if (hasReelKeyword && hasVideoClassHint) {
        return WindowSignal(hasReelKeyword = true, hasVideoClassHint = true)
      }

      for (i in 0 until node.childCount) {
        val child = node.getChild(i)
        if (child != null) {
          queue.addLast(child)
        }
      }

    }

    return WindowSignal(
      hasReelKeyword = hasReelKeyword,
      hasVideoClassHint = hasVideoClassHint,
    )
  }
}
