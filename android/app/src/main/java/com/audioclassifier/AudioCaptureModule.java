package com.audioclassifier;

import android.media.AudioFormat;
import android.media.AudioRecord;
import android.media.MediaRecorder;
import android.util.Log;

import androidx.annotation.NonNull;

import com.facebook.react.bridge.Promise;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;
import com.facebook.react.bridge.Arguments;
import com.facebook.react.bridge.WritableMap;
import com.facebook.react.modules.core.DeviceEventManagerModule;

import java.io.BufferedOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

public class AudioCaptureModule extends ReactContextBaseJavaModule {

    private static final String TAG = "AudioCaptureModule";
    private static final int SAMPLE_RATE_HZ = 44100;
    private static final int CHANNEL_CONFIG = AudioFormat.CHANNEL_IN_MONO;
    private static final int AUDIO_FORMAT = AudioFormat.ENCODING_PCM_16BIT;
    private static final float MAX_16BIT = 32767f;

    private final ReactApplicationContext reactContext;

    private AudioRecord audioRecord;
    private int bufferSizeInBytes;
    private volatile boolean isRecording = false;
    private Thread recordingThread;

    private File pcmFile;
    private BufferedOutputStream pcmStream;
    // --- Classification feed ---
    private static final int TARGET_RATE = 16000;
    private static final int YAMNET_WINDOW = 15600;
    private float[] classifierBuffer = new float[YAMNET_WINDOW];
    private int classifierIndex = 0;
    private double resampleCounter = 0;
    private final double resampleStep = (double) TARGET_RATE / SAMPLE_RATE_HZ;
    private AudioClassifierModule classifierModule;
    private volatile boolean classifying = false;

    public void setClassifierModule(AudioClassifierModule module) {
        this.classifierModule = module;
    }

    public AudioCaptureModule(ReactApplicationContext context) {
        super(context);
        this.reactContext = context;
    }

    @NonNull
    @Override
    public String getName() {
        return "AudioCapture";   // the name JavaScript uses
    }

    @ReactMethod
    public void initialize(Promise promise) {
        try {
            int minBufferSize = AudioRecord.getMinBufferSize(
                    SAMPLE_RATE_HZ, CHANNEL_CONFIG, AUDIO_FORMAT);

            if (minBufferSize == AudioRecord.ERROR
                    || minBufferSize == AudioRecord.ERROR_BAD_VALUE) {
                promise.reject("BAD_BUFFER", "Invalid buffer size: " + minBufferSize);
                return;
            }

            bufferSizeInBytes = minBufferSize * 4;

            audioRecord = new AudioRecord(
                    MediaRecorder.AudioSource.MIC,
                    SAMPLE_RATE_HZ, CHANNEL_CONFIG, AUDIO_FORMAT,
                    bufferSizeInBytes);

            if (audioRecord.getState() == AudioRecord.STATE_INITIALIZED) {
                Log.i(TAG, "AudioRecord ready — " + SAMPLE_RATE_HZ
                        + "Hz, buffer=" + bufferSizeInBytes);
                promise.resolve(true);
            } else {
                release();
                promise.reject("INIT_FAILED", "AudioRecord failed to initialize");
            }
        } catch (SecurityException e) {
            promise.reject("NO_PERMISSION", "RECORD_AUDIO permission not granted");
        } catch (Exception e) {
            promise.reject("ERROR", e.getMessage());
        }
    }

    @ReactMethod
    public void start(Promise promise) {
        if (audioRecord == null
                || audioRecord.getState() != AudioRecord.STATE_INITIALIZED) {
            promise.reject("NOT_READY", "Recorder not initialized");
            return;
        }
        if (isRecording) {
            promise.resolve(false);
            return;
        }

        try {
            File dir = reactContext.getExternalFilesDir(null);
            pcmFile = new File(dir, "recording_temp.pcm");
            pcmStream = new BufferedOutputStream(new FileOutputStream(pcmFile));
        } catch (IOException e) {
            promise.reject("FILE_ERROR", e.getMessage());
            return;
        }

        audioRecord.startRecording();
        isRecording = true;

        recordingThread = new Thread(new Runnable() {
            @Override
            public void run() {
                byte[] buffer = new byte[bufferSizeInBytes];
                Log.i(TAG, "Capture loop started");

                while (isRecording) {
                    int bytesRead = audioRecord.read(buffer, 0, buffer.length);
                    if (bytesRead > 0) {
                        try {
                            pcmStream.write(buffer, 0, bytesRead);
                        } catch (IOException e) {
                            Log.e(TAG, "Write failed", e);
                        }

                        // Peak amplitude from little-endian 16-bit samples
                        int peak = 0;
                        for (int i = 0; i + 1 < bytesRead; i += 2) {
                            short sample = (short) ((buffer[i] & 0xFF)
                                    | (buffer[i + 1] << 8));
                            int level = Math.abs(sample);
                            if (level > peak) peak = level;
                        }
                        sendAmplitudeToJs(peak / MAX_16BIT);
                        // Feed the classifier: decimate 44100 -> 16000
                        if (classifierModule != null) {
                            for (int i = 0; i + 1 < bytesRead; i += 2) {
                                short s = (short) ((buffer[i] & 0xFF) | (buffer[i + 1] << 8));
                                resampleCounter += resampleStep;
                                if (resampleCounter >= 1.0) {
                                    resampleCounter -= 1.0;
                                    if (classifierIndex < YAMNET_WINDOW) {
                                        classifierBuffer[classifierIndex++] = s / MAX_16BIT;
                                    }
                                }
                            }

                            if (classifierIndex >= YAMNET_WINDOW && !classifying) {
                                final float[] snapshot = classifierBuffer.clone();
                                classifierIndex = 0;
                                classifying = true;
                                new Thread(new Runnable() {
                                    @Override
                                    public void run() {
                                        classifierModule.classifyBuffer(snapshot);
                                        classifying = false;
                                    }
                                }).start();
                                classifierIndex = 0;
                                resampleCounter = 0;
                            }
                        }
                    }
                }
                Log.i(TAG, "Capture loop stopped");
            }
        });
        recordingThread.start();
        promise.resolve(true);
    }

