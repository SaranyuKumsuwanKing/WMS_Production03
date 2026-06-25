package com.kingone.wms.data

import android.content.Context
import com.kingone.wms.BuildConfig
import com.google.gson.Gson
import okhttp3.OkHttpClient
import okhttp3.logging.HttpLoggingInterceptor
import retrofit2.HttpException
import retrofit2.Retrofit
import retrofit2.converter.gson.GsonConverterFactory
import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.PATCH
import retrofit2.http.POST
import retrofit2.http.Path
import retrofit2.http.Query
import java.io.IOException
import java.util.UUID
import java.util.concurrent.TimeUnit

interface ApiService {
    @POST("api/auth/login") suspend fun login(@Body body: LoginRequest): LoginResponse
    @POST("api/auth/logout") suspend fun logout(): retrofit2.Response<okhttp3.ResponseBody>

    @GET("api/lookup/item") suspend fun lookupItem(@Query("code") code: String): ItemLookupResponse
    @GET("api/lookup/bin") suspend fun lookupBin(@Query("code") code: String): BinLookupResponse
    @GET("api/lookup/stock") suspend fun lookupStock(
        @Query("binId") binId: Int,
        @Query("itemId") itemId: Int,
    ): StockLookupResponse
    @GET("api/pick/available") suspend fun pickable(@Query("itemId") itemId: Int): PickableResponse

    @POST("api/transactions/receive") suspend fun receive(@Body body: ReceiveRequest): MovementResponse
    @POST("api/transactions/move") suspend fun move(@Body body: MoveRequest): MovementResponse
    @POST("api/transactions/issue") suspend fun issue(@Body body: IssueRequest): MovementResponse

    @GET("api/warehouses") suspend fun warehouses(): WarehousesResponse
    @GET("api/bins") suspend fun bins(
        @Query("warehouseId") warehouseId: Int?,
        @Query("q") q: String?,
    ): BinsResponse
    @GET("api/items") suspend fun items(@Query("q") q: String?): ItemsResponse

    @GET("api/counts") suspend fun counts(): CountListResponse
    @POST("api/counts") suspend fun createCount(@Body body: CreateCountRequest): CreateCountResponse
    @GET("api/counts/{id}") suspend fun countDetail(@Path("id") id: Int): CountDetailResponse
    @PATCH("api/counts/{id}/lines") suspend fun saveCountLines(
        @Path("id") id: Int,
        @Body body: SaveCountLinesRequest,
    ): SaveOkResponse
    @POST("api/counts/{id}/post") suspend fun postCount(@Path("id") id: Int): PostCountResponse
}

/** Persisted settings + session (server address, auth token, signed-in user). */
class SessionManager(context: Context) {
    private val prefs = context.getSharedPreferences("wms", Context.MODE_PRIVATE)

    var baseUrl: String
        get() = prefs.getString("baseUrl", "") ?: ""
        set(v) { prefs.edit().putString("baseUrl", normalizeBase(v)).apply() }

    // JWT issued by the API at login; sent as `Authorization: Bearer <token>`.
    var token: String?
        get() = prefs.getString("token", null)
        set(v) { prefs.edit().apply { if (v == null) remove("token") else putString("token", v) }.apply() }

    var userName: String?
        get() = prefs.getString("userName", null)
        set(v) { prefs.edit().putString("userName", v).apply() }
    var fullName: String?
        get() = prefs.getString("fullName", null)
        set(v) { prefs.edit().putString("fullName", v).apply() }
    var role: String?
        get() = prefs.getString("role", null)
        set(v) { prefs.edit().putString("role", v).apply() }

    val isConfigured: Boolean get() = baseUrl.isNotBlank()
    val isLoggedIn: Boolean get() = !token.isNullOrBlank() && !userName.isNullOrBlank()

    fun saveUser(u: UserDto) { userName = u.username; fullName = u.fullName; role = u.role }
    fun clearAuth() { token = null; userName = null; fullName = null; role = null }

    // ---- Kiosk + supervisor ----
    var kioskEnabled: Boolean
        get() = prefs.getBoolean("kioskEnabled", false)
        set(v) { prefs.edit().putBoolean("kioskEnabled", v).apply() }

