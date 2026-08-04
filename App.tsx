import {initDatabase, logEvent, getRecentEvents, getEventCount, SoundEvent, clearEvents} from './db';
import React, {useEffect, useState, useRef} from 'react';
import {
  NativeModules,
  NativeEventEmitter,
  PermissionsAndroid,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import {SafeAreaView, SafeAreaProvider} from 'react-native-safe-area-context';
const {AudioCapture} = NativeModules;

const MAX_BARS = 60;

export default function App() {
  const [isRecording, setIsRecording] = useState(false);
  const [sound, setSound] = useState('—');
  const [confidence, setConfidence] = useState(0);
  const [status, setStatus] = useState('Requesting permission…');
  const [amplitude, setAmplitude] = useState(0);
  const [history, setHistory] = useState<number[]>([]);
  const [events, setEvents] = useState<SoundEvent[]>([]);
  const readyRef = useRef(false);
  const [totalEvents, setTotalEvents] = useState(0);

  // Ask for the mic, then initialize the native recorder
  useEffect(() => {
    async function setup() {
      if (Platform.OS !== 'android') return;
      
      try {
        initDatabase();
      } catch (e: any) {
        console.log('DB init failed: ' + e.message);
      }

      const granted = await PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
        {
          title: 'Microphone permission',
          message: 'This app needs the microphone to record audio.',
          buttonPositive: 'OK',
        },
      );

      if (granted !== PermissionsAndroid.RESULTS.GRANTED) {
        setStatus('Microphone permission denied');
        return;
      }

      try {
        await AudioCapture.initialize();
        try {
          await NativeModules.AudioClassifierModule.initialize();
          console.log('Classifier loaded');
        } catch (e: any) {
        console.log('Classifier failed: ' + e.message);
      }
        readyRef.current = true;
        setStatus('Ready');
      } catch (e: any) {
        setStatus('Init failed: ' + e.message);
      }
    }
    setup();
  }, []);

  // Listen for amplitude events pushed from Java
  useEffect(() => {
    const emitter = new NativeEventEmitter(AudioCapture);
    const sub = emitter.addListener('onAmplitude', event => {
      const amp = event.amplitude ?? 0;
      setAmplitude(amp);
      setHistory(prev => {
        const next = [...prev, amp];
        return next.length > MAX_BARS ? next.slice(-MAX_BARS) : next;
      });
    });
    return () => sub.remove();
  }, []);

  useEffect(() => {
    const emitter = new NativeEventEmitter(NativeModules.AudioClassifierModule);
    const sub = emitter.addListener('onClassification', event => {
      const label = event.label ?? '—';
      const score = event.score ?? 0;
      setSound(label);
      setConfidence(score);

      // Only log reasonably confident detections
      if (score >= 0.3) {
        try {
          logEvent(label, score);
        } catch (e: any) {
          console.log('Log failed: ' + e.message);
        }
      }
    });
    return () => sub.remove();
  }, []);


  const onPress = async () => {
    if (!readyRef.current) return;

    if (isRecording) {
      try {
        const path = await AudioCapture.stop();
        setIsRecording(false);
        const recent = getRecentEvents();
        setEvents(recent);
        setTotalEvents(getEventCount());
        setAmplitude(0);
        setStatus(path ? 'Saved: ' + path.split('/').pop() : 'Stopped');
      } catch (e: any) {
        setStatus('Stop failed: ' + e.message);
      }
    } else {
      try {
        setHistory([]);
        await AudioCapture.start();
        setIsRecording(true);
        setStatus('Recording…');
      } catch (e: any) {
        setStatus('Start failed: ' + e.message);
      }
    }
  };

return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.container}>
        <Text style={styles.title}>Raw Audio Recorder</Text>
        <Text style={styles.status}>{status}</Text>
        <Text style={styles.level}>Level: {(amplitude * 100).toFixed(0)}%</Text>

        <TouchableOpacity
          style={[styles.button, isRecording && styles.buttonRecording]}
          onPress={onPress}>
          <Text style={styles.buttonText}>
            {isRecording ? 'Stop' : 'Start Recording'}
          </Text>
        </TouchableOpacity>

        <Text style={styles.label}>Detected sound</Text>
        <Text style={styles.sound}>{sound}</Text>
        <Text style={styles.level}>
          Confidence: {(confidence * 100).toFixed(0)}%
        </Text>

        <Text style={styles.label}>Waveform</Text>
        <View style={styles.waveform}>
          {history.map((amp, i) => (
            <View
              key={i}
              style={[styles.bar, {height: Math.max(amp * 120, 2)}]}
            />
          ))}
        </View>

        <Text style={styles.label}>Recent detections ({totalEvents} total)</Text>
        {events.slice(0, 5).map(e => (
          <Text key={e.id} style={styles.eventRow}>
            {new Date(e.timestamp).toLocaleTimeString()} — {e.label} (
            {(e.score * 100).toFixed(0)}%)
          </Text>
        ))}
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  container: {flex: 1, backgroundColor: '#121212', padding: 20},
  title: {color: '#fff', fontSize: 24, fontWeight: '600', textAlign: 'center', marginTop: 20},
  status: {color: '#aaa', fontSize: 14, textAlign: 'center', marginTop: 12},
  level: {color: '#4CAF50', fontSize: 18, textAlign: 'center', marginTop: 8},
  sound: {color: '#FFC107', fontSize: 22, fontWeight: '600', textAlign: 'center', marginTop: 4},
  eventRow: {color: '#ccc', fontSize: 13, textAlign: 'center', marginTop: 2},
  button: {
    backgroundColor: '#2196F3',
    paddingVertical: 14,
    borderRadius: 8,
    marginTop: 24,
    alignSelf: 'center',
    paddingHorizontal: 32,
  },
  buttonRecording: {backgroundColor: '#E53935'},
  buttonText: {color: '#fff', fontSize: 16, fontWeight: '600'},
  label: {color: '#888', fontSize: 12, textAlign: 'center', marginTop: 30},
  waveform: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 140,
    backgroundColor: '#1E1E1E',
    borderRadius: 6,
    marginTop: 8,
    paddingHorizontal: 4,
  },
  bar: {flex: 1, backgroundColor: '#4CAF50', marginHorizontal: 1, borderRadius: 1},
});