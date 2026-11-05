plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.ksp)
}

android {
    namespace = "io.cleannotes.app"
    compileSdk = 36

    defaultConfig {
        applicationId = "io.cleannotes.app"
        minSdk = 26
        targetSdk = 36
        versionCode = 1
        versionName = "0.1.0"
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"))
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }

    buildFeatures {
        compose = true
    }
}

dependencies {
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.lifecycle.runtime.compose)
    implementation(libs.androidx.activity.compose)
    implementation(platform(libs.androidx.compose.bom))
    implementation(libs.androidx.ui)
    implementation(libs.androidx.material3)
    implementation(libs.androidx.material.icons.core)
    implementation(libs.androidx.room.runtime)
    implementation(libs.androidx.room.ktx)
    ksp(libs.androidx.room.compiler)
    implementation(libs.code.scanner)
    implementation(libs.androidx.webkit)
    testImplementation(libs.junit)
}

// The note view is the web app's Tiptap editor, built from ../src into assets/editor.
val buildEditor by tasks.registering(Exec::class) {
    val web = rootDir.parentFile
    workingDir = web
    commandLine("npm", "run", "build:android")
    inputs.dir(web.resolve("src"))
    inputs.files(web.resolve("android.html"), web.resolve("vite.config.ts"), web.resolve("package-lock.json"))
    outputs.dir(layout.projectDirectory.dir("src/main/assets/editor"))
}
tasks.named("preBuild") { dependsOn(buildEditor) }
