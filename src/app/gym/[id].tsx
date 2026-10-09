import { Ionicons } from '@expo/vector-icons';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { supabase } from '../../services/supabase';

const theme = {
  background: '#000000',
  surface: '#121212',
  surfaceHighlight: '#1A1A1A',
  primary: '#D4AF37',
  success: '#4CAF50',
  textLight: '#FFFFFF',
  textMuted: '#888888',
  cardBorder: '#2A2A2A',
};

interface GymDetails {
  id: string;
  name: string;
  location: string;
  address: string;
  phone: string;
}

export default function GymDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();

  const [gym, setGym] = useState<GymDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [isScanning, setIsScanning] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const [permission, requestPermission] = useCameraPermissions();

  const [sessionState, setSessionState] = useState<'idle' | 'checked-in'>('idle');
  const [checkInTime, setCheckInTime] = useState<Date | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [activeVisitId, setActiveVisitId] = useState<string | null>(null);

  useEffect(() => {
    let interval: ReturnType<typeof setInterval>;
    if (sessionState === 'checked-in' && checkInTime) {
      interval = setInterval(() => {
        setElapsedSeconds(Math.floor((new Date().getTime() - checkInTime.getTime()) / 1000));
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [sessionState, checkInTime]);

  useEffect(() => {
    const fetchGymDetails = async () => {
      if (!id) return;
      try {
        const { data, error } = await supabase.from('gyms').select('*').eq('id', id).single();
        if (error) throw error;
        setGym(data);
      } catch (error) {
        console.error('Error fetching gym details:', error);
      } finally {
        setLoading(false);
      }
    };
    fetchGymDetails();
  }, [id]);

  const handleScanPress = async () => {
    if (!permission?.granted) {
      const resp = await requestPermission();
      if (!resp.granted) {
        Alert.alert('Permission Required', 'FitVault needs camera access.');
        return;
      }
    }
    setIsScanning(true);
  };

  const handleBarcodeScanned = async ({ data }: { data: string }) => {
    if (isVerifying) return;
    setIsVerifying(true);
    setIsScanning(false);

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        Alert.alert('Error', 'User not authenticated.');
        return;
      }

      const { data: qrRecord } = await supabase
        .from('gym_qr_codes')
        .select('id')
        .eq('gym_id', id)
        .eq('code', data)
        .single();

      if (!qrRecord) {
        Alert.alert('Error', 'Invalid QR code.');
        return;
      }

      if (sessionState === 'idle') {
        // --- CHECK IN LOGIC ---
        const { data: visit, error } = await supabase
          .from('gym_visits')
          .insert([{ user_id: user.id, gym_id: id, check_in: new Date().toISOString() }])
          .select('id')
          .single();

        if (error) throw error;
        setActiveVisitId(visit.id);
        setCheckInTime(new Date());
        setSessionState('checked-in');
        Alert.alert('Checked In', 'Session started!');
      } else {
        // --- CHECK OUT & STREAK LOGIC ---
        const now = new Date();
        const diffMs = now.getTime() - checkInTime!.getTime();
        
        if (diffMs < 30000) {
          Alert.alert('Too short', 'Stay at least 30 seconds!');
        } else {
          // 1. Execute DB updates and capture response errors individually
          const [visitRes, pointsRes, streakRes] = await Promise.all([
            supabase.from('gym_visits').update({
              check_out: now.toISOString(),
              duration_minutes: Math.floor(diffMs / 60000),
              points_earned: 50
            }).eq('id', activeVisitId),
            
            supabase.rpc('increment_points', { p_user_id: user.id, p_amount: 50 }),
            
            supabase.rpc('process_gym_check_in', { p_user_id: user.id })
          ]);

          if (visitRes.error) console.error('Visit Update Error:', visitRes.error);
          if (pointsRes.error) console.error('Points RPC Error:', pointsRes.error);
          if (streakRes.error) console.error('Streak RPC Error:', streakRes.error);

          // 2. Fetch updated streak using maybeSingle() to avoid exceptions on empty tables
          const { data: streakData, error: fetchStreakError } = await supabase
            .from('user_streaks')
            .select('current_streak_count')
            .eq('user_id', user.id)
            .maybeSingle();

          if (fetchStreakError) {
            console.error('Fetch Streak Error:', fetchStreakError);
          }

          const newStreak = streakData?.current_streak_count ?? 0;

          setSessionState('idle');
          Alert.alert('Session Complete', `Earned 50 HP! Streak is now ${newStreak} days.`);
        }
      }
    } catch (e) {
      console.error('Checkout Transaction Error:', e);
      Alert.alert('Error', 'Could not process transaction.');
    } finally {
      setIsVerifying(false);
    }
  };

  const formatTime = (totalSeconds: number) => {
    const mins = Math.floor(totalSeconds / 60);
    const secs = totalSeconds % 60;
    return `${mins < 10 ? '0' : ''}${mins}:${secs < 10 ? '0' : ''}${secs}`;
  };

  if (loading || isVerifying) {
    return (
      <View style={styles.loaderContainer}>
        <ActivityIndicator size="large" color={theme.primary} />
        {isVerifying && <Text style={{ color: theme.primary, marginTop: 16 }}>Verifying...</Text>}
      </View>
    );
  }

  if (!gym) return null;

  if (isScanning) {
    return (
      <View style={styles.cameraContainer}>
        <CameraView
          style={StyleSheet.absoluteFillObject}
          facing="back"
          barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
          onBarcodeScanned={handleBarcodeScanned}
        />
        <View style={styles.overlayContainer}>
          <TouchableOpacity style={styles.cancelScanButton} onPress={() => setIsScanning(false)}>
            <Text style={styles.cancelScanText}>CANCEL</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={24} color={theme.textLight} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>GYM DETAILS</Text>
        <View style={{ width: 24 }} />
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.infoCard}>
          <Ionicons name="barbell" size={40} color={theme.primary} />
          <Text style={styles.gymName}>{gym.name}</Text>
        </View>
        <View style={styles.actionSection}>
          {sessionState === 'idle' ? (
            <TouchableOpacity style={styles.scanButton} onPress={handleScanPress}>
              <Text style={styles.scanButtonText}>SCAN TO CHECK IN</Text>
            </TouchableOpacity>
          ) : (
            <View style={styles.activeSessionCard}>
              <Text style={styles.timerText}>{formatTime(elapsedSeconds)}</Text>
              <TouchableOpacity 
                style={[
                  styles.scanButton, 
                  { backgroundColor: elapsedSeconds >= 30 ? theme.success : theme.surfaceHighlight }
                ]} 
                onPress={handleScanPress}
              >
                <Text style={styles.scanButtonText}>SCAN TO CHECK OUT</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.background },
  loaderContainer: { flex: 1, backgroundColor: theme.background, justifyContent: 'center', alignItems: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: 10, paddingBottom: 20 },
  backButton: { padding: 8, marginLeft: -8 },
  headerTitle: { color: theme.textLight, fontSize: 16, fontWeight: '700', letterSpacing: 1 },
  content: { paddingHorizontal: 20, paddingBottom: 40 },
  infoCard: { backgroundColor: theme.surface, borderRadius: 16, padding: 24, alignItems: 'center', borderWidth: 1, borderColor: theme.cardBorder, marginTop: 20 },
  iconCircle: { width: 80, height: 80, borderRadius: 40, backgroundColor: theme.surfaceHighlight, justifyContent: 'center', alignItems: 'center', marginBottom: 16, borderWidth: 2, borderColor: 'rgba(212, 175, 55, 0.3)' },
  gymName: { color: theme.textLight, fontSize: 24, fontWeight: '800', textAlign: 'center', marginBottom: 4 },
  gymLocation: { color: theme.primary, fontSize: 14, fontWeight: '600', letterSpacing: 1, textTransform: 'uppercase' },
  divider: { width: '100%', height: 1, backgroundColor: theme.cardBorder, marginVertical: 24 },
  detailRow: { flexDirection: 'row', alignItems: 'center', width: '100%', marginBottom: 16 },
  detailText: { color: theme.textMuted, fontSize: 15, marginLeft: 12, flex: 1 },
  actionSection: { marginTop: 40, alignItems: 'center' },
  actionInstruction: { color: theme.textMuted, textAlign: 'center', fontSize: 14, lineHeight: 22, marginBottom: 20, paddingHorizontal: 10 },
  scanButton: { backgroundColor: theme.primary, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', width: '100%', paddingVertical: 18, borderRadius: 12 },
  scanButtonText: { color: '#000000', fontSize: 16, fontWeight: '800', letterSpacing: 1 },
  activeSessionCard: { width: '100%', alignItems: 'center', padding: 20, backgroundColor: theme.surfaceHighlight, borderRadius: 12, marginBottom: 20, borderWidth: 1, borderColor: theme.cardBorder },
  activeSessionTitle: { color: theme.textLight, fontSize: 12, fontWeight: '700', letterSpacing: 2, marginBottom: 10 },
  timerText: { fontSize: 48, fontWeight: '800', marginBottom: 10, fontVariant: ['tabular-nums'] },
  cameraContainer: { flex: 1, backgroundColor: '#000' },
  overlayContainer: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', padding: 20 },
  overlayText: { color: '#FFF', fontSize: 16, fontWeight: '600', textAlign: 'center', marginBottom: 30 },
  scanTargetBox: { width: 250, height: 250, borderWidth: 3, borderColor: theme.primary, borderRadius: 16, backgroundColor: 'transparent', marginBottom: 40 },
  cancelScanButton: { backgroundColor: 'rgba(255,255,255,0.2)', paddingVertical: 14, paddingHorizontal: 32, borderRadius: 8, borderWidth: 1, borderColor: 'rgba(255,255,255,0.3)' },
  cancelScanText: { color: '#FFF', fontSize: 14, fontWeight: '700', letterSpacing: 1 }
});