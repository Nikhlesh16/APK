package com.focusmodeblocker

import android.content.ContentValues
import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper
import org.json.JSONArray

class AutomationDatabaseHelper private constructor(context: Context) :
  SQLiteOpenHelper(context, DB_NAME, null, DB_VERSION) {

  override fun onCreate(db: SQLiteDatabase) {
    db.execSQL(
      """
      CREATE TABLE IF NOT EXISTS Rules (
        id TEXT PRIMARY KEY NOT NULL,
        rule_type TEXT NOT NULL,
        target_app TEXT,
        trigger_app TEXT,
        threshold_minutes INTEGER DEFAULT 0,
        interval_minutes INTEGER DEFAULT 0,
        restricted_apps TEXT,
        action TEXT,
        enabled INTEGER NOT NULL DEFAULT 1,
        start_time TEXT DEFAULT '00:00',
        end_time TEXT DEFAULT '00:00',
        days_json TEXT,
        daily_limit_minutes INTEGER DEFAULT 0,
        alert_type TEXT DEFAULT 'notification'
      );
      """.trimIndent(),
    )

    db.execSQL(
      """
      CREATE TABLE IF NOT EXISTS UsageEvents (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        package_name TEXT NOT NULL,
        start_time INTEGER NOT NULL,
        end_time INTEGER NOT NULL,
        duration INTEGER NOT NULL
      );
      """.trimIndent(),
    )

    db.execSQL(
      """
      CREATE TABLE IF NOT EXISTS DeviceState (
        id INTEGER PRIMARY KEY CHECK(id = 1),
        last_unlock_time INTEGER DEFAULT 0,
        screen_state TEXT DEFAULT 'unknown'
      );
      """.trimIndent(),
    )

    db.execSQL("INSERT OR IGNORE INTO DeviceState (id, last_unlock_time, screen_state) VALUES (1, 0, 'unknown');")
  }

  override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) {
    if (oldVersion < 2) {
      db.execSQL("DROP TABLE IF EXISTS Rules")
      db.execSQL("DROP TABLE IF EXISTS UsageEvents")
      db.execSQL("DROP TABLE IF EXISTS DeviceState")
      onCreate(db)
    }
  }

  fun syncRulesFromJson(rulesJson: String) {
    val db = writableDatabase
    db.beginTransaction()
    try {
      db.delete("Rules", null, null)
      val rules = JSONArray(rulesJson)
      for (i in 0 until rules.length()) {
        val rule = rules.getJSONObject(i)
        val values = ContentValues().apply {
          put("id", rule.optString("id", ""))
          put("rule_type", rule.optString("ruleType", "continuous_usage_rule"))
          put("target_app", rule.optString("packageName", ""))
          put("trigger_app", rule.optString("triggerAppPackage", ""))
          put("threshold_minutes", rule.optInt("thresholdMinutes", 0))
          put("interval_minutes", rule.optInt("intervalMinutes", 0))
          put("restricted_apps", rule.optJSONArray("restrictedPackages")?.toString() ?: "[]")
          put("action", rule.optString("action", "block_app"))
          put("enabled", if (rule.optBoolean("enabled", true)) 1 else 0)
          put("start_time", rule.optString("startTime", "00:00"))
          put("end_time", rule.optString("endTime", "00:00"))
          put("days_json", rule.optJSONArray("days")?.toString() ?: "[0,1,2,3,4,5,6]")
          put("daily_limit_minutes", rule.optInt("dailyLimitMinutes", 0))
          put("alert_type", rule.optString("alertType", "notification"))
        }
        db.insert("Rules", null, values)
      }
      db.setTransactionSuccessful()
    } finally {
      db.endTransaction()
    }
  }

  fun insertUsageEvent(packageName: String, startTime: Long, endTime: Long) {
    if (endTime <= startTime) {
      return
    }

    val values = ContentValues().apply {
      put("package_name", packageName)
      put("start_time", startTime)
      put("end_time", endTime)
      put("duration", endTime - startTime)
    }
    writableDatabase.insert("UsageEvents", null, values)
  }

  fun updateDeviceState(lastUnlockTime: Long? = null, screenState: String? = null) {
    val values = ContentValues().apply {
      if (lastUnlockTime != null) {
        put("last_unlock_time", lastUnlockTime)
      }
      if (screenState != null) {
        put("screen_state", screenState)
      }
    }

    writableDatabase.update("DeviceState", values, "id = 1", null)
  }

  companion object {
    private const val DB_NAME = "automation_rules.db"
    private const val DB_VERSION = 2

    @Volatile
    private var instance: AutomationDatabaseHelper? = null

    fun getInstance(context: Context): AutomationDatabaseHelper {
      return instance ?: synchronized(this) {
        instance ?: AutomationDatabaseHelper(context.applicationContext).also { instance = it }
      }
    }
  }
}
