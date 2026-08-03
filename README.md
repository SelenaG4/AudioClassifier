# AudioClassifier

A React Native app that captures **raw PCM audio** through a **custom Java native module**, classifies sounds in real time with an on-device **TensorFlow Lite** model (YAMNet), and exports recordings as playable WAV files.

Audio never touches the JavaScript thread. Capture, resampling, and inference all run in Java on dedicated threads; only lightweight results cross the bridge to the UI.

---

## Why a native module?

React Native alone cannot handle continuous audio buffering. `AudioRecord.read()` blocks until a buffer fills, and dropped samples mean corrupted audio — so the capture loop lives entirely in Java on its own thread.

```
┌──────────────────────┐         ┌──────────────────────────────────────┐
│  JavaScript (React)  │         │        Java Native Modules           │
│                      │         │                                      │
│  initialize() ───────┼────────▶│  AudioRecord setup + TFLite load     │
│  start()      ───────┼────────▶│  Capture thread starts               │
│  stop()       ───────┼────────▶│  Thread joins, WAV written           │
│                      │         │                                      │
│  onAmplitude    ◀────┼─────────┤  Peak level, ~20×/sec                │
│  onClassification ◀──┼─────────┤  YAMNet label + score, ~1×/sec       │
└──────────────────────┘         └──────────────────────────────────────┘
        Promises                            @ReactMethod
```

---

## Features

- **Raw microphone capture** via `android.media.AudioRecord` — 44,100 Hz, mono, 16-bit PCM
- **On-device sound classification** with YAMNet, covering 521 AudioSet event categories
- **Real-time resampling** from 44.1 kHz capture to the 16 kHz the model requires
- **Non-blocking inference** — classification runs on a separate thread so it never stalls the audio read
- **WAV export** — headerless PCM wrapped with a hand-built 44-byte RIFF header
- **Live waveform and level meter** driven by amplitude events from Java

---

## Screenshots

| Idle | Recording | Classifying |
|---|---|---|
| ![Idle](screenshots/idle.png) | ![Recording](screenshots/recording1.png) | ![Classifying](screenshots/recording2.png) |

---

## Tech stack

| Layer | Technology |
|---|---|
| UI | React Native 0.86, TypeScript |
| Bridge | `ReactContextBaseJavaModule`, `@ReactMethod`, `DeviceEventEmitter` |
| Audio | Java, `android.media.AudioRecord` |
| ML | TensorFlow Lite Task Audio 0.4.4, YAMNet |
| Build | Gradle, Android SDK, JDK 17 |

---

## Project structure

| File | Responsibility |
|---|---|
| `App.tsx` | React UI, permissions, native calls, waveform, classification display |
| `android/.../AudioCaptureModule.java` | Capture engine, buffer loop, resampling, WAV writer |
| `android/.../AudioClassifierModule.java` | TFLite model loading and inference |
| `android/.../AudioCapturePackage.java` | Registers both modules and wires them together |
| `android/app/src/main/assets/yamnet.tflite` | The classification model |

---

## The audio pipeline

1. **Permission** — JS requests `RECORD_AUDIO` via `PermissionsAndroid` before any native call.
2. **Initialization** — `getMinBufferSize()` returns the framework minimum; the buffer is oversized 4× for headroom. The TFLite model loads from assets and reports its required sample rate (16 kHz).
3. **Capture** — a background thread loops on `audioRecord.read()`, writing each buffer straight to a temporary `.pcm` file.
4. **Amplitude** — each buffer is scanned for peak level by combining little-endian byte pairs into 16-bit samples.
5. **Resampling** — samples are decimated from 44,100 Hz to 16,000 Hz using a fractional counter, normalized to −1…1, and accumulated into YAMNet's 15,600-sample window (≈0.975 s).
6. **Inference** — when a full window is ready it is cloned and handed to a worker thread, so the capture loop never waits on the model. The top-scoring label and confidence are emitted to JS.
7. **Export** — on stop, a `volatile` flag ends the loop, the thread is joined, and the PCM is converted to a standard WAV file.

---

## Key concepts demonstrated

- **React Native native modules** — exposing Java to JavaScript with `@ReactMethod` and Promises
- **Bridging real-time data** — high-frequency events to JS without blocking either thread
- **On-device ML** — loading a TFLite model from assets and running inference off the audio thread
- **Sample-rate conversion** — decimation between capture and model rates
- **Digital audio fundamentals** — sample rate, bit depth, channel config, PCM encoding
- **The WAV container format** — building the RIFF/`fmt `/`data` header by hand
- **Java concurrency** — `volatile` flags, `Thread.join()`, worker threads for inference

---

## Build & run

```bash
npm install
npx react-native run-android
```

Requires Node 22+, JDK 17, the Android SDK, and a **physical device** (emulator microphones are unreliable).

Recordings can be retrieved with:

```bash
adb pull /sdcard/Android/data/com.audioclassifier/files/ .
```

---

## Notes and limitations

- YAMNet is a general-purpose classifier trained on AudioSet. Short or ambiguous sounds often produce low-confidence or unexpected labels; sustained sounds like speech and music classify far more reliably.
- Only the single top label is currently shown. Displaying the top three would better reflect the model's uncertainty.
- File writing happens on the capture thread. A production design would hand buffers to a separate writer thread so disk I/O can never delay the audio read.

---

## Roadmap

- **SQLite** logging of classification events with timestamps
- **Top-N predictions** instead of a single label
- **FFT spectrum analyzer** for frequency-domain visualization
- **Foreground service** so capture and classification survive backgrounding

---

## License

MIT