    fun hasSupervisorPassword(): Boolean = !prefs.getString("supHash", null).isNullOrBlank()
    fun setSupervisorPassword(p: String) { prefs.edit().putString("supHash", hashPassword(p)).apply() }
    fun verifySupervisor(p: String): Boolean {
        val stored = prefs.getString("supHash", null) ?: return false
        return if (stored.startsWith("pbkdf2:")) {
            verifyPbkdf2(p, stored)
        } else {
            // Legacy unsalted SHA-256 hash — verify, then transparently re-hash with
            // PBKDF2 so existing supervisors aren't locked out by the upgrade.
            val ok = constantTimeEquals(stored, sha256(p))
            if (ok) setSupervisorPassword(p)
            ok
        }
    }

    companion object {
        fun normalizeBase(v: String): String {
            var s = v.trim()
            if (s.isEmpty()) return ""
            if (!s.startsWith("http://") && !s.startsWith("https://")) s = "http://$s"
            if (!s.endsWith("/")) s += "/"
            return s
        }
    }
}

object ApiFactory {
    private val gson = Gson()
    fun create(baseUrl: String, session: SessionManager): ApiService {
        val builder = OkHttpClient.Builder()
            .connectTimeout(15, TimeUnit.SECONDS)
            .readTimeout(30, TimeUnit.SECONDS)
        // Stateless token auth: attach the JWT as a Bearer header on every
        // request. Read live from the session so it picks up the token saved at
        // login (and disappears after logout) without rebuilding the client.
        builder.addInterceptor { chain ->
            val t = session.token
            val request = if (!t.isNullOrBlank()) {
                chain.request().newBuilder()
                    .header("Authorization", "Bearer $t")
                    .build()
            } else {
                chain.request()
            }
            chain.proceed(request)
        }
        // Network logging only in debug builds — never log requests in release.
        if (BuildConfig.DEBUG) {
            builder.addInterceptor(
                HttpLoggingInterceptor().apply { level = HttpLoggingInterceptor.Level.BASIC },
            )
        }
        val client = builder.build()
        return Retrofit.Builder()
            .baseUrl(if (baseUrl.isBlank()) "http://localhost/" else baseUrl)
            .client(client)
            .addConverterFactory(GsonConverterFactory.create(gson))
            .build()
            .create(ApiService::class.java)
    }
}

/** Friendly error carrying the server's message (mapped from the JSON error body). */
class WmsException(message: String, val code: String? = null, val status: Int? = null) :
    Exception(message)

private val errorGson = Gson()

suspend fun <T> apiCall(block: suspend () -> T): T {
    try {
        return block()
    } catch (e: WmsException) {
        throw e
    } catch (e: HttpException) {
        val raw = runCatching { e.response()?.errorBody()?.string() }.getOrNull()
        val parsed = raw?.let { runCatching { errorGson.fromJson(it, ApiError::class.java) }.getOrNull() }
        val msg = parsed?.error?.takeIf { it.isNotBlank() } ?: "Request failed (${e.code()})"
        throw WmsException(msg, parsed?.code, e.code())
    } catch (e: IOException) {
        throw WmsException("Cannot reach the server. Check the address and Wi-Fi.")
    } catch (e: Exception) {
        throw WmsException(e.message ?: "Unexpected error")
    }
}

class WmsRepository(private val container: AppContainer) {
    private val api get() = container.api()
    private val session get() = container.session

    suspend fun login(username: String, password: String): UserDto = apiCall {
        val res = api.login(LoginRequest(username.trim(), password))
        session.token = res.token
        session.saveUser(res.user)
        res.user
    }

    suspend fun logout() {
        runCatching { api.logout() }
        session.clearAuth()
    }

    suspend fun lookupItem(code: String) = apiCall { api.lookupItem(code) }
    suspend fun lookupBin(code: String) = apiCall { api.lookupBin(code) }
    suspend fun lookupStock(binId: Int, itemId: Int) = apiCall { api.lookupStock(binId, itemId).lots }
    suspend fun pickable(itemId: Int) = apiCall { api.pickable(itemId) }

