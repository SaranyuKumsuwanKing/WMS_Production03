package com.kingone.wms.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.Divider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.navigation.NavHostController
import com.kingone.wms.data.BinLookupResponse
import com.kingone.wms.data.ItemLookupResponse
import com.kingone.wms.data.WmsRepository
import com.kingone.wms.ui.FormColumn
import com.kingone.wms.ui.InfoCard
import com.kingone.wms.ui.InfoRow
import com.kingone.wms.ui.PrimaryButton
import com.kingone.wms.ui.ScanField
import com.kingone.wms.ui.WmsScaffold
import com.kingone.wms.ui.rememberScanner
import kotlinx.coroutines.launch

@Composable
fun LookupItemScreen(repo: WmsRepository, nav: NavHostController) {
    var code by remember { mutableStateOf("") }
    var loading by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var result by remember { mutableStateOf<ItemLookupResponse?>(null) }
    var total by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()

    fun search() {
        if (code.isBlank()) return
        error = null
        loading = true
        result = null
        total = null
        scope.launch {
            try {
                val r = repo.lookupItem(code.trim())
                result = r
                total = runCatching { repo.pickable(r.item.id).total }.getOrNull()
            } catch (e: Exception) {
                error = e.message
            } finally {
                loading = false
            }
        }
    }

    val scan = rememberScanner { code = it; search() }

    WmsScaffold(title = "Scan / find item", onBack = { nav.popBackStack() }) { padding ->
        FormColumn(padding) {
            ScanField("Item number or barcode", code, { code = it }, onScan = scan)
            PrimaryButton("Search", loading = loading) { search() }
            if (error != null) {
                Text(error!!, color = MaterialTheme.colorScheme.error)
            }
            result?.let { r ->
                InfoCard(title = r.item.itemNumber) {
                    Text(r.item.description, fontWeight = FontWeight.Medium)
                    InfoRow("UoM", r.item.uom)
                    r.item.category?.let { InfoRow("Category", it) }
                    r.item.inventoryType?.let { InfoRow("Type", it) }
                    InfoRow("Lot controlled", if (r.item.lotControlled) "Yes" else "No")
                    total?.let { InfoRow("Total on hand", it) }
                }
                if (r.lots.isNotEmpty()) {
                    InfoCard(title = "Lots") {
                        r.lots.forEach { lot ->
                            val qty = "${lot.quantity ?: "0"} ${r.item.uom}"
                            val vendor = lot.supplier?.takeIf { it.isNotBlank() }
                            InfoRow(lot.lotCode, if (vendor != null) "$qty · $vendor" else qty)
                        }
                    }
                }
            }
        }
    }
}

@Composable
fun LookupBinScreen(repo: WmsRepository, nav: NavHostController) {
    var code by remember { mutableStateOf("") }
    var loading by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var result by remember { mutableStateOf<BinLookupResponse?>(null) }
    val scope = rememberCoroutineScope()

    fun search() {
        if (code.isBlank()) return
        error = null
        loading = true
        result = null
        scope.launch {
            try {
                result = repo.lookupBin(code.trim())
            } catch (e: Exception) {
                error = e.message
            } finally {
                loading = false
            }
        }
    }

    val scan = rememberScanner { code = it; search() }

    WmsScaffold(title = "Scan / find bin", onBack = { nav.popBackStack() }) { padding ->
        FormColumn(padding) {
            ScanField("Bin barcode", code, { code = it }, onScan = scan)
            PrimaryButton("Search", loading = loading) { search() }
            if (error != null) {
                Text(error!!, color = MaterialTheme.colorScheme.error)
            }
            result?.let { r ->
                InfoCard(title = "${r.bin.warehouse?.code ?: ""} · ${r.bin.code}") {
                    r.bin.description?.let { Text(it) }
                    InfoRow("Barcode", r.bin.barcode)
                    InfoRow("Type", r.bin.type)
                    r.bin.warehouse?.let { InfoRow("Warehouse", it.name) }
                }
                InfoCard(title = "Contents (${r.contents.size})") {
                    if (r.contents.isEmpty()) {
                        Text("Empty bin.", color = MaterialTheme.colorScheme.onSurfaceVariant)
                    } else {
                        r.contents.forEachIndexed { i, line ->
                            if (i > 0) Divider(Modifier.fillMaxWidth())
                            Row(Modifier.fillMaxWidth().padding(vertical = 4.dp), horizontalArrangement = Arrangement.SpaceBetween) {
                                Column(Modifier.fillMaxWidth(0.7f)) {
                                    Text(line.itemNumber, fontWeight = FontWeight.Medium)
                                    Text(
                                        "${line.description} · lot ${line.lotCode}",
                                        style = MaterialTheme.typography.bodySmall,
                                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                                    )
                                }
                                Text("${line.quantity} ${line.uom}", fontWeight = FontWeight.SemiBold)
                            }
                        }
                    }
                }
            }
        }
    }
}
