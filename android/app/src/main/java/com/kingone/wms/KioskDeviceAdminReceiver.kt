package com.kingone.wms

import android.app.admin.DeviceAdminReceiver

/**
 * Lets the app be provisioned as Device Owner (via ADB) for a full kiosk
 * lockdown. Without device-owner, kiosk falls back to screen pinning.
 *
 * Provision (device must have no accounts, fresh setup):
 *   adb shell dpm set-device-owner com.kingone.wms/com.kingone.wms.KioskDeviceAdminReceiver
 */
class KioskDeviceAdminReceiver : DeviceAdminReceiver()
