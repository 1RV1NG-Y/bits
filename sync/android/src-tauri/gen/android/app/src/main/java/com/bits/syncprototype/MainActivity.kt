package com.bits.syncprototype

import android.content.Context
import android.graphics.Color
import android.net.wifi.WifiManager
import android.os.Bundle
import androidx.activity.enableEdgeToEdge
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat

class MainActivity : TauriActivity() {
  // Wi-Fi drivers drop multicast packets unless an app holds this lock; mDNS discovery
  // of paired devices depends on it.
  private var multicastLock: WifiManager.MulticastLock? = null

  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
    val wifi = applicationContext.getSystemService(Context.WIFI_SERVICE) as WifiManager
    multicastLock = wifi.createMulticastLock("bits-sync-mdns").apply {
      setReferenceCounted(false)
      acquire()
    }
    // Keep the web view clear of the status bar, navigation bar, and keyboard.
    val content = findViewById<android.view.View>(android.R.id.content)
    content.setBackgroundColor(Color.parseColor("#212423"))
    WindowCompat.getInsetsController(window, content).isAppearanceLightStatusBars = false
    ViewCompat.setOnApplyWindowInsetsListener(content) { view, insets ->
      val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.ime())
      view.setPadding(bars.left, bars.top, bars.right, bars.bottom)
      WindowInsetsCompat.CONSUMED
    }
  }

  override fun onDestroy() {
    multicastLock?.release()
    super.onDestroy()
  }
}
