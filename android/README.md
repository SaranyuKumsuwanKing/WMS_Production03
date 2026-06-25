# King One WMS — Android app

A native Android (Kotlin + Jetpack Compose) client for the WMS backend. It talks
to the existing Next.js REST API over your Wi‑Fi/LAN — the SQLite database stays
on the server; the phone never touches the file.

## Features (v1)

- **Login** against the WMS API (session cookie; no backend changes needed).
- **Scan / find item** — camera barcode scan or type an item number; shows item
  details, lots, and total on hand.
- **Scan / find bin** — shows bin info and everything currently in it.
- **Receive** goods (item + bin + lot + qty → goods receipt).
- **Move** stock between bins (with lot selection from what's actually in the bin).
- **Issue** stock to production.
- **Stock count** — create a count (by warehouse / bin / item), enter counted
  quantities, save, and post.

All write actions send an idempotency key, so a double‑tap can't post twice.

## Architecture

`MainActivity` → Compose `NavHost` → screens in `ui/screens`.
`data/` holds the Retrofit `ApiService`, the Gson models (mirroring the API),
a cookie jar that stores the `wms_session` cookie, and a thin `WmsRepository`.
The server address is set at runtime (Settings) and stored in `SharedPreferences`.

## 1) Make the backend reachable on the LAN

By default the dev server only listens on localhost. Start it bound to all
interfaces so the phone can reach it:

```powershell
cd "D:\Stefan Project\WMS\app"
# production-style (already binds 0.0.0.0):
pnpm build; pnpm start
# or for development:
npx next dev -H 0.0.0.0 -p 3000
```

Find the PC's LAN IP (`ipconfig` → IPv4, e.g. `192.168.1.50`) and allow inbound
port 3000 through Windows Firewall once:

```powershell
New-NetFirewallRule -DisplayName "WMS 3000" -Direction Inbound -Action Allow -Protocol TCP -LocalPort 3000
```

The phone and PC must be on the **same Wi‑Fi network**.

## 2) Build the app

**Easiest: Android Studio.** Open the `android/` folder, let it sync, then
Run ▶ onto a connected phone (USB debugging on) or an emulator. Studio uses its
bundled JDK and SDK automatically.

**Command line:** use `build-apk.bat` (sets the bundled JDK + a short TEMP path,
then runs the Gradle wrapper). Output:
`app/build/outputs/apk/debug/app-debug.apk`.

> Note: `local.properties` points at this machine's SDK and `gradle.properties`
> points `org.gradle.java.home` at Android Studio's bundled JDK. Adjust if your
> install paths differ.

## 3) Install on the phone

- Connect by USB with **USB debugging** enabled and use `adb install -r app-debug.apk`,
  or copy the APK to the phone and open it (allow "install from unknown sources").

## 4) First run

1. On first launch you'll land on **Server settings** — enter the PC address,
   e.g. `192.168.1.50:3000` (the `http://` is added for you). Save.
2. Sign in with your WMS credentials (demo: `admin` / `admin123`).
3. Use the tiles on the home screen.

You can change the server address any time from the ⚙️ icon.

## Kiosk mode

The app can lock to a single-app **kiosk** so floor users can only sign in/out and
use the WMS — they can't reach Home, Recents, or other apps.

**Set it up (supervisor):**

1. Tap the ⚙️ icon → on first use, **create a supervisor password**.
2. Tap **Enable kiosk**. The app enters Android Lock Task Mode and re-enters it
   automatically on every launch/reboot.

**Exit kiosk (supervisor):** ⚙️ → enter the supervisor password → **Disable kiosk**.

### Two levels of lockdown

- **Screen pinning (default, no setup):** works on any phone. The app pins itself;
  this is fine for honest users but is not tamper-proof (a determined user can
  unpin by holding the system buttons).
- **Device Owner (full kiosk, recommended for shared floor devices):** truly
  prevents leaving the app. Provision once, on a **freshly reset device with no
  Google/other accounts added**:

  ```powershell
  adb install -r app-debug.apk
  adb shell dpm set-device-owner com.kingone.wms/com.kingone.wms.KioskDeviceAdminReceiver
  ```

  After this, enabling kiosk gives a true lockdown (no exit). To remove device
  owner later: disable kiosk in the app, then `adb shell dpm remove-active-admin com.kingone.wms/com.kingone.wms.KioskDeviceAdminReceiver`
  (or factory reset).

> If you forget the supervisor password: clear the app's storage (Settings → Apps →
> King One WMS → Storage → Clear) — this resets the password, server address, and
> kiosk flag. On a device-owner kiosk, do this from ADB or after removing device owner.

## Notes

- This is a LAN/HTTP build (`usesCleartextTraffic="true"`). For use over the
  internet, host the backend behind HTTPS and point the app at the `https://` URL.
- If you version this project, push to the **King Living organisation GitHub
  repo**, not a personal account.
