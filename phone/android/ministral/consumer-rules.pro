# ministral_jni.cpp looks up these classes and members by name.
# Without these rules, R8 renaming them makes the app crash at the first JNI call.
-keep class com.mistral.london.ministral.MinistralNative { native <methods>; }
-keep class com.mistral.london.ministral.TokenSink { public void onBytes(byte[]); }
-keep class com.mistral.london.ministral.NativeResult { <init>(); <fields>; }
-keep class com.mistral.london.ministral.EngineException { <init>(java.lang.String); }
-keepclasseswithmembernames,includedescriptorclasses class * { native <methods>; }
