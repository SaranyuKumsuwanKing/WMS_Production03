package com.kingone.wms

import android.app.Application
import com.kingone.wms.data.AppContainer

class WmsApp : Application() {
    lateinit var container: AppContainer
        private set

    override fun onCreate() {
        super.onCreate()
        container = AppContainer(this)
    }
}
