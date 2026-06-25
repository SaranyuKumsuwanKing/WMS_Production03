package com.kingone.wms.ui.screens

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Card
import androidx.compose.material3.Divider
import androidx.compose.material3.ExtendedFloatingActionButton
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.ui.unit.dp
import androidx.navigation.NavHostController
import com.kingone.wms.Routes
import com.kingone.wms.data.CountLineUpdate
import com.kingone.wms.data.CountSessionDetail
import com.kingone.wms.data.CountSessionSummary
import com.kingone.wms.data.CreateCountRequest
import com.kingone.wms.data.WarehouseDto
import com.kingone.wms.data.WmsRepository
import com.kingone.wms.ui.CenterLoader
import com.kingone.wms.ui.DropdownField
import com.kingone.wms.ui.InfoCard
import com.kingone.wms.ui.PrimaryButton
import com.kingone.wms.ui.ScanField
import com.kingone.wms.ui.WmsScaffold
import com.kingone.wms.ui.rememberScanner
import com.kingone.wms.ui.toast
import kotlinx.coroutines.launch

@Composable
fun CountListScreen(repo: WmsRepository, nav: NavHostController) {
    var sessions by remember { mutableStateOf<List<CountSessionSummary>?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var showCreate by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()

    fun reload() {
        scope.launch {
            try { sessions = repo.counts(); error = null }
            catch (e: Exception) { error = e.message }
        }
    }
    LaunchedEffect(Unit) { reload() }

    WmsScaffold(
        title = "Stock counts",
        onBack = { nav.popBackStack() },
        fab = {
            ExtendedFloatingActionButton(
                onClick = { showCreate = true },
                icon = { Icon(Icons.Filled.Add, contentDescription = null) },
                text = { Text("New count") },
            )
        },
    ) { padding ->
        Column(Modifier.fillMaxSize().padding(padding)) {
            when {
                error != null -> Text(error!!, color = MaterialTheme.colorScheme.error, modifier = Modifier.padding(16.dp))
                sessions == null -> CenterLoader()
                else -> LazyColumn(
                    modifier = Modifier.fillMaxSize().padding(12.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    items(sessions!!) { s ->
                        Card(
                            modifier = Modifier.fillMaxWidth().clickable {
                                nav.navigate("${Routes.COUNT_DETAIL}/${s.id}")
                            },
                        ) {
                            Column(Modifier.padding(14.dp)) {
                                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                                    Text("Count #${s.id}", fontWeight = FontWeight.Bold)
                                    Text(s.status, color = MaterialTheme.colorScheme.primary, fontWeight = FontWeight.Medium)
                                }
                                Text(
                                    listOfNotNull(
                                        s.warehouse?.code,
                                        s.note,
                                        "${s.count?.lines ?: 0} lines",
                                    ).joinToString(" · "),
                                    style = MaterialTheme.typography.bodySmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                                s.createdBy?.fullName?.let {
                                    Text("by $it", style = MaterialTheme.typography.bodySmall)
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    if (showCreate) {
        CreateCountDialog(
            repo = repo,
            onDismiss = { showCreate = false },
            onCreated = { id ->
                showCreate = false
                nav.navigate("${Routes.COUNT_DETAIL}/$id")
            },
        )
    }
}

@Composable
private fun CreateCountDialog(repo: WmsRepository, onDismiss: () -> Unit, onCreated: (Int) -> Unit) {
    var scopeType by remember { mutableStateOf("WAREHOUSE") }
    var warehouses by remember { mutableStateOf<List<WarehouseDto>>(emptyList()) }
    var warehouse by remember { mutableStateOf<WarehouseDto?>(null) }
    var binCode by remember { mutableStateOf("") }
    var binId by remember { mutableStateOf<Int?>(null) }
    var itemCode by remember { mutableStateOf("") }
    var itemId by remember { mutableStateOf<Int?>(null) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()

    LaunchedEffect(Unit) {
        runCatching { repo.warehouses() }.onSuccess { warehouses = it; warehouse = it.firstOrNull() }
    }
    val scanBin = rememberScanner { code ->
        binCode = code
        scope.launch { runCatching { repo.lookupBin(code).bin }.onSuccess { binId = it.id; error = null }.onFailure { error = it.message } }
    }
    val scanItem = rememberScanner { code ->
        itemCode = code
        scope.launch { runCatching { repo.lookupItem(code).item }.onSuccess { itemId = it.id; error = null }.onFailure { error = it.message } }
    }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("New stock count") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    listOf("WAREHOUSE", "BIN", "ITEM").forEach { s ->
                        FilterChip(selected = scopeType == s, onClick = { scopeType = s }, label = { Text(s) })
                    }
                }
                when (scopeType) {
                    "WAREHOUSE" -> DropdownField(
                        label = "Warehouse",
                        items = warehouses,
                        selected = warehouse,
                        itemLabel = { "${it.code} — ${it.name}" },
                        onSelect = { warehouse = it },
                    )
                    "BIN" -> {
                        ScanField("Bin barcode", binCode, { binCode = it }, onScan = scanBin)
                        binId?.let { Text("Bin resolved ✓", color = MaterialTheme.colorScheme.primary) }
                    }
                    "ITEM" -> {
                        ScanField("Item number / barcode", itemCode, { itemCode = it }, onScan = scanItem)
                        itemId?.let { Text("Item resolved ✓", color = MaterialTheme.colorScheme.primary) }
                    }
                }
                if (error != null) Text(error!!, color = MaterialTheme.colorScheme.error)
            }
        },
        confirmButton = {
            TextButton(
                enabled = !busy,
                onClick = {
                    val req = when (scopeType) {
                        "WAREHOUSE" -> warehouse?.let { CreateCountRequest(scope = "WAREHOUSE", warehouseId = it.id) }
                        "BIN" -> binId?.let { CreateCountRequest(scope = "BIN", binId = it) }
                        else -> itemId?.let { CreateCountRequest(scope = "ITEM", itemId = it) }
                    }
                    if (req == null) { error = "Please complete the selection."; return@TextButton }
                    busy = true; error = null
                    scope.launch {
                        try { onCreated(repo.createCount(req).id) }
                        catch (e: Exception) { error = e.message }
                        finally { busy = false }
                    }
                },
            ) { Text("Create") }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
    )
}

@Composable
fun CountDetailScreen(repo: WmsRepository, nav: NavHostController, id: Int) {
    var detail by remember { mutableStateOf<CountSessionDetail?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    val counted = remember { mutableStateMapOf<Int, String>() }
    val scope = rememberCoroutineScope()
    val context = LocalContext.current

    fun load() {
        scope.launch {
            try {
                val d = repo.countDetail(id)
                detail = d
                counted.clear()
                d.lines.forEach { counted[it.id] = it.countedQty ?: "" }
                error = null
            } catch (e: Exception) { error = e.message }
        }
    }
    LaunchedEffect(id) { load() }

    val locked = detail?.status == "COMPLETED"

    WmsScaffold(title = "Count #$id", onBack = { nav.popBackStack() }) { padding ->
        Column(Modifier.fillMaxSize().padding(padding)) {
            when {
                error != null -> Text(error!!, color = MaterialTheme.colorScheme.error, modifier = Modifier.padding(16.dp))
                detail == null -> CenterLoader()
                else -> {
                    val d = detail!!
                    Column(Modifier.fillMaxWidth().padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        InfoCard {
                            Text("Status: ${d.status}", fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.primary)
                            d.warehouse?.code?.let { Text("Warehouse: $it") }
                            d.note?.let { Text(it, style = MaterialTheme.typography.bodySmall) }
                        }
                    }
                    LazyColumn(
                        modifier = Modifier.fillMaxWidth().weight(1f).padding(horizontal = 12.dp),
                        verticalArrangement = Arrangement.spacedBy(6.dp),
                    ) {
                        items(d.lines) { line ->
                            Card(Modifier.fillMaxWidth()) {
                                Column(Modifier.padding(12.dp)) {
                                    Text("${line.itemNumber} · ${line.binCode} · lot ${line.lotCode}", fontWeight = FontWeight.Medium)
                                    Text(line.description, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                                    Row(Modifier.fillMaxWidth().padding(top = 6.dp), verticalAlignment = androidx.compose.ui.Alignment.CenterVertically) {
                                        Text("System: ${line.systemQty} ${line.uom}", modifier = Modifier.weight(1f))
                                        OutlinedTextField(
                                            value = counted[line.id] ?: "",
                                            onValueChange = { counted[line.id] = it },
                                            label = { Text("Counted") },
                                            singleLine = true,
                                            enabled = !locked && line.status != "POSTED",
                                            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                                            modifier = Modifier.width(140.dp),
                                        )
                                    }
                                    line.variance?.let {
                                        if (it != "0") Text("Variance: $it", color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
                                    }
                                    if (line.status == "POSTED") Text("Posted ✓", color = MaterialTheme.colorScheme.primary, style = MaterialTheme.typography.bodySmall)
                                    if (line.status == "RECOUNT") Text("Needs recount", color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
                                }
                            }
                        }
                    }
                    if (!locked) {
                        Row(Modifier.fillMaxWidth().padding(12.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                            PrimaryButtonBox(Modifier.weight(1f)) {
                                PrimaryButton("Save", loading = busy) {
                                    busy = true; error = null
                                    scope.launch {
                                        try {
                                            val updates = d.lines.map { CountLineUpdate(it.id, (counted[it.id] ?: "").trim().ifBlank { null }) }
                                            repo.saveCountLines(id, updates)
                                            toast(context, "Saved.")
                                            load()
                                        } catch (e: Exception) { error = e.message } finally { busy = false }
                                    }
                                }
                            }
                            PrimaryButtonBox(Modifier.weight(1f)) {
                                PrimaryButton("Post", loading = busy) {
                                    busy = true; error = null
                                    scope.launch {
                                        try {
                                            val updates = d.lines.map { CountLineUpdate(it.id, (counted[it.id] ?: "").trim().ifBlank { null }) }
                                            repo.saveCountLines(id, updates)
                                            val res = repo.postCount(id)
                                            toast(context, "Posted ${res.posted}, no-change ${res.noChange}, recount ${res.recount}, pending ${res.pending}")
                                            load()
                                        } catch (e: Exception) { error = e.message } finally { busy = false }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun PrimaryButtonBox(modifier: Modifier, content: @Composable () -> Unit) {
    Column(modifier) { content() }
}
