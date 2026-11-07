package io.cleannotes.app

import androidx.compose.material.icons.filled.Check

import androidx.compose.material.icons.Icons

import androidx.compose.ui.text.ExperimentalTextApi
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.material3.Typography
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontVariation
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.PopupProperties

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

/** The resolved Settings choices, for the note page as well as the native screens. */
val LocalDark = staticCompositionLocalOf { false }
val LocalWebFonts = staticCompositionLocalOf { true }

// Commissioner is the web's UI font; one variable file covers every weight.
@OptIn(ExperimentalTextApi::class)
private fun commissioner(weight: Int) = Font(R.font.commissioner, FontWeight(weight), variationSettings = FontVariation.Settings(FontVariation.weight(weight)))
private val Commissioner = FontFamily(commissioner(400), commissioner(500), commissioner(600), commissioner(700))

private fun Typography.withFamily(f: FontFamily) = Typography(
    displayLarge = displayLarge.copy(fontFamily = f), displayMedium = displayMedium.copy(fontFamily = f), displaySmall = displaySmall.copy(fontFamily = f),
    headlineLarge = headlineLarge.copy(fontFamily = f), headlineMedium = headlineMedium.copy(fontFamily = f), headlineSmall = headlineSmall.copy(fontFamily = f),
    titleLarge = titleLarge.copy(fontFamily = f), titleMedium = titleMedium.copy(fontFamily = f), titleSmall = titleSmall.copy(fontFamily = f),
    bodyLarge = bodyLarge.copy(fontFamily = f), bodyMedium = bodyMedium.copy(fontFamily = f), bodySmall = bodySmall.copy(fontFamily = f),
    labelLarge = labelLarge.copy(fontFamily = f), labelMedium = labelMedium.copy(fontFamily = f), labelSmall = labelSmall.copy(fontFamily = f),
)

@Composable
fun CleanTheme(app: App, content: @Composable () -> Unit) {
    val theme by app.theme.collectAsState()
    val webFonts by app.webFonts.collectAsState()
    val dark = when (theme) {
        "dark" -> true
        "light" -> false
        else -> isSystemInDarkTheme()
    }
    CompositionLocalProvider(LocalDark provides dark, LocalWebFonts provides webFonts) {
        MaterialTheme(
            colorScheme = if (dark) Night else Day,
            typography = if (webFonts) Typography().withFamily(Commissioner) else Typography(),
            content = content,
        )
    }
}

val MenuShape = RoundedCornerShape(24.dp)

/** Every menu in the app: large rounded corners and roomy rows. */
@Composable
fun Menu(expanded: Boolean, onDismiss: () -> Unit, properties: PopupProperties = PopupProperties(focusable = true), content: @Composable ColumnScope.() -> Unit) =
    DropdownMenu(
        expanded, onDismiss, properties = properties, shape = MenuShape,
        containerColor = MaterialTheme.colorScheme.surfaceContainerHigh, content = content,
    )

@Composable
fun MenuItem(text: String, onClick: () -> Unit, icon: Int? = null, checked: Boolean = false) = DropdownMenuItem(
    text = { Text(text, style = MaterialTheme.typography.bodyLarge) },
    onClick = onClick,
    modifier = Modifier.heightIn(min = 52.dp),
    leadingIcon = icon?.let { { Icon(painterResource(it), null, Modifier.size(20.dp)) } },
    trailingIcon = if (checked) { { Icon(Icons.Default.Check, "Selected", Modifier.size(20.dp)) } } else null,
    contentPadding = PaddingValues(horizontal = 24.dp),
)
