import {
  initDatabase,
  logEvent,
  getRecentEvents,
  getEventCount,
  updateEventLabel,
  deleteEvent,
  clearEvents,
  SoundEvent,
} from './db';
import React, {useEffect, useState, useRef} from 'react';
import {
  Alert,
  Modal,
  NativeModules,
  NativeEventEmitter,
  PermissionsAndroid,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import {SafeAreaView, SafeAreaProvider} from 'react-native-safe-area-context';
const {AudioCapture} = NativeModules;

const MAX_BARS = 60;

type Prediction = {label: string; score: number};

export default function App() {
  const [isRecording, setIsRecording] = useState(false);
  const [sound, setSound] = useState('—');
  const [confidence, setConfidence] = useState(0);
  const [status, setStatus] = useState('Requesting permission…');
  const [amplitude, setAmplitude] = useState(0);
  const [history, setHistory] = useState<number[]>([]);
  const [events, setEvents] = useState<SoundEvent[]>([]);
  const [totalEvents, setTotalEvents] = useState(0);
  const [topPredictions, setTopPredictions] = useState<Prediction[]>([]);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editLabelText, setEditLabelText] = useState('');
  const readyRef = useRef(false);

  const refreshEvents = () => {
    setEvents(getRecentEvents());
    setTotalEvents(getEventCount());
  };

  // Ask for the mic, then initialize the native recorder
  useEffect(() => {
    async function setup() {
      if (Platform.OS !== 'android') return;

      try {
        initDatabase();
        refreshEvents(); // show persisted history immediately on launch
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
      setTopPredictions(event.top ?? []);

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
        refreshEvents();
        setAmplitude(0);
        setTopPredictions([]);
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

  // --- Update ---
  const openEditModal = (event: SoundEvent) => {
    setEditingId(event.id);
    setEditLabelText(event.label);
  };

  const closeEditModal = () => {
    setEditingId(null);
    setEditLabelText('');
  };

  const saveEdit = () => {
    if (editingId === null) return;
    const trimmed = editLabelText.trim();
    if (trimmed.length === 0) return;
    try {
      updateEventLabel(editingId, trimmed);
      refreshEvents();
    } catch (e: any) {
      console.log('Update failed: ' + e.message);
    }
    closeEditModal();
  };

  // --- Delete ---
  const handleDelete = (id: number) => {
    try {
      deleteEvent(id);
      refreshEvents();
    } catch (e: any) {
      console.log('Delete failed: ' + e.message);
    }
  };

  const handleClearAll = () => {
    Alert.alert(
      'Clear all history?',
      'This deletes every logged detection. This cannot be undone.',
      [
        {text: 'Cancel', style: 'cancel'},
        {
          text: 'Clear all',
          style: 'destructive',
          onPress: () => {
            try {
              clearEvents();
              refreshEvents();
            } catch (e: any) {
              console.log('Clear failed: ' + e.message);
            }
          },
        },
      ],
    );
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

        <Text style={styles.label}>Detected sounds</Text>
        {topPredictions.length === 0 ? (
          <Text style={styles.sound}>—</Text>
        ) : (
          topPredictions.map((p, i) => (
            <View key={i} style={styles.predRow}>
              <Text style={[styles.predLabel, i === 0 && styles.predTop]}>
                {p.label}
              </Text>
              <View style={styles.predBarTrack}>
                <View
                  style={[
                    styles.predBarFill,
                    {width: `${Math.max(p.score * 100, 1)}%`},
                    i === 0 && styles.predBarTopFill,
                  ]}
                />
              </View>
              <Text style={styles.predScore}>
                {(p.score * 100).toFixed(0)}%
              </Text>
            </View>
          ))
        )}

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
          <View key={e.id} style={styles.eventRow}>
            <Text style={styles.eventText}>
              {new Date(e.timestamp).toLocaleTimeString()} — {e.label} (
              {(e.score * 100).toFixed(0)}%)
            </Text>
            <View style={styles.eventActions}>
              <TouchableOpacity onPress={() => openEditModal(e)} hitSlop={8}>
                <Text style={styles.actionIcon}>✎</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => handleDelete(e.id)} hitSlop={8}>
                <Text style={styles.actionIcon}>🗑</Text>
              </TouchableOpacity>
            </View>
          </View>
        ))}

        {totalEvents > 0 && (
          <TouchableOpacity style={styles.clearButton} onPress={handleClearAll}>
            <Text style={styles.clearButtonText}>Clear all history</Text>
          </TouchableOpacity>
        )}

        <Modal
          visible={editingId !== null}
          transparent
          animationType="fade"
          onRequestClose={closeEditModal}>
          <View style={styles.modalOverlay}>
            <View style={styles.modalCard}>
              <Text style={styles.modalTitle}>Correct label</Text>
              <TextInput
                style={styles.modalInput}
                value={editLabelText}
                onChangeText={setEditLabelText}
                placeholder="Label"
                placeholderTextColor="#666"
                autoFocus
              />
              <View style={styles.modalButtons}>
                <TouchableOpacity
                  style={styles.modalButtonCancel}
                  onPress={closeEditModal}>
                  <Text style={styles.modalButtonText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.modalButtonSave}
                  onPress={saveEdit}>
                  <Text style={styles.modalButtonText}>Save</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>
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
  predRow: {flexDirection: 'row', alignItems: 'center', marginTop: 6},
  predLabel: {color: '#aaa', fontSize: 14, width: 110},
  predTop: {color: '#FFC107', fontWeight: '600'},
  predBarTrack: {
    flex: 1,
    height: 10,
    backgroundColor: '#2A2A2A',
    borderRadius: 5,
    overflow: 'hidden',
  },
  predBarFill: {height: 10, backgroundColor: '#666', borderRadius: 5},
  predBarTopFill: {backgroundColor: '#FFC107'},
  predScore: {color: '#aaa', fontSize: 13, width: 45, textAlign: 'right'},
  eventRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 4,
    paddingVertical: 2,
  },
  eventText: {color: '#ccc', fontSize: 12, flex: 1},
  eventActions: {flexDirection: 'row', gap: 12, marginLeft: 8},
  actionIcon: {fontSize: 14, color: '#8B96A8'},
  clearButton: {
    marginTop: 16,
    alignSelf: 'center',
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  clearButtonText: {color: '#E53935', fontSize: 12, fontWeight: '600'},
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalCard: {
    backgroundColor: '#1E1E1E',
    borderRadius: 12,
    padding: 20,
    width: '80%',
  },
  modalTitle: {color: '#fff', fontSize: 16, fontWeight: '600', marginBottom: 12},
  modalInput: {
    backgroundColor: '#2A2A2A',
    color: '#fff',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
  },
  modalButtons: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginTop: 16,
    gap: 12,
  },
  modalButtonCancel: {paddingVertical: 8, paddingHorizontal: 14},
  modalButtonSave: {
    backgroundColor: '#2196F3',
    borderRadius: 6,
    paddingVertical: 8,
    paddingHorizontal: 14,
  },
  modalButtonText: {color: '#fff', fontSize: 14, fontWeight: '600'},
});