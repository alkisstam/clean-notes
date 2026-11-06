# ML Kit's code scanner reaches these by reflection; R8 renaming them crashes the scanner at launch.
-keep class com.google.mlkit.** { *; }
-keep class com.google.android.gms.internal.mlkit_code_scanner.** { *; }
