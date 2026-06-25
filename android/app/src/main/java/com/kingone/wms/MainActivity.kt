package com.kingone.wms

import android.app.ActivityManager
import android.app.admin.DevicePolicyManager
import android.content.ComponentName
import android.content.Context
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.runtime.Composable
import androidx.navigation.NavHostController
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument
import com.kingone.wms.data.AppContainer
import com.kingone.wms.data.SessionManager
import com.kingone.wms.ui.screens.CountDetailScreen
import com.kingone.wms.ui.screens.CountListScreen
import com.kingone.wms.ui.screens.HomeScreen
import com.kingone.wms.ui.screens.IssueScreen
import com.kingone.wms.ui.screens.LoginScreen
import com.kingone.wms.ui.screens.LookupBinScreen
import com.kingone.wms.ui.screens.LookupItemScreen
import com.kingone.wms.ui.screens.PickListScreen
import com.kingone.wms.ui.screens.PutAwayScreen
import com.kingone.wms.ui.screens.ReceiveScreen
import com.kingone.wms.ui.screens.ReturnScreen
import com.kingone.wms.ui.screens.SettingsScreen
import com.kingone.wms.ui.screens.TransferScreen
import com.kingone.wms.ui.theme.WmsTheme

object Routes {
    const val SETTINGS = "settings"
    const val LOGIN = "login"
    const val HOME = "home"
    const val LOOKUP_ITEM = "lookupItem"
    const val LOOKUP_BIN = "lookupBin"
    const val RECEIVE = "receive"
    const val MOVE = "move"
    const val PUT_AWAY = "putAway"
    const val RETURN = "returnGoods"
    const val PICK = "pick"
    const val ISSUE = "issue"
    const val COUNTS = "counts"
    const val COUNT_DETAIL = "countDetail"
}

/** Kiosk controls exposed to the Settings screen. */
interface KioskController {
    fun enable()
    fun disable()
    fun isDeviceOwner(): Boolean
    fun isActive(): Boolean
}

/**
 * Drives Android Lock Task Mode. If the app is Device Owner, lock task is a true
 * kiosk (no user exit). Otherwise startLockTask() falls back to screen pinning.
 */
class KioskManager(private val activity: ComponentActivity, private val session: SessionManager) : KioskController {
    private val dpm get() = activity.getSystemService(Context.DEVICE_POLICY_SERVICE) as DevicePolicyManager
    private val am get() = activity.getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager
    private val admin get() = ComponentName(activity, KioskDeviceAdminReceiver::class.java)

    override fun isDeviceOwner(): Boolean = dpm.isDeviceOwnerApp(activity.packageName)

    override fun isActive(): Boolean = am.lockTaskModeState != ActivityManager.LOCK_TASK_MODE_NONE

    override fun enable() {
        session.kioskEnabled = true
        start()
    }

    override fun disable() {
        session.kioskEnabled = false
        if (isActive()) runCatching { activity.stopLockTask() }
    }

    /** Re-enter lock task on launch/resume if kiosk is switched on. */
    fun applyOnResume() {
        if (session.kioskEnabled) start()
    }

    private fun start() {
        if (isDeviceOwner()) {
            runCatching { dpm.setLockTaskPackages(admin, arrayOf(activity.packageName)) }
        }
        if (!isActive()) runCatching { activity.startLockTask() }
    }
}

class MainActivity : ComponentActivity() {
    private lateinit var kiosk: KioskManager

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val container = (application as WmsApp).container
        kiosk = KioskManager(this, container.session)
        setContent {
            WmsTheme { AppRoot(container, kiosk) }
        }
    }

    override fun onResume() {
        super.onResume()
        kiosk.applyOnResume()
    }
}

/** Navigate clearing the entire back stack (used after login/logout). */
fun NavHostController.navigateClearingStack(route: String) {
    navigate(route) {
        popUpTo(graph.id) { inclusive = true }
        launchSingleTop = true
    }
}

@Composable
fun AppRoot(container: AppContainer, kiosk: KioskController) {
    val nav = rememberNavController()
    val session = container.session
    val repo = container.repo

    val start = when {
        !session.isConfigured -> Routes.SETTINGS
        !session.isLoggedIn -> Routes.LOGIN
        else -> Routes.HOME
    }

    NavHost(navController = nav, startDestination = start) {
        composable(Routes.SETTINGS) { SettingsScreen(session, nav, kiosk) }
        composable(Routes.LOGIN) { LoginScreen(repo, session, nav) }
        composable(Routes.HOME) { HomeScreen(repo, session, nav) }
        composable(Routes.LOOKUP_ITEM) { LookupItemScreen(repo, nav) }
        composable(Routes.LOOKUP_BIN) { LookupBinScreen(repo, nav) }
        composable(Routes.RECEIVE) { ReceiveScreen(repo, nav) }
        composable(Routes.MOVE) { TransferScreen(repo, nav) }
        composable(Routes.PUT_AWAY) { PutAwayScreen(repo, nav) }
        composable(Routes.RETURN) { ReturnScreen(repo, nav) }
        composable(Routes.ISSUE) { IssueScreen(repo, nav) }
        composable(Routes.PICK) { PickListScreen(repo, nav) }
        composable(Routes.COUNTS) { CountListScreen(repo, nav) }
        composable(
            "${Routes.COUNT_DETAIL}/{id}",
            arguments = listOf(navArgument("id") { type = NavType.IntType }),
        ) { entry ->
            CountDetailScreen(repo, nav, entry.arguments?.getInt("id") ?: 0)
        }
    }
}
