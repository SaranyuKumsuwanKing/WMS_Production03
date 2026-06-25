package com.kingone.wms.ui.screens

import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.navigation.NavHostController
import com.kingone.wms.data.BinDto
import com.kingone.wms.data.IssueRequest
import com.kingone.wms.data.ItemDto
import com.kingone.wms.data.MoveRequest
import com.kingone.wms.data.PickableLine
import com.kingone.wms.data.ReceiveRequest
import com.kingone.wms.data.StockLotLine
import com.kingone.wms.data.WmsRepository
import com.kingone.wms.data.newRequestId
import com.kingone.wms.ui.DropdownField
import com.kingone.wms.ui.FormColumn
import com.kingone.wms.ui.PrimaryButton
import com.kingone.wms.ui.QtyField
import com.kingone.wms.ui.ScanField
import com.kingone.wms.ui.TextField
import com.kingone.wms.ui.WmsScaffold
import com.kingone.wms.ui.rememberScanner
import com.kingone.wms.ui.toast
import kotlinx.coroutines.launch

@Composable
private fun Resolved(text: String) {
    Text(text, color = MaterialTheme.colorScheme.primary, fontWeight = FontWeight.Medium, modifier = Modifier.fillMaxWidth())
}

@Composable
private fun ErrorText(msg: String?) {
    if (msg != null) Text(msg, color = MaterialTheme.colorScheme.error)
}

// ---------------------------------------------------------------------------
// Receive / Return  (item + destination bin -> stock in)
//   type = null    → normal goods receipt (GR)
//   type = "RETURN" → return to warehouse (returns area)
// ---------------------------------------------------------------------------
@Composable
fun ReceiveScreen(repo: WmsRepository, nav: NavHostController) =
    ReceiveForm(repo, nav, screenTitle = "Receive goods", actionLabel = "Post receipt", type = null)

@Composable
fun ReturnScreen(repo: WmsRepository, nav: NavHostController) =
    ReceiveForm(repo, nav, screenTitle = "Return to warehouse", actionLabel = "Post return", type = "RETURN")

