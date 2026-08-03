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
  const [status, setStatus] = useState('Requesting permission…');
  const [amplitude, setAmplitude] = useState(0);
  const [history, setHistory] = useState<number[]>([]);
  const readyRef = useRef(false);

  // Ask for the mic, then initialize the native recorder
  useEffect(() => {
    async function setup() {
      if (Platform.OS !== 'android') return;

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

  const onPress = async () => {
    if (!readyRef.current) return;

    if (isRecording) {
      try {
        const path = await AudioCapture.stop();
        setIsRecording(false);
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

      <Text style={styles.label}>Waveform</Text>
      <View style={styles.waveform}>
        {history.map((amp, i) => (
          <View
            key={i}
            style={[styles.bar, {height: Math.max(amp * 120, 2)}]}
          />
        ))}
      </View>
    </SafeAreaView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  container: {flex: 1, backgroundColor: '#121212', padding: 20},
  title: {color: '#fff', fontSize: 24, fontWeight: '600', textAlign: 'center', marginTop: 20},
  status: {color: '#aaa', fontSize: 14, textAlign: 'center', marginTop: 12},
  level: {color: '#4CAF50', fontSize: 18, textAlign: 'center', marginTop: 8},
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