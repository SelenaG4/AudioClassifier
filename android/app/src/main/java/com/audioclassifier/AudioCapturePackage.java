package com.audioclassifier;

import androidx.annotation.NonNull;

import com.audioclassifier.AudioCaptureModule;
import com.facebook.react.ReactPackage;
import com.facebook.react.bridge.NativeModule;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.uimanager.ViewManager;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

public class AudioCapturePackage implements ReactPackage {

    @NonNull
    @Override
    public List<NativeModule> createNativeModules(@NonNull ReactApplicationContext context) {
        List<NativeModule> modules = new ArrayList<>();
        AudioCaptureModule capture = new AudioCaptureModule(context);
        AudioClassifierModule classifier = new AudioClassifierModule(context);
        capture.setClassifierModule(classifier);
        modules.add(capture);
        modules.add(classifier);
        return modules;
    }

    @NonNull
    @Override
    public List<ViewManager> createViewManagers(@NonNull ReactApplicationContext context) {
        return Collections.emptyList();
    }
}