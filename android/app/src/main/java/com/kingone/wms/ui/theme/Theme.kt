package com.kingone.wms.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

// KING — luxurious black & white with a champagne-gold accent.
private val Ink = Color(0xFF141414)       // near-black (primary surfaces, buttons, icons)
private val Gold = Color(0xFFB8902F)      // champagne gold accent
private val GoldBright = Color(0xFFD4AF37) // brighter gold for dark mode
private val OffWhite = Color(0xFFFCFBF8)  // soft white background
private val WarmGray = Color(0xFFF1EFE9)  // warm light surface variant

private val LightColors = lightColorScheme(
    primary = Ink,
    onPrimary = Color.White,
    secondary = Gold,
    onSecondary = Color.White,
    tertiary = Gold,
    background = OffWhite,
    onBackground = Ink,
    surface = Color.White,
    onSurface = Ink,
    surfaceVariant = WarmGray,
    onSurfaceVariant = Color(0xFF5C5C5C),
    outline = Color(0xFFD8D4C8),
)

private val DarkColors = darkColorScheme(
    primary = GoldBright,
    onPrimary = Color(0xFF141414),
    secondary = GoldBright,
    onSecondary = Color(0xFF141414),
    tertiary = GoldBright,
    background = Color(0xFF0B0B0B),
    onBackground = Color(0xFFF2F2F2),
    surface = Color(0xFF161616),
    onSurface = Color(0xFFF2F2F2),
    surfaceVariant = Color(0xFF222222),
    onSurfaceVariant = Color(0xFFBDBDBD),
    outline = Color(0xFF3A3A3A),
)

@Composable
fun WmsTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = if (isSystemInDarkTheme()) DarkColors else LightColors,
        content = content,
    )
}
