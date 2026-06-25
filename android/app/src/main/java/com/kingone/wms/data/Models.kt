package com.kingone.wms.data

import com.google.gson.annotations.SerializedName

// Request/response shapes mirror the WMS Next.js API (app/api/**). The server
// serializes Prisma Decimal as strings, so all quantities are String here.

// ---- Auth ----
data class LoginRequest(val username: String, val password: String)
data class UserDto(val username: String, val fullName: String, val role: String)
data class LoginResponse(val user: UserDto, val token: String)

// ---- Items / lots ----
data class ItemDto(
    val id: Int,
    val itemNumber: String,
    val description: String,
    val uom: String,
    val category: String? = null,
    val inventoryType: String? = null,
    val lotControlled: Boolean = true,
    val barcode: String,
    val active: Boolean = true,
    val minStock: String? = null,
)
data class LotDto(val id: Int, val lotCode: String, val supplier: String? = null, val quantity: String? = null)
data class ItemLookupResponse(val item: ItemDto, val lots: List<LotDto> = emptyList())
data class ItemsResponse(val items: List<ItemDto> = emptyList(), val total: Int = 0, val truncated: Boolean = false)

// ---- Warehouses / bins ----
data class WarehouseRefDto(val id: Int, val code: String, val name: String)
data class BinDto(
    val id: Int,
    val warehouseId: Int,
    val code: String,
    val description: String? = null,
    val type: String = "STORAGE",
    val barcode: String,
    val active: Boolean = true,
    val warehouse: WarehouseRefDto? = null,
)
data class BinContentLine(
    val itemId: Int,
    val itemNumber: String,
    val description: String,
    val uom: String,
    val lotId: Int,
    val lotCode: String,
    val quantity: String,
)
data class BinLookupResponse(val bin: BinDto, val contents: List<BinContentLine> = emptyList())
data class BinsResponse(val bins: List<BinDto> = emptyList())

data class WarehouseDto(val id: Int, val code: String, val name: String, val active: Boolean = true)
data class WarehousesResponse(val warehouses: List<WarehouseDto> = emptyList())

// ---- Stock lookup ----
data class StockLotLine(
    val lotId: Int,
    val lotCode: String,
    val supplier: String? = null,
    val quantity: String,
)
data class StockLookupResponse(val lots: List<StockLotLine> = emptyList())

data class PickableLine(
    val binCode: String,
    val warehouseCode: String,
    val lotCode: String,
    val quantity: String,
    val ageDays: Int? = null,
)
data class PickableResponse(val total: String = "0", val lines: List<PickableLine> = emptyList())

// ---- Transactions ----
data class ReceiveRequest(
    val itemId: Int,
    val binId: Int,
    val quantity: String,
    val lotCode: String? = null,
    val supplier: String? = null,
    val reference: String? = null,
    val note: String? = null,
    val type: String? = null,
    val clientRequestId: String? = null,
)
data class MoveRequest(
    val itemId: Int,
    val lotId: Int,
    val fromBinId: Int,
    val toBinId: Int,
    val quantity: String,
    val note: String? = null,
    val type: String? = null,
    val clientRequestId: String? = null,
)
data class IssueRequest(
    val itemId: Int,
    val lotId: Int,
    val binId: Int,
    val quantity: String,
    val reference: String? = null,
    val note: String? = null,
    val clientRequestId: String? = null,
)
data class MovementResponse(val movementId: Int, val replay: Boolean = false, val lotCode: String? = null)

// ---- Counts ----
data class CountWarehouseRef(val code: String? = null, val name: String? = null)
data class CountCreatedByRef(val fullName: String? = null)
data class CountLinesCountRef(val lines: Int = 0)
data class CountSessionSummary(
    val id: Int,
    val status: String,
    val note: String? = null,
    val warehouse: CountWarehouseRef? = null,
    val createdBy: CountCreatedByRef? = null,
    @SerializedName("_count") val count: CountLinesCountRef? = null,
    val createdAt: String? = null,
)
data class CountListResponse(val sessions: List<CountSessionSummary> = emptyList())

data class CreateCountRequest(
    val scope: String,
    val warehouseId: Int? = null,
    val binId: Int? = null,
    val itemId: Int? = null,
    val note: String? = null,
)
data class CreateCountResponse(val id: Int, val lines: Int = 0)

data class CountLineDto(
    val id: Int,
    val itemId: Int,
    val binId: Int,
    val lotId: Int,
    val itemNumber: String,
    val description: String,
    val uom: String,
    val binCode: String,
    val binBarcode: String,
    val lotCode: String,
    val systemQty: String,
    val countedQty: String? = null,
    val variance: String? = null,
    val status: String,
)
data class CountSessionDetail(
    val id: Int,
    val status: String,
    val note: String? = null,
    val warehouse: CountWarehouseRef? = null,
    val createdBy: String? = null,
    val postedBy: String? = null,
    val createdAt: String? = null,
    val postedAt: String? = null,
    val lines: List<CountLineDto> = emptyList(),
)
data class CountDetailResponse(val session: CountSessionDetail)

data class CountLineUpdate(val lineId: Int, val countedQty: String?)
data class SaveCountLinesRequest(val lines: List<CountLineUpdate>)
data class SaveOkResponse(val ok: Boolean = true)
data class PostCountResponse(
    val posted: Int = 0,
    val noChange: Int = 0,
    val recount: Int = 0,
    val pending: Int = 0,
    val completed: Boolean = false,
)

data class ApiError(val error: String? = null, val code: String? = null)
