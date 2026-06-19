package com.gameplan
import expo.modules.splashscreen.SplashScreenManager

import android.app.KeyguardManager
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.WindowManager

import com.facebook.react.ReactActivity
import com.facebook.react.ReactActivityDelegate
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.fabricEnabled
import com.facebook.react.defaults.DefaultReactActivityDelegate
import com.gameplan.daemon.JarvisAssistantLauncher

import expo.modules.ReactActivityDelegateWrapper

class MainActivity : ReactActivity() {
  private val assistantKeyguardVisibilityHandler = Handler(Looper.getMainLooper())
  private val clearAssistantKeyguardVisibilityWhenUnlocked = object : Runnable {
      override fun run() {
          clearAssistantKeyguardVisibilityIfUnlocked()
      }
  }
  private var assistantKeyguardVisibilityActive = false

  override fun onCreate(savedInstanceState: Bundle?) {
    // Set the theme to AppTheme BEFORE onCreate to support
    // coloring the background, status bar, and navigation bar.
    // This is required for expo-splash-screen.
    // setTheme(R.style.AppTheme);
    // @generated begin expo-splashscreen - expo prebuild (DO NOT MODIFY) sync-f3ff59a738c56c9a6119210cb55f0b613eb8b6af
    SplashScreenManager.registerOnActivity(this)
    // @generated end expo-splashscreen
    applyAssistantKeyguardVisibility(intent)
    super.onCreate(null)
  }

  override fun onNewIntent(intent: Intent) {
    super.onNewIntent(intent)
    setIntent(intent)
    applyAssistantKeyguardVisibility(intent)
  }

  override fun onResume() {
    super.onResume()
    clearAssistantKeyguardVisibilityIfUnlocked()
  }

  override fun onDestroy() {
    assistantKeyguardVisibilityHandler.removeCallbacks(clearAssistantKeyguardVisibilityWhenUnlocked)
    super.onDestroy()
  }

  /**
   * Returns the name of the main component registered from JavaScript. This is used to schedule
   * rendering of the component.
   */
  override fun getMainComponentName(): String = "main"

  /**
   * Returns the instance of the [ReactActivityDelegate]. We use [DefaultReactActivityDelegate]
   * which allows you to enable New Architecture with a single boolean flags [fabricEnabled]
   */
  override fun createReactActivityDelegate(): ReactActivityDelegate {
    return ReactActivityDelegateWrapper(
          this,
          BuildConfig.IS_NEW_ARCHITECTURE_ENABLED,
          object : DefaultReactActivityDelegate(
              this,
              mainComponentName,
              fabricEnabled
          ){})
  }

  /**
    * Align the back button behavior with Android S
    * where moving root activities to background instead of finishing activities.
    * @see <a href="https://developer.android.com/reference/android/app/Activity#onBackPressed()">onBackPressed</a>
    */
  override fun invokeDefaultOnBackPressed() {
      if (Build.VERSION.SDK_INT <= Build.VERSION_CODES.R) {
          if (!moveTaskToBack(false)) {
              // For non-root activities, use the default implementation to finish them.
              super.invokeDefaultOnBackPressed()
          }
          return
      }

      // Use the default back button implementation on Android S
      // because it's doing more than [Activity.moveTaskToBack] in fact.
      super.invokeDefaultOnBackPressed()
  }

  private fun applyAssistantKeyguardVisibility(intent: Intent?) {
      val showWhenLocked = JarvisAssistantLauncher.shouldShowWhenLocked(this, intent)
      setAssistantKeyguardVisibility(showWhenLocked)
      if (showWhenLocked) {
          scheduleKeyguardVisibilityClear()
      } else {
          assistantKeyguardVisibilityHandler.removeCallbacks(clearAssistantKeyguardVisibilityWhenUnlocked)
      }
  }

  private fun setAssistantKeyguardVisibility(showWhenLocked: Boolean) {
      assistantKeyguardVisibilityActive = showWhenLocked
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
          setShowWhenLocked(showWhenLocked)
          setTurnScreenOn(showWhenLocked)
      } else if (showWhenLocked) {
          window.addFlags(
              WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or
              WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON
          )
      } else {
          window.clearFlags(
              WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or
              WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON
          )
      }
  }

  private fun scheduleKeyguardVisibilityClear() {
      assistantKeyguardVisibilityHandler.removeCallbacks(clearAssistantKeyguardVisibilityWhenUnlocked)
      assistantKeyguardVisibilityHandler.postDelayed(clearAssistantKeyguardVisibilityWhenUnlocked, 1_000L)
  }

  private fun clearAssistantKeyguardVisibilityIfUnlocked() {
      if (!assistantKeyguardVisibilityActive) {
          return
      }
      if (isDeviceKeyguardLocked()) {
          scheduleKeyguardVisibilityClear()
          return
      }
      assistantKeyguardVisibilityHandler.removeCallbacks(clearAssistantKeyguardVisibilityWhenUnlocked)
      setAssistantKeyguardVisibility(false)
  }

  private fun isDeviceKeyguardLocked(): Boolean {
      val keyguardManager = getSystemService(Context.KEYGUARD_SERVICE) as? KeyguardManager
      return keyguardManager?.isKeyguardLocked == true
  }
}