@Composable
private fun ReceiveForm(
    repo: WmsRepository,
    nav: NavHostController,
    screenTitle: String,
    actionLabel: String,
    type: String?,
) {
    var itemCode by remember { mutableStateOf("") }
    var item by remember { mutableStateOf<ItemDto?>(null) }
    var binCode by remember { mutableStateOf("") }
    var bin by remember { mutableStateOf<BinDto?>(null) }
    var lotCode by remember { mutableStateOf("") }
    var supplier by remember { mutableStateOf("") }
    var qty by remember { mutableStateOf("") }
    var reference by remember { mutableStateOf("") }
    var note by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()
    val context = LocalContext.current

    fun resolveItem() {
        if (itemCode.isBlank()) return
        scope.launch {
            try { item = repo.lookupItem(itemCode.trim()).item; error = null }
            catch (e: Exception) { item = null; error = e.message }
        }
    }
    fun resolveBin() {
        if (binCode.isBlank()) return
        scope.launch {
            try { bin = repo.lookupBin(binCode.trim()).bin; error = null }
            catch (e: Exception) { bin = null; error = e.message }
        }
    }
    val scanItem = rememberScanner { itemCode = it; resolveItem() }
    val scanBin = rememberScanner { binCode = it; resolveBin() }

    WmsScaffold(title = screenTitle, onBack = { nav.popBackStack() }) { padding ->
        FormColumn(padding) {
            ScanField("Item number / barcode", itemCode, { itemCode = it }, onScan = scanItem)
            PrimaryButton("Find item") { resolveItem() }
            item?.let { Resolved("${it.itemNumber} — ${it.description}") }

            ScanField("Bin barcode", binCode, { binCode = it }, onScan = scanBin)
            PrimaryButton("Find bin") { resolveBin() }
            bin?.let { Resolved("${it.warehouse?.code ?: ""} · ${it.code}") }

            if (item?.lotControlled == true) {
                TextField("Lot / batch number", lotCode, { lotCode = it })
                TextField("Supplier (optional)", supplier, { supplier = it })
            }
            QtyField("Quantity", qty, { qty = it })
            TextField("Reference (optional)", reference, { reference = it })
            TextField("Note (optional)", note, { note = it })

            ErrorText(error)

            PrimaryButton(actionLabel, loading = busy, enabled = item != null && bin != null && qty.isNotBlank()) {
                val it0 = item; val bn = bin
                if (it0 == null || bn == null) return@PrimaryButton
                if (it0.lotControlled && lotCode.isBlank()) { error = "This item needs a lot/batch number."; return@PrimaryButton }
                error = null; busy = true
                scope.launch {
                    try {
                        val res = repo.receive(
                            ReceiveRequest(
                                itemId = it0.id,
                                binId = bn.id,
                                quantity = qty.trim(),
                                lotCode = if (it0.lotControlled) lotCode.trim() else null,
                                supplier = supplier.trim().ifBlank { null },
                                reference = reference.trim().ifBlank { null },
                                note = note.trim().ifBlank { null },
                                type = type,
                                clientRequestId = newRequestId(),
                            ),
                        )
                        toast(context, "Done. Movement #${res.movementId} (lot ${res.lotCode ?: "-"})")
                        qty = ""; lotCode = ""; reference = ""; note = ""
                    } catch (e: Exception) {
                        error = e.message
                    } finally { busy = false }
                }
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Transfer / Put away  (item + from-bin + to-bin -> move stock)
//   type = "TRANSFER" → move between storage bins
//   type = "PUTAWAY"  → move from receiving area to storage
// ---------------------------------------------------------------------------
@Composable
fun TransferScreen(repo: WmsRepository, nav: NavHostController) =
    BinToBinForm(repo, nav, screenTitle = "Transfer stock", actionLabel = "Transfer", type = "TRANSFER")

@Composable
fun PutAwayScreen(repo: WmsRepository, nav: NavHostController) =
    BinToBinForm(repo, nav, screenTitle = "Put away", actionLabel = "Put away", type = "PUTAWAY")

@Composable
private fun BinToBinForm(
    repo: WmsRepository,
    nav: NavHostController,
    screenTitle: String,
    actionLabel: String,
    type: String,
) {
    var itemCode by remember { mutableStateOf("") }
    var item by remember { mutableStateOf<ItemDto?>(null) }
    var fromCode by remember { mutableStateOf("") }
    var fromBin by remember { mutableStateOf<BinDto?>(null) }
    var lots by remember { mutableStateOf<List<StockLotLine>>(emptyList()) }
    var lot by remember { mutableStateOf<StockLotLine?>(null) }
    var toCode by remember { mutableStateOf("") }
    var toBin by remember { mutableStateOf<BinDto?>(null) }
    var qty by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()
    val context = LocalContext.current

    fun loadLots() {
        val it0 = item; val fb = fromBin
        if (it0 == null || fb == null) return
        scope.launch {
            try {
                lots = repo.lookupStock(fb.id, it0.id)
                lot = lots.firstOrNull()
                if (lots.isEmpty()) error = "No stock of ${it0.itemNumber} in ${fb.code}."
            } catch (e: Exception) { error = e.message }
        }
    }
    fun resolveItem() {
        if (itemCode.isBlank()) return
        scope.launch {
            try { item = repo.lookupItem(itemCode.trim()).item; error = null; loadLots() }
            catch (e: Exception) { item = null; error = e.message }
        }
    }
    fun resolveFrom() {
        if (fromCode.isBlank()) return
        scope.launch {
            try { fromBin = repo.lookupBin(fromCode.trim()).bin; error = null; loadLots() }
            catch (e: Exception) { fromBin = null; error = e.message }
        }
    }
    fun resolveTo() {
        if (toCode.isBlank()) return
        scope.launch {
            try { toBin = repo.lookupBin(toCode.trim()).bin; error = null }
            catch (e: Exception) { toBin = null; error = e.message }
        }
    }
    val scanItem = rememberScanner { itemCode = it; resolveItem() }
    val scanFrom = rememberScanner { fromCode = it; resolveFrom() }
    val scanTo = rememberScanner { toCode = it; resolveTo() }

    WmsScaffold(title = screenTitle, onBack = { nav.popBackStack() }) { padding ->
        FormColumn(padding) {
            ScanField("Item number / barcode", itemCode, { itemCode = it }, onScan = scanItem)
            PrimaryButton("Find item") { resolveItem() }
            item?.let { Resolved("${it.itemNumber} — ${it.description}") }

            ScanField("From bin barcode", fromCode, { fromCode = it }, onScan = scanFrom)
            PrimaryButton("Find from-bin") { resolveFrom() }
            fromBin?.let { Resolved("From: ${it.warehouse?.code ?: ""} · ${it.code}") }

            if (lots.isNotEmpty()) {
                DropdownField(
                    label = "Lot",
                    items = lots,
                    selected = lot,
                    itemLabel = { "${it.lotCode}  (avail ${it.quantity})" },
                    onSelect = { lot = it },
                )
            }

            ScanField("To bin barcode", toCode, { toCode = it }, onScan = scanTo)
            PrimaryButton("Find to-bin") { resolveTo() }
            toBin?.let { Resolved("To: ${it.warehouse?.code ?: ""} · ${it.code}") }

            QtyField("Quantity", qty, { qty = it })
            ErrorText(error)

            PrimaryButton(
                actionLabel,
                loading = busy,
                enabled = item != null && fromBin != null && toBin != null && lot != null && qty.isNotBlank(),
            ) {
                val it0 = item; val fb = fromBin; val tb = toBin; val lt = lot
                if (it0 == null || fb == null || tb == null || lt == null) return@PrimaryButton
                if (fb.id == tb.id) { error = "From and to bins must differ."; return@PrimaryButton }
                error = null; busy = true
                scope.launch {
                    try {
                        val res = repo.move(
                            MoveRequest(
                                itemId = it0.id,
                                lotId = lt.lotId,
                                fromBinId = fb.id,
                                toBinId = tb.id,
                                quantity = qty.trim(),
                                type = type,
                                clientRequestId = newRequestId(),
                            ),
                        )
                        toast(context, "Done. Movement #${res.movementId}")
                        qty = ""; loadLots()
                    } catch (e: Exception) {
                        error = e.message
                    } finally { busy = false }
                }
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Goods Issue (issue stock to production)
// ---------------------------------------------------------------------------
@Composable
fun IssueScreen(repo: WmsRepository, nav: NavHostController) {
    var itemCode by remember { mutableStateOf("") }
    var item by remember { mutableStateOf<ItemDto?>(null) }
    var binCode by remember { mutableStateOf("") }
    var bin by remember { mutableStateOf<BinDto?>(null) }
    var lots by remember { mutableStateOf<List<StockLotLine>>(emptyList()) }
    var lot by remember { mutableStateOf<StockLotLine?>(null) }
    var qty by remember { mutableStateOf("") }
    var reference by remember { mutableStateOf("") }
    var note by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()
    val context = LocalContext.current

    fun loadLots() {
        val it0 = item; val bn = bin
        if (it0 == null || bn == null) return
        scope.launch {
            try {
                lots = repo.lookupStock(bn.id, it0.id)
                lot = lots.firstOrNull()
                if (lots.isEmpty()) error = "No stock of ${it0.itemNumber} in ${bn.code}."
            } catch (e: Exception) { error = e.message }
        }
    }
    fun resolveItem() {
        if (itemCode.isBlank()) return
        scope.launch {
            try { item = repo.lookupItem(itemCode.trim()).item; error = null; loadLots() }
            catch (e: Exception) { item = null; error = e.message }
        }
    }
    fun resolveBin() {
        if (binCode.isBlank()) return
        scope.launch {
            try { bin = repo.lookupBin(binCode.trim()).bin; error = null; loadLots() }
            catch (e: Exception) { bin = null; error = e.message }
        }
    }
    val scanItem = rememberScanner { itemCode = it; resolveItem() }
    val scanBin = rememberScanner { binCode = it; resolveBin() }

    WmsScaffold(title = "Goods Issue", onBack = { nav.popBackStack() }) { padding ->
        FormColumn(padding) {
            ScanField("Item number / barcode", itemCode, { itemCode = it }, onScan = scanItem)
            PrimaryButton("Find item") { resolveItem() }
            item?.let { Resolved("${it.itemNumber} — ${it.description}") }

            ScanField("Bin barcode", binCode, { binCode = it }, onScan = scanBin)
            PrimaryButton("Find bin") { resolveBin() }
            bin?.let { Resolved("${it.warehouse?.code ?: ""} · ${it.code}") }

            if (lots.isNotEmpty()) {
                DropdownField(
                    label = "Lot",
                    items = lots,
                    selected = lot,
                    itemLabel = { "${it.lotCode}  (avail ${it.quantity})" },
                    onSelect = { lot = it },
                )
            }

            QtyField("Quantity", qty, { qty = it })
            TextField("Reference (optional)", reference, { reference = it })
            TextField("Note (optional)", note, { note = it })
            ErrorText(error)

            PrimaryButton(
                "Goods Issue",
                loading = busy,
                enabled = item != null && bin != null && lot != null && qty.isNotBlank(),
            ) {
                val it0 = item; val bn = bin; val lt = lot
                if (it0 == null || bn == null || lt == null) return@PrimaryButton
                error = null; busy = true
                scope.launch {
                    try {
                        val res = repo.issue(
                            IssueRequest(
                                itemId = it0.id,
                                lotId = lt.lotId,
                                binId = bn.id,
                                quantity = qty.trim(),
                                reference = reference.trim().ifBlank { null },
                                note = note.trim().ifBlank { null },
                                clientRequestId = newRequestId(),
                            ),
                        )
                        toast(context, "Issued. Movement #${res.movementId}")
                        qty = ""; reference = ""; note = ""; loadLots()
                    } catch (e: Exception) {
                        error = e.message
                    } finally { busy = false }
                }
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Pick List (FIFO pick suggestion — read only)
// Scan an item → show total available + the bins/lots to pick from, oldest first.
// ---------------------------------------------------------------------------
@Composable
fun PickListScreen(repo: WmsRepository, nav: NavHostController) {
    var itemCode by remember { mutableStateOf("") }
    var item by remember { mutableStateOf<ItemDto?>(null) }
    var total by remember { mutableStateOf("0") }
    var lines by remember { mutableStateOf<List<PickableLine>>(emptyList()) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()

    fun build() {
        if (itemCode.isBlank()) return
        error = null; busy = true
        scope.launch {
            try {
                val it0 = repo.lookupItem(itemCode.trim()).item
                item = it0
                val p = repo.pickable(it0.id)
                total = p.total
                lines = p.lines
                if (lines.isEmpty()) error = "No stock available for ${it0.itemNumber}."
            } catch (e: Exception) {
                item = null; lines = emptyList(); total = "0"; error = e.message
            } finally { busy = false }
        }
    }
    val scanItem = rememberScanner { itemCode = it; build() }

    WmsScaffold(title = "Pick List", onBack = { nav.popBackStack() }) { padding ->
        FormColumn(padding) {
            ScanField("Item number / barcode", itemCode, { itemCode = it }, onScan = scanItem)
            PrimaryButton("Build pick list", loading = busy) { build() }
            item?.let { Resolved("${it.itemNumber} — ${it.description}") }
            if (item != null) {
                Text(
                    "Available: $total ${item?.uom ?: ""}  ·  pick oldest first (FIFO)",
                    fontWeight = FontWeight.SemiBold,
                    modifier = Modifier.fillMaxWidth(),
                )
            }
            ErrorText(error)
            lines.forEachIndexed { idx, ln -> PickLineRow(idx + 1, ln) }
        }
    }
}

@Composable
private fun PickLineRow(seq: Int, ln: PickableLine) {
    val age = ln.ageDays?.let { "  ·  ${it}d" } ?: ""
    Text(
        "$seq.  ${ln.warehouseCode} · ${ln.binCode}   lot ${ln.lotCode}   qty ${ln.quantity}$age",
        modifier = Modifier.fillMaxWidth(),
    )
}
