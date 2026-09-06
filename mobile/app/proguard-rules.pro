# RoadAssist — R8 rules for the release build.
#
# The app carries no third-party libraries, so this file is short by design.
# Everything here exists because R8 cannot see the call site.

# The map WebView reaches Kotlin through @JavascriptInterface methods on two
# anonymous objects. Those methods are called by name from JavaScript, so R8
# has no reference to them and would otherwise strip or rename them — which
# fails at runtime as "AndroidAuth.token is not a function", not at build time.
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}

# Keep the exception type readable in crash reports; it is only ever
# constructed with a message R8 would happily inline away.
-keep class in.roadassist.app.ApiException { *; }

# Line numbers for real stack traces, without leaking original file names.
-keepattributes SourceFile,LineNumberTable
-renamesourcefileattribute SourceFile
