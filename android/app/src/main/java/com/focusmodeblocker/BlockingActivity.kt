package com.focusmodeblocker

import android.os.Bundle
import android.view.View
import android.app.AlertDialog
import android.content.Intent
import android.widget.Button
import android.widget.EditText
import android.widget.TextView
import androidx.activity.OnBackPressedCallback
import androidx.appcompat.app.AppCompatActivity

class BlockingActivity : AppCompatActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    setContentView(R.layout.activity_blocking)

    val textView = findViewById<TextView>(R.id.blocking_message)
    val blockedReason = intent.getStringExtra("blockedReason")
    textView.text = blockedReason ?: "Focus Mode Active. This app is blocked until the allowed time."

    val requiresPin = intent.getBooleanExtra("requiresPin", false)
    val requiresAppChoice = intent.getBooleanExtra("requiresAppChoice", false)
    val allowLiveFree = intent.getBooleanExtra("allowLiveFree", false)
    val blockedPackage = intent.getStringExtra("blockedPackage")
    val pinInput = findViewById<EditText>(R.id.pin_input)
    val unlockButton = findViewById<Button>(R.id.pin_unlock_button)
    val chooseAppButton = findViewById<Button>(R.id.choose_app_button)
    val liveFreeButton = findViewById<Button>(R.id.live_free_button)

    if (requiresAppChoice) {
      chooseAppButton.visibility = View.VISIBLE
      chooseAppButton.setOnClickListener { showAppChooser() }

      if (allowLiveFree) {
        liveFreeButton.visibility = View.VISIBLE
        liveFreeButton.setOnClickListener {
          RuleEvaluator.chooseLiveFree(applicationContext)
          finish()
        }
      }
    }

    if (requiresPin) {
      pinInput.visibility = View.VISIBLE
      unlockButton.visibility = View.VISIBLE
      unlockButton.setOnClickListener {
        val pin = pinInput.text?.toString()?.trim() ?: ""
        if (pin.length != 4) {
          textView.text = "Enter a valid 4-digit PIN."
          return@setOnClickListener
        }

        if (blockedPackage.isNullOrBlank()) {
          textView.text = "Unable to unlock app right now."
          return@setOnClickListener
        }

        val ok = RuleEvaluator.verifyPinAndUnlockPackage(applicationContext, blockedPackage, pin)
        if (!ok) {
          textView.text = "Incorrect PIN. Try again."
          return@setOnClickListener
        }

        val launchIntent = packageManager.getLaunchIntentForPackage(blockedPackage)
        if (launchIntent != null) {
          launchIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
          startActivity(launchIntent)
        }
        finish()
      }
    }

    onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
      override fun handleOnBackPressed() {
      }
    })
  }

  private fun showAppChooser() {
    val packageManager = packageManager
    val launchIntent = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER)
    val apps = packageManager.queryIntentActivities(launchIntent, 0)
      .mapNotNull { info ->
        val pkg = info.activityInfo?.packageName ?: return@mapNotNull null
        if (pkg == applicationContext.packageName) {
          return@mapNotNull null
        }
        val label = info.loadLabel(packageManager)?.toString() ?: pkg
        Pair(label, pkg)
      }
      .distinctBy { it.second }
      .sortedBy { it.first.lowercase() }

    if (apps.isEmpty()) {
      return
    }

    val labels = apps.map { "${it.first} (${it.second})" }.toTypedArray()
    AlertDialog.Builder(this)
      .setTitle("Choose only one app")
      .setItems(labels) { _, which ->
        val selectedPackage = apps[which].second
        RuleEvaluator.chooseSessionApp(applicationContext, selectedPackage)
        val appIntent = packageManager.getLaunchIntentForPackage(selectedPackage)
        if (appIntent != null) {
          appIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
          startActivity(appIntent)
        }
        finish()
      }
      .setNegativeButton("Cancel", null)
      .show()
  }
}
