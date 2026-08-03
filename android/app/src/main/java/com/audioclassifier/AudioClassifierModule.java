package com.audioclassifier;

import android.util.Log;

import androidx.annotation.NonNull;

import com.facebook.react.bridge.Arguments;
import com.facebook.react.bridge.Promise;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;
import com.facebook.react.bridge.WritableMap;
import com.facebook.react.modules.core.DeviceEventManagerModule;

import org.tensorflow.lite.support.audio.TensorAudio;
import org.tensorflow.lite.support.label.Category;
import org.tensorflow.lite.task.audio.classifier.AudioClassifier;
import org.tensorflow.lite.task.audio.classifier.Classifications;

import java.util.List;

public class AudioClassifierModule extends ReactContextBaseJavaModule {

    private static final String TAG = "AudioClassifierModule";
    private static final String MODEL_FILE = "yamnet.tflite";

    private final ReactApplicationContext reactContext;
    private AudioClassifier classifier;
    private TensorAudio tensorAudio;

    public AudioClassifierModule(ReactApplicationContext context) {
        super(context);
        this.reactContext = context;
    }

    @NonNull
    @Override
    public String getName() {
        return "AudioClassifierModule";
    }

    @ReactMethod
    public void initialize(Promise promise) {
        try {
            classifier = AudioClassifier.createFromFile(reactContext, MODEL_FILE);
            tensorAudio = classifier.createInputTensorAudio();
            int rate = classifier.getRequiredTensorAudioFormat().getSampleRate();
            Log.i(TAG, "Classifier loaded. Required sample rate: " + rate);
            promise.resolve(rate);
        } catch (Exception e) {
            Log.e(TAG, "Failed to load model", e);
            promise.reject("MODEL_ERROR", e.getMessage());
        }
    }

    /** Classify a chunk of normalized PCM samples (-1..1). */
    public void classifyBuffer(float[] samples) {
        if (classifier == null || tensorAudio == null) return;

        try {
            tensorAudio.load(samples);
            List<Classifications> results = classifier.classify(tensorAudio);
            if (results.isEmpty()) return;

            List<Category> categories = results.get(0).getCategories();
            if (categories.isEmpty()) return;

            Category best = categories.get(0);
            for (Category c : categories) {
                if (c.getScore() > best.getScore()) best = c;
            }

            WritableMap params = Arguments.createMap();
            params.putString("label", best.getLabel());
            params.putDouble("score", best.getScore());

            reactContext
                    .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter.class)
                    .emit("onClassification", params);
        } catch (Exception e) {
            Log.e(TAG, "Classification failed", e);
        }
    }

    public int getRequiredSampleRate() {
        if (classifier == null) return 16000;
        return classifier.getRequiredTensorAudioFormat().getSampleRate();
    }

    @ReactMethod
    public void addListener(String eventName) { }

    @ReactMethod
    public void removeListeners(Integer count) { }
}