package com.kingone.wms.ui.screens

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ListAlt
import androidx.compose.material.icons.automirrored.filled.Logout
import androidx.compose.material.icons.filled.AssignmentReturn
import androidx.compose.material.icons.filled.CallMade
import androidx.compose.material.icons.filled.CallReceived
import androidx.compose.material.icons.filled.Inventory2
import androidx.compose.material.icons.filled.MoveToInbox
import androidx.compose.material.icons.filled.QrCode2
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.SwapHoriz
import androidx.compose.material.icons.filled.Warehouse
import androidx.compose.material3.Card
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.navigation.NavHostController
import com.kingone.wms.KioskController
import com.kingone.wms.Routes
import com.kingone.wms.data.SessionManager
import com.kingone.wms.data.WmsRepository
import com.kingone.wms.navigateClearingStack
import com.kingone.wms.ui.FormColumn
import com.kingone.wms.ui.InfoCard
import com.kingone.wms.ui.PrimaryButton
import com.kingone.wms.ui.WmsScaffold
import com.kingone.wms.ui.toast
import kotlinx.coroutines.launch

@Composable
fun SettingsScreen(session: SessionManager, nav: NavHostController, kiosk: KioskController) {
    val context = LocalContext.current
    // If no supervisor password is set yet, the screen is open so one can be created.
    var unlocked by remember { mutableStateOf(!session.hasSupervisorPassword()) }
    var pin by remember { mutableStateOf("") }

    WmsScaffold(
        title = "Supervisor settings",
        onBack = if (nav.previousBackStackEntry != null) ({ nav.popBackStack() }) else null,
    ) { padding ->
        FormColumn(padding) {
            if (!unlocked) {
                Text("Enter the supervisor password to continue.", style = MaterialTheme.typography.bodyMedium)
                OutlinedTextField(
                    value = pin,
                    onValueChange = { pin = it },
                    label = { Text("Supervisor password") },
                    singleLine = true,
                    visualTransformation = PasswordVisualTransformation(),
                    modifier = Modifier.fillMaxWidth(),
                )
                PrimaryButton("Unlock") {
                    if (session.verifySupervisor(pin)) { unlocked = true; pin = "" }
                    else toast(context, "Incorrect password.")
                }
            } else {
                SupervisorSettings(session, nav, kiosk, context)
            }
        }
    }
}