    suspend fun receive(body: ReceiveRequest) = apiCall { api.receive(body) }
    suspend fun move(body: MoveRequest) = apiCall { api.move(body) }
    suspend fun issue(body: IssueRequest) = apiCall { api.issue(body) }

    suspend fun warehouses() = apiCall { api.warehouses().warehouses }
    suspend fun bins(warehouseId: Int? = null, q: String? = null) = apiCall { api.bins(warehouseId, q).bins }
    suspend fun items(q: String? = null) = apiCall { api.items(q).items }

    suspend fun counts() = apiCall { api.counts().sessions }
    suspend fun createCount(body: CreateCountRequest) = apiCall { api.createCount(body) }
    suspend fun countDetail(id: Int) = apiCall { api.countDetail(id).session }
    suspend fun saveCountLines(id: Int, lines: List<CountLineUpdate>) =
        apiCall { api.saveCountLines(id, SaveCountLinesRequest(lines)) }
    suspend fun postCount(id: Int) = apiCall { api.postCount(id) }
}

/** App-wide singletons. Rebuilds the API client whenever the base URL changes. */
class AppContainer(context: Context) {
    val session = SessionManager(context.applicationContext)

    @Volatile private var cachedBase: String = session.baseUrl
    @Volatile private var cachedApi: ApiService = ApiFactory.create(session.baseUrl, session)

    @Synchronized
    fun api(): ApiService {
        if (cachedBase != session.baseUrl) {
            cachedBase = session.baseUrl
            cachedApi = ApiFactory.create(session.baseUrl, session)
        }
        return cachedApi
    }

    val repo: WmsRepository by lazy { WmsRepository(this) }
}

/** Idempotency key so a double-tap/retry replays instead of double-posting. */
fun newRequestId(): String = UUID.randomUUID().toString()

// ---- Supervisor password hashing ----
// Stored format: "pbkdf2:<iterations>:<saltBase64>:<hashBase64>" (NO_WRAP base64).
// Legacy values are 64-char unsalted SHA-256 hex; verifySupervisor upgrades them.
private const val PBKDF2_ITERATIONS = 120_000
private const val PBKDF2_KEY_BITS = 256
private const val PBKDF2_SALT_BYTES = 16

private fun hashPassword(p: String): String {
    val salt = ByteArray(PBKDF2_SALT_BYTES).also { java.security.SecureRandom().nextBytes(it) }
    val hash = pbkdf2(p, salt, PBKDF2_ITERATIONS, PBKDF2_KEY_BITS)
    val saltB64 = android.util.Base64.encodeToString(salt, android.util.Base64.NO_WRAP)
    val hashB64 = android.util.Base64.encodeToString(hash, android.util.Base64.NO_WRAP)
    return "pbkdf2:$PBKDF2_ITERATIONS:$saltB64:$hashB64"
}

private fun verifyPbkdf2(p: String, stored: String): Boolean {
    val parts = stored.split(":")
    if (parts.size != 4) return false
    val iterations = parts[1].toIntOrNull() ?: return false
    val salt = runCatching { android.util.Base64.decode(parts[2], android.util.Base64.NO_WRAP) }.getOrNull() ?: return false
    val expected = runCatching { android.util.Base64.decode(parts[3], android.util.Base64.NO_WRAP) }.getOrNull() ?: return false
    val actual = pbkdf2(p, salt, iterations, expected.size * 8)
    return java.security.MessageDigest.isEqual(actual, expected)
}

private fun pbkdf2(p: String, salt: ByteArray, iterations: Int, keyBits: Int): ByteArray {
    val spec = javax.crypto.spec.PBEKeySpec(p.toCharArray(), salt, iterations, keyBits)
    return javax.crypto.SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256")
        .generateSecret(spec).encoded
}

private fun constantTimeEquals(a: String, b: String): Boolean =
    java.security.MessageDigest.isEqual(a.toByteArray(Charsets.UTF_8), b.toByteArray(Charsets.UTF_8))

private fun sha256(s: String): String =
    java.security.MessageDigest.getInstance("SHA-256")
        .digest(s.toByteArray(Charsets.UTF_8))
        .joinToString("") { "%02x".format(it) }
