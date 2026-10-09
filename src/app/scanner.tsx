import { Ionicons } from '@expo/vector-icons';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useRouter } from 'expo-router';
import React, { useRef, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  Vibration,
  View
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { supabase } from '../services/supabase';

const theme = {
  background: '#050505',
  surface: '#121212',
  primary: '#FF0A7A',
  success: '#10B981', 
  danger: '#EF4444',  
  textLight: '#FFFFFF',
  textMuted: '#8E8E93',
  border: '#2C2C2E',
};

type ScanResult = {
  status: 'success' | 'error';
  memberName: string;
  planName: string;
  message: string;
};

// Safe vibration fallback to prevent web API crashes/warnings
const safeVibrate = (pattern: number | number[]) => {
  if (Platform.OS === 'web') {
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      try {
        navigator.vibrate(pattern);
      } catch (e) {
        // Silently ignore vibration limits on web
      }
    }
  } else {
    Vibration.vibrate(pattern);
  }
};

export default function ScannerScreen() {
  const router = useRouter();
  const inputRef = useRef<TextInput>(null);
  const [permission, requestPermission] = useCameraPermissions();
  const [scanned, setScanned] = useState(false);
  const [loading, setLoading] = useState(false);
  const [scanResult, setScanResult] = useState<ScanResult | null>(null);

  if (Platform.OS !== 'web') {
    if (!permission) {
      return <View style={styles.centerContainer} />;
    }

    if (!permission.granted) {
      return (
        <SafeAreaView style={styles.permissionContainer}>
          <Ionicons name="camera-outline" size={64} color={theme.primary} />
          <Text style={styles.permissionTitle} suppressHighlighting={true}>Camera Access Required</Text>
          <Text style={styles.permissionSub}>
            True Strength requires camera permissions to scan member QR codes at the front desk.
          </Text>
          <TouchableOpacity style={styles.permissionBtn} onPress={requestPermission}>
            <Text style={styles.permissionBtnText}>Grant Permission</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
            <Text style={styles.backBtnText}>Back to Dashboard</Text>
          </TouchableOpacity>
        </SafeAreaView>
      );
    }
  }

  const handleBarCodeScanned = async ({ data }: { data: string }) => {
    if (scanned || loading) return;

    setScanned(true);
    setLoading(true);

    try {
      const cleanData = data ? data.trim() : '';

      if (!cleanData) {
        safeVibrate([100, 100, 100]);
        setScanResult({
          status: 'error',
          memberName: 'Invalid Format',
          planName: 'N/A',
          message: 'Empty QR code payload.',
        });
        setLoading(false);
        return;
      }

      // Force extract pure UUID. 'i' flag ensures case-insensitive matching.
      const uuidRegex = /[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/i;
      const uuidMatch = cleanData.match(uuidRegex);
      const extractedUuid = uuidMatch ? uuidMatch[0].toLowerCase() : null;

      if (!extractedUuid) {
        safeVibrate([100, 100, 100]);
        setScanResult({
          status: 'error',
          memberName: 'Invalid Format',
          planName: 'N/A',
          message: 'No valid ID found in QR code.',
        });
        setLoading(false);
        return;
      }

      // 1. Safe profile lookup preventing Postgres UUID column type mismatch errors.
      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('id, full_name, qr_access_token')
        .or(`qr_access_token.eq.${extractedUuid},id.eq.${extractedUuid}`)
        .maybeSingle();

      // Separate true database errors from "Profile Not Found" to stop Expo crash
      if (profileError) {
        console.error("Database Lookup Error:", profileError);
        safeVibrate([100, 100, 100]);
        setScanResult({
          status: 'error',
          memberName: 'Database Error',
          planName: 'N/A',
          message: 'Could not connect to database.',
        });
        setLoading(false);
        return;
      } 
      
      if (!profile) {
        console.warn("Scan successful, but no profile found in database."); 
        safeVibrate([100, 100, 100]);
        setScanResult({
          status: 'error',
          memberName: 'Unknown Member',
          planName: 'N/A',
          message: 'Invalid QR Code or Member not found.',
        });
        setLoading(false);
        return;
      }

      // 2. Fetch subscription status
      const { data: subscription, error: subError } = await supabase
        .from('user_subscriptions')
        .select('status, plan_name, next_payment_date, cancel_at_period_end, pass_dates, created_at')
        .eq('user_id', profile.id)
        .maybeSingle();

      let isActive = false;
      const subStatus = subscription?.status ? subscription.status.toLowerCase().trim() : '';
      const planNameLower = subscription?.plan_name ? subscription.plan_name.toLowerCase() : '';

      if (subscription) {
        const isDayPassPlan = planNameLower.includes('day pass');

        if (isDayPassPlan) {
          const today = new Date();
          today.setHours(0, 0, 0, 0);

          let rawDates: string[] = subscription.pass_dates || [];
          if (rawDates.length === 0 && subscription.created_at) rawDates = [subscription.created_at];

          isActive = rawDates.some((d: string) => {
            const passDate = new Date(d);
            passDate.setHours(0, 0, 0, 0);
            return passDate.getTime() === today.getTime();
          });
        } else {
          const isCancelledRequested = subStatus === 'cancellation_requested' || (subStatus === 'active' && subscription.cancel_at_period_end === true);
          
          if (subStatus === 'active' || isCancelledRequested) {
            isActive = true;
          }
        }
      }

      if (subError || !isActive || !subscription) {
        safeVibrate([100, 100, 100]);
        setScanResult({
          status: 'error',
          memberName: profile.full_name || 'Member',
          planName: subscription?.plan_name || 'No Active Plan',
          message: 'ACCESS DENIED: Membership is inactive or payment overdue.',
        });
        setLoading(false);
        return;
      }

      // 3. Record successful gym check-in
      await supabase.from('gym_check_ins').insert([
        {
          user_id: profile.id,
        },
      ]);

      // 4. Success feedback
      safeVibrate(50);
      setScanResult({
        status: 'success',
        memberName: profile.full_name || 'Valued Member',
        planName: subscription?.plan_name || 'Gym Access',
        message: 'Welcome to True Strength!',
      });
    } catch (err) {
      safeVibrate([100, 100, 100]);
      setScanResult({
        status: 'error',
        memberName: 'Error',
        planName: 'N/A',
        message: 'An unexpected error occurred during verification.',
      });
    } finally {
      setLoading(false);
    }
  };

  const resetScanner = () => {
    setScanned(false);
    setScanResult(null);
  };

  return (
    <View style={styles.container}>
      {!scanResult ? (
        <View style={StyleSheet.absoluteFill}>
          {Platform.OS === 'web' ? (
            <View style={[StyleSheet.absoluteFill, { backgroundColor: theme.background, justifyContent: 'center', alignItems: 'center' }]}>
              <TextInput
                ref={inputRef}
                autoFocus
                showSoftInputOnFocus={false}
                style={{
                  width: 250,
                  height: 50,
                  backgroundColor: theme.border,
                  color: theme.textLight,
                  borderRadius: 12,
                  paddingHorizontal: 16,
                  textAlign: 'center',
                  zIndex: 999,
                }}
                placeholder="Click here & use USB scanner"
                placeholderTextColor={theme.textMuted}
                onSubmitEditing={(e) => {
                  handleBarCodeScanned({ data: e.nativeEvent.text });
                  inputRef.current?.clear();
                }}
              />
            </View>
          ) : (
            <CameraView
              style={StyleSheet.absoluteFill}
              facing="back"
              barcodeScannerSettings={{
                barcodeTypes: ['qr'],
              }}
              onBarcodeScanned={scanned ? undefined : handleBarCodeScanned}
            />
          )}

          {/* pointerEvents prop is deprecated in RN Web, migrated to styles to fix terminal warning */}
          <SafeAreaView style={[styles.overlayContainer, { pointerEvents: 'box-none' as any }]}>
            <View style={styles.topBar}>
              <TouchableOpacity style={styles.closeBtn} onPress={() => router.back()}>
                <Ionicons name="close" size={24} color="#FFFFFF" />
              </TouchableOpacity>
              <Text style={styles.topBarTitle}>Front Desk Scanner</Text>
              <View style={{ width: 40 }} />
            </View>

            <View style={styles.scannerWindow}>
              <View style={[styles.corner, styles.topLeft]} />
              <View style={[styles.corner, styles.topRight]} />
              <View style={[styles.corner, styles.bottomLeft]} />
              <View style={[styles.corner, styles.bottomRight]} />
              {loading && <ActivityIndicator size="large" color={theme.primary} />}
            </View>

            <View style={styles.instructionBox}>
              <Text style={styles.instructionText}>Align member QR code within the frame</Text>
            </View>
          </SafeAreaView>
        </View>
      ) : (
        <SafeAreaView
          style={[
            styles.resultContainer,
            { backgroundColor: scanResult.status === 'success' ? '#064E3B' : '#7F1D1D' },
          ]}
        >
          <View style={styles.resultContent}>
            <View
              style={[
                styles.resultIconWrapper,
                {
                  backgroundColor:
                    scanResult.status === 'success' ? theme.success : theme.danger,
                },
              ]}
            >
              <Ionicons
                name={scanResult.status === 'success' ? 'checkmark' : 'close'}
                size={64}
                color="#FFFFFF"
              />
            </View>

            <Text
              style={[
                styles.resultHeader,
                { color: scanResult.status === 'success' ? '#34D399' : '#F87171' },
              ]}
            >
              {scanResult.status === 'success' ? 'Successful check in' : 'ACCESS DENIED'}
            </Text>

            <Text style={styles.resultName}>{scanResult.memberName}</Text>
            <Text style={styles.resultPlan}>Plan: {scanResult.planName}</Text>

            <View style={styles.resultBadge}>
              <Text style={styles.resultBadgeText}>{scanResult.message}</Text>
            </View>

            <TouchableOpacity style={styles.scanNextBtn} onPress={resetScanner}>
              <Ionicons name="scan-outline" size={20} color="#FFFFFF" style={{ marginRight: 8 }} />
              <Text style={styles.scanNextText}>Scan Next Member</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.exitScannerBtn} onPress={() => router.back()}>
              <Text style={styles.exitScannerText}>Return to Dashboard</Text>
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000000',
  },
  centerContainer: {
    flex: 1,
    backgroundColor: '#050505',
    justifyContent: 'center',
    alignItems: 'center',
  },
  permissionContainer: {
    flex: 1,
    backgroundColor: theme.background,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  permissionTitle: {
    color: theme.textLight,
    fontSize: 22,
    fontWeight: 'bold',
    marginTop: 16,
    marginBottom: 8,
    textAlign: 'center',
  },
  permissionSub: {
    color: theme.textMuted,
    fontSize: 14,
    textAlign: 'center',
    marginBottom: 24,
    lineHeight: 20,
  },
  permissionBtn: {
    backgroundColor: theme.primary,
    paddingHorizontal: 24,
    paddingVertical: 14,
    borderRadius: 14,
    width: '100%',
    alignItems: 'center',
    marginBottom: 12,
  },
  permissionBtnText: {
    color: '#FFFFFF',
    fontWeight: 'bold',
    fontSize: 16,
  },
  backBtn: {
    paddingVertical: 12,
  },
  backBtnText: {
    color: theme.textMuted,
    fontSize: 14,
    fontWeight: '600',
  },
  overlayContainer: {
    flex: 1,
    justifyContent: 'space-between',
    padding: 24,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  closeBtn: {
    width: 40,
    height: 40,
    backgroundColor: 'rgba(0,0,0,0.6)',
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  topBarTitle: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: 'bold',
  },
  scannerWindow: {
    width: 260,
    height: 260,
    alignSelf: 'center',
    justifyContent: 'center',
    alignItems: 'center',
    position: 'relative',
  },
  corner: {
    position: 'absolute',
    width: 32,
    height: 32,
    borderColor: theme.primary,
    borderWidth: 4,
  },
  topLeft: {
    top: 0,
    left: 0,
    borderBottomWidth: 0,
    borderRightWidth: 0,
    borderTopLeftRadius: 8,
  },
  topRight: {
    top: 0,
    right: 0,
    borderBottomWidth: 0,
    borderLeftWidth: 0,
    borderTopRightRadius: 8,
  },
  bottomLeft: {
    bottom: 0,
    left: 0,
    borderTopWidth: 0,
    borderRightWidth: 0,
    borderBottomLeftRadius: 8,
  },
  bottomRight: {
    bottom: 0,
    right: 0,
    borderTopWidth: 0,
    borderLeftWidth: 0,
    borderBottomRightRadius: 8,
  },
  instructionBox: {
    backgroundColor: 'rgba(0,0,0,0.7)',
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 30,
    alignSelf: 'center',
    marginBottom: 40,
  },
  instructionText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
  },
  resultContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  resultContent: {
    width: '100%',
    alignItems: 'center',
    maxWidth: 340,
  },
  resultIconWrapper: {
    width: 100,
    height: 100,
    borderRadius: 50,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 20,
    ...Platform.select({
      web: {
        boxShadow: '0px 4px 6px rgba(0, 0, 0, 0.3)',
      },
      default: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.3,
        shadowRadius: 6,
        elevation: 8,
      },
    }),
  },
  resultHeader: {
    fontSize: 22,
    fontWeight: '900',
    letterSpacing: 1,
    marginBottom: 12,
    textAlign: 'center',
  },
  resultName: {
    color: '#FFFFFF',
    fontSize: 26,
    fontWeight: 'bold',
    marginBottom: 4,
    textAlign: 'center',
  },
  resultPlan: {
    color: 'rgba(255,255,255,0.8)',
    fontSize: 16,
    marginBottom: 24,
    textAlign: 'center',
  },
  resultBadge: {
    backgroundColor: 'rgba(0, 0, 0, 0.3)',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 12,
    width: '100%',
    marginBottom: 32,
    alignItems: 'center',
  },
  resultBadgeText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '600',
    textAlign: 'center',
  },
  scanNextBtn: {
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    flexDirection: 'row',
    height: 54,
    borderRadius: 16,
    width: '100%',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.3)',
  },
  scanNextText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: 'bold',
  },
  exitScannerBtn: {
    paddingVertical: 12,
  },
  exitScannerText: {
    color: 'rgba(255, 255, 255, 0.7)',
    fontSize: 14,
    fontWeight: '600',
  },
});