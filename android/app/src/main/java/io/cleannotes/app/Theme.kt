package io.cleannotes.app

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

// From src/styles/tokens.css. Translucent tokens are pre-blended over --list, the note page's background.
private val Day = lightColorScheme(
    primary = Color(0xFFB5391B), // --accent
    onPrimary = Color(0xFFFFF9F5),
    primaryContainer = Color(0xFFEEDFD5), // --accent-soft
    onPrimaryContainer = Color(0xFFB5391B),
    secondaryContainer = Color(0xFFEEDFD5),
    onSecondaryContainer = Color(0xFF211E1A),
    background = Color(0xFFF4F1EA), // --list
    onBackground = Color(0xFF211E1A), // --ink
    surface = Color(0xFFF4F1EA),
    onSurface = Color(0xFF211E1A),
    onSurfaceVariant = Color(0xFF57514A), // --ink-2
    surfaceContainerLowest = Color(0xFFFFFEFB),
    surfaceContainerLow = Color(0xFFECE8DF), // --rail
    surfaceContainer = Color(0xFFFBF9F5), // --paper
    surfaceContainerHigh = Color(0xFFFFFEFB), // --raised
    surfaceContainerHighest = Color(0xFFFFFEFB),
    outline = Color(0xFFC6C3BC), // --line-strong
    outlineVariant = Color(0xFFDDDAD3), // --line
)

private val Night = darkColorScheme(
    primary = Color(0xFFF0805F),
    onPrimary = Color(0xFF1E0F09),
    primaryContainer = Color(0xFF382720),
    onPrimaryContainer = Color(0xFFF0805F),
    secondaryContainer = Color(0xFF382720),
    onSecondaryContainer = Color(0xFFECE7DD),
    background = Color(0xFF181715),
    onBackground = Color(0xFFECE7DD),
    surface = Color(0xFF181715),
    onSurface = Color(0xFFECE7DD),
    onSurfaceVariant = Color(0xFFB3AC9F),
    surfaceContainerLowest = Color(0xFF121110),
    surfaceContainerLow = Color(0xFF121110),
    surfaceContainer = Color(0xFF1E1C1A),
    surfaceContainerHigh = Color(0xFF2A2825),
    surfaceContainerHighest = Color(0xFF2A2825),
    outline = Color(0xFF42413D),
    outlineVariant = Color(0xFF2B2A27),
)

@Composable
fun CleanTheme(content: @Composable () -> Unit) =
    MaterialTheme(colorScheme = if (isSystemInDarkTheme()) Night else Day, content = content)