    @ReactMethod
    public void stop(Promise promise) {
        if (!isRecording) {
            promise.resolve(null);
            return;
        }

        isRecording = false;
        try {
            if (recordingThread != null) recordingThread.join();
        } catch (InterruptedException ignored) { }
        recordingThread = null;

        audioRecord.stop();

        try {
            pcmStream.flush();
            pcmStream.close();
        } catch (IOException ignored) { }
        pcmStream = null;

        String stamp = new SimpleDateFormat("yyyyMMdd_HHmmss", Locale.US)
                .format(new Date());
        File wav = new File(pcmFile.getParentFile(), "recording_" + stamp + ".wav");

        try {
            pcmToWav(pcmFile, wav);
            pcmFile.delete();
            Log.i(TAG, "Saved WAV: " + wav.getAbsolutePath());
            promise.resolve(wav.getAbsolutePath());
        } catch (IOException e) {
            promise.reject("WAV_ERROR", e.getMessage());
        } finally {
            pcmFile = null;
        }
    }

    @ReactMethod
    public void release(Promise promise) {
        release();
        promise.resolve(true);
    }

    private void release() {
        isRecording = false;
        if (audioRecord != null) {
            audioRecord.release();
            audioRecord = null;
        }
    }

    // Required for NativeEventEmitter on the JS side
    @ReactMethod
    public void addListener(String eventName) { }

    @ReactMethod
    public void removeListeners(Integer count) { }

    private void sendAmplitudeToJs(float amplitude) {
        WritableMap params = Arguments.createMap();
        params.putDouble("amplitude", amplitude);
        reactContext
                .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter.class)
                .emit("onAmplitude", params);
    }

    // Raw PCM has no header — prepend a 44-byte WAV header
    private void pcmToWav(File pcm, File wav) throws IOException {
        int pcmSize = (int) pcm.length();
        int channels = 1;
        int bitsPerSample = 16;
        int byteRate = SAMPLE_RATE_HZ * channels * bitsPerSample / 8;

        FileInputStream in = new FileInputStream(pcm);
        FileOutputStream out = new FileOutputStream(wav);
        try {
            byte[] header = new byte[44];
            header[0] = 'R'; header[1] = 'I'; header[2] = 'F'; header[3] = 'F';
            writeIntLE(header, 4, pcmSize + 36);
            header[8] = 'W'; header[9] = 'A'; header[10] = 'V'; header[11] = 'E';
            header[12] = 'f'; header[13] = 'm'; header[14] = 't'; header[15] = ' ';
            writeIntLE(header, 16, 16);
            writeShortLE(header, 20, 1);
            writeShortLE(header, 22, channels);
            writeIntLE(header, 24, SAMPLE_RATE_HZ);
            writeIntLE(header, 28, byteRate);
            writeShortLE(header, 32, channels * bitsPerSample / 8);
            writeShortLE(header, 34, bitsPerSample);
            header[36] = 'd'; header[37] = 'a'; header[38] = 't'; header[39] = 'a';
            writeIntLE(header, 40, pcmSize);
            out.write(header);

            byte[] buf = new byte[8192];
            int n;
            while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
        } finally {
            in.close();
            out.close();
        }
    }

    private void writeIntLE(byte[] b, int offset, int value) {
        b[offset] = (byte) (value & 0xFF);
        b[offset + 1] = (byte) ((value >> 8) & 0xFF);
        b[offset + 2] = (byte) ((value >> 16) & 0xFF);
        b[offset + 3] = (byte) ((value >> 24) & 0xFF);
    }

    private void writeShortLE(byte[] b, int offset, int value) {
        b[offset] = (byte) (value & 0xFF);
        b[offset + 1] = (byte) ((value >> 8) & 0xFF);
    }
}