@Composable
private fun SupervisorSettings(
    session: SessionManager,
    nav: NavHostController,
    kiosk: KioskController,
    context: android.content.Context,
) {
    var url by remember { mutableStateOf(session.baseUrl) }
    var kioskOn by remember { mutableStateOf(session.kioskEnabled) }
    var hasPw by remember { mutableStateOf(session.hasSupervisorPassword()) }
    var newPw by remember { mutableStateOf("") }
    var confirmPw by remember { mutableStateOf("") }

    InfoCard("Server") {
        OutlinedTextField(
            value = url,
            onValueChange = { url = it },
            label = { Text("Server address") },
            placeholder = { Text("10.66.20.34:4100") },
            singleLine = true,
            modifier = Modifier.fillMaxWidth(),
        )
        PrimaryButton("Save server address") {
            val n = SessionManager.normalizeBase(url)
            if (n.isBlank()) { toast(context, "Please enter the server address."); return@PrimaryButton }
            session.baseUrl = n; url = session.baseUrl; toast(context, "Saved.")
        }
    }

    InfoCard(if (hasPw) "Change supervisor password" else "Create supervisor password") {
        if (!hasPw) {
            Text("Set a supervisor password to protect kiosk controls.", style = MaterialTheme.typography.bodySmall)
        }
        OutlinedTextField(
            value = newPw,
            onValueChange = { newPw = it },
            label = { Text("New password") },
            singleLine = true,
            visualTransformation = PasswordVisualTransformation(),
            modifier = Modifier.fillMaxWidth(),
        )
        OutlinedTextField(
            value = confirmPw,
            onValueChange = { confirmPw = it },
            label = { Text("Confirm password") },
            singleLine = true,
            visualTransformation = PasswordVisualTransformation(),
            modifier = Modifier.fillMaxWidth(),
        )
        PrimaryButton(if (hasPw) "Update password" else "Set password") {
            if (newPw.length < 4) { toast(context, "Use at least 4 characters."); return@PrimaryButton }
            if (newPw != confirmPw) { toast(context, "Passwords do not match."); return@PrimaryButton }
            session.setSupervisorPassword(newPw); hasPw = true; newPw = ""; confirmPw = ""
            toast(context, "Supervisor password saved.")
        }
    }

    InfoCard("Kiosk mode") {
        Text(
            "Status: " + if (kioskOn) "ON" else "OFF",
            fontWeight = FontWeight.Bold,
            color = if (kioskOn) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurface,
        )
        Text(
            if (kiosk.isDeviceOwner()) "Full lockdown (device owner)."
            else "Screen-pinning mode. For full lockdown, make the app device owner via ADB (see README).",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        if (!kioskOn) {
            PrimaryButton("Enable kiosk", enabled = hasPw) {
                kiosk.enable(); kioskOn = true
                toast(context, "Kiosk mode enabled.")
                if (session.isLoggedIn) nav.navigateClearingStack(Routes.HOME)
                else nav.navigateClearingStack(Routes.LOGIN)
            }
            if (!hasPw) {
                Text("Set a supervisor password first.", color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
            }
        } else {
            PrimaryButton("Disable kiosk") {
                kiosk.disable(); kioskOn = false
                toast(context, "Kiosk mode disabled.")
            }
        }
    }
}

@Composable
fun LoginScreen(repo: WmsRepository, session: SessionManager, nav: NavHostController) {
    var username by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var loading by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()
    val context = LocalContext.current

    WmsScaffold(
        title = "KING WMS",
        actions = {
            IconButton(onClick = { nav.navigate(Routes.SETTINGS) }) {
                Icon(Icons.Filled.Settings, contentDescription = "Settings")
            }
        },
    ) { padding ->
        FormColumn(padding) {
            Text("Sign in", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
            Text(
                session.baseUrl.ifBlank { "No server set" },
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            OutlinedTextField(
                value = username,
                onValueChange = { username = it },
                label = { Text("Username") },
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
            )
            OutlinedTextField(
                value = password,
                onValueChange = { password = it },
                label = { Text("Password") },
                singleLine = true,
                visualTransformation = PasswordVisualTransformation(),
                keyboardOptions = KeyboardOptions.Default,
                modifier = Modifier.fillMaxWidth(),
            )
            if (error != null) {
                Text(error!!, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodyMedium)
            }
            PrimaryButton("Sign in", loading = loading, enabled = username.isNotBlank() && password.isNotBlank()) {
                error = null
                loading = true
                scope.launch {
                    try {
                        repo.login(username, password)
                        nav.navigateClearingStack(Routes.HOME)
                    } catch (e: Exception) {
                        error = e.message ?: "Sign in failed"
                    } finally {
                        loading = false
                    }
                }
            }
        }
    }
}

private data class HomeTile(val label: String, val icon: ImageVector, val route: String)

@Composable
fun HomeScreen(repo: WmsRepository, session: SessionManager, nav: NavHostController) {
    val scope = rememberCoroutineScope()
    val tiles = listOf(
        HomeTile("Scan item", Icons.Filled.QrCode2, Routes.LOOKUP_ITEM),
        HomeTile("Scan bin", Icons.Filled.Warehouse, Routes.LOOKUP_BIN),
        HomeTile("Receive", Icons.Filled.CallReceived, Routes.RECEIVE),
        HomeTile("Put away", Icons.Filled.MoveToInbox, Routes.PUT_AWAY),
        HomeTile("Return", Icons.Filled.AssignmentReturn, Routes.RETURN),
        HomeTile("Pick List", Icons.AutoMirrored.Filled.ListAlt, Routes.PICK),
        HomeTile("Goods Issue", Icons.Filled.CallMade, Routes.ISSUE),
    )

    WmsScaffold(
        title = "KING WMS",
        actions = {
            IconButton(onClick = { nav.navigate(Routes.SETTINGS) }) {
                Icon(Icons.Filled.Settings, contentDescription = "Settings")
            }
            IconButton(onClick = {
                scope.launch {
                    repo.logout()
                    nav.navigateClearingStack(Routes.LOGIN)
                }
            }) {
                Icon(Icons.AutoMirrored.Filled.Logout, contentDescription = "Sign out")
            }
        },
    ) { padding ->
        Column(Modifier.fillMaxSize().padding(padding)) {
            InfoCardHeader(name = session.fullName ?: session.userName ?: "", role = session.role ?: "")
            LazyVerticalGrid(
                columns = GridCells.Fixed(2),
                contentPadding = PaddingValues(16.dp),
                horizontalArrangement = Arrangement.spacedBy(12.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                items(tiles) { tile ->
                    Card(
                        modifier = Modifier
                            .fillMaxWidth()
                            .aspectRatio(1.1f)
                            .clickable { nav.navigate(tile.route) },
                    ) {
                        Column(
                            Modifier.fillMaxSize().padding(16.dp),
                            verticalArrangement = Arrangement.Center,
                            horizontalAlignment = Alignment.CenterHorizontally,
                        ) {
                            Icon(
                                tile.icon,
                                contentDescription = null,
                                tint = MaterialTheme.colorScheme.primary,
                                modifier = Modifier.size(40.dp),
                            )
                            Box(Modifier.size(12.dp))
                            Text(tile.label, fontWeight = FontWeight.SemiBold)
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun InfoCardHeader(name: String, role: String) {
    Column(Modifier.fillMaxWidth().padding(start = 16.dp, end = 16.dp, top = 16.dp)) {
        InfoCard {
            Text("Signed in as", color = MaterialTheme.colorScheme.onSurfaceVariant)
            Text(name, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
            if (role.isNotBlank()) {
                Text(role, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.primary)
            }
        }
    }
}
