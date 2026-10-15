import { Ionicons } from '@expo/vector-icons';
import { Asset } from 'expo-asset';
import * as FileSystem from 'expo-file-system/legacy';
import * as Print from 'expo-print';
import { useFocusEffect, useRouter } from 'expo-router';
import * as Sharing from 'expo-sharing';
import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View
} from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { SafeAreaView } from 'react-native-safe-area-context';
import { supabase } from '../../services/supabase';

const theme = {
  background: '#050505',
  surface: '#121212',
  surfaceElevated: '#1E1E1E',
  primary: '#FF0A7A',
  danger: '#EF4444',
  textLight: '#FFFFFF',
  textMuted: '#8E8E93',
  border: '#2C2C2E',
};

export default function QRScreen() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [qrToken, setQrToken] = useState<string>('');
  const [timeLeft, setTimeLeft] = useState(30);

  // --- Waiver State ---
  const [hasSignedWaiver, setHasSignedWaiver] = useState<boolean>(false);
  const [showWaiverModal, setShowWaiverModal] = useState<boolean>(false);
  const [signerName, setSignerName] = useState<string>('');
  const [signatureText, setSignatureText] = useState<string>('');
  const [isSubmittingWaiver, setIsSubmittingWaiver] = useState<boolean>(false);
  const [userId, setUserId] = useState<string | null>(null);

  // --- Error UI State ---
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const rotateToken = async (uid: string) => {
    try {
      const newToken = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        const v = c === 'x' ? r : (r & 0x3) | 0x8;
        return v.toString(16);
      });

      const { error } = await supabase
        .from('profiles')
        .update({ qr_access_token: newToken })
        .eq('id', uid);

      if (error) {
        console.warn('Supabase update error:', error.message);
      } else {
        setQrToken(newToken);
        setTimeLeft(30);
      }
    } catch (err) {
      console.warn('Error rotating QR token:', err);
    }
  };

  useFocusEffect(
    useCallback(() => {
      let isMounted = true;
      let timerInterval: ReturnType<typeof setInterval>;
      let rotationInterval: ReturnType<typeof setInterval>;

      const initializePass = async () => {
        if (isMounted) setLoading(true);
        try {
          const { data: { user } } = await supabase.auth.getUser();
          if (!user) {
            router.replace('/home');
            return;
          }
          if (isMounted) setUserId(user.id);

          // 1. Check Subscription Status & Pass Date
          const { data: subscription } = await supabase
            .from('user_subscriptions')
            .select('status, next_payment_date, plan_name, pass_dates, created_at, cancel_at_period_end')
            .eq('user_id', user.id)
            .maybeSingle();

          if (!subscription) {
            router.replace('/home');
            return;
          }

          const subStatus = subscription.status?.toLowerCase().trim();
          const isCancelled = subStatus === 'cancellation_requested' || (subStatus === 'active' && subscription.cancel_at_period_end === true);
          const activeStatus = subStatus === 'active' || isCancelled;

          const planNameLower = subscription.plan_name?.toLowerCase() || '';
          const isDayPassPlan = planNameLower.includes('day pass');

          const today = new Date();
          today.setHours(0, 0, 0, 0);

          if (isDayPassPlan) {
            // Extract pass_dates array, falling back to created_at if empty
            let rawDates: string[] = subscription.pass_dates || [];
            if (rawDates.length === 0 && subscription.created_at) {
              rawDates = [subscription.created_at];
            }

            // Check if ANY date in the pass_dates array matches today's date
            const isPassToday = rawDates.some((dateStr) => {
              if (!dateStr) return false;
              const passDateObj = new Date(dateStr);
              passDateObj.setHours(0, 0, 0, 0);
              return passDateObj.getTime() === today.getTime();
            });

            // Reject access if status is not active or today is not in pass_dates
            if (!activeStatus || !isPassToday) {
              router.replace('/home');
              return;
            }
          }else {
            // Standard recurring subscription check
            let isOverdue = false;

            if (subscription.next_payment_date) {
              const nextPayment = new Date(subscription.next_payment_date);
              nextPayment.setHours(0, 0, 0, 0);
              if (nextPayment.getTime() < today.getTime()) {
                isOverdue = true;
              }
            }

            if (!activeStatus || isOverdue) {
              router.replace('/home');
              return; 
            }
          }

          // 2. Check Profile Data & Waiver Status
          const { data: profile } = await supabase
            .from('profiles')
            .select('qr_access_token, waiver_signed, full_name, digital_signature')
            .eq('id', user.id)
            .maybeSingle();

          const waiverSigned = Boolean(profile?.waiver_signed);
          if (isMounted) {
            setHasSignedWaiver(waiverSigned);
            if (profile?.full_name) setSignerName(profile.full_name);
            
            if (profile?.digital_signature) {
              setSignatureText(profile.digital_signature);
            } else if (profile?.full_name) {
              setSignatureText(profile.full_name);
            }
          }

          if (!waiverSigned) {
            if (isMounted) setShowWaiverModal(true);
          } else {
            if (profile?.qr_access_token) {
              if (isMounted) setQrToken(profile.qr_access_token);
            } else {
              await rotateToken(user.id);
            }

            rotationInterval = setInterval(() => {
              rotateToken(user.id);
            }, 30000);

            timerInterval = setInterval(() => {
              setTimeLeft((prev) => (prev > 1 ? prev - 1 : 30));
            }, 1000);
          }
        } catch (err) {
          console.warn('Error initializing QR pass:', err);
          if (isMounted) setErrorMessage('Failed to initialize your access pass.');
        } finally {
          if (isMounted) setLoading(false);
        }
      };

      initializePass();

      return () => {
        isMounted = false;
        clearInterval(rotationInterval);
        clearInterval(timerInterval);
      };
    }, [hasSignedWaiver])
  );

  const getBase64Logo = async () => {
    try {
      const logoAsset = Asset.fromModule(require('../../../assets/images/logo.jpeg'));
      await logoAsset.downloadAsync();
      const base64 = await FileSystem.readAsStringAsync(logoAsset.localUri!, {
        encoding: FileSystem.EncodingType.Base64,
      });
      return `data:image/jpeg;base64,${base64}`;
    } catch (e) {
      console.warn('Could not load local logo for PDF:', e);
      return '';
    }
  };

 const generateWaiverHTML = (name: string, signature: string, logoSrc: string) => {
  const dateString = new Date().toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

  return `
    <!DOCTYPE html>
    <html>
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, minimum-scale=1.0, user-scalable=no" />
        <style>
          * { box-sizing: border-box; }
          body { 
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; 
            padding: 35px 40px; 
            color: #222222; 
            line-height: 1.6; 
            background-color: #ffffff;
          }
          .header { text-align: center; margin-bottom: 25px; }
          .logo { max-width: 130px; height: auto; margin-bottom: 12px; }
          h1 { color: #111111; text-align: center; font-size: 22px; margin: 0 0 4px 0; text-transform: uppercase; letter-spacing: 0.8px; }
          .subtitle { text-align: center; color: #FF0A7A; font-size: 13px; font-weight: 700; text-transform: uppercase; letter-spacing: 1.2px; margin-bottom: 25px; }
          .card { background-color: #F8F9FA; border-radius: 10px; border-left: 4px solid #FF0A7A; padding: 18px 20px; margin-bottom: 18px; }
          .section h3 { font-size: 14px; margin: 0 0 6px 0; color: #111111; text-transform: uppercase; letter-spacing: 0.5px; }
          .section p { font-size: 12px; margin: 0; color: #444444; }
          .sig-box { margin-top: 35px; background: #FAF9FA; border: 1.5px dashed #FF0A7A; border-radius: 10px; padding: 20px; }
          .sig-row { display: flex; justify-content: space-between; margin-bottom: 8px; font-size: 12px; }
          .sig-label { font-weight: bold; color: #333333; }
          .signature { font-family: 'Courier New', Courier, monospace; font-size: 20px; font-style: italic; font-weight: bold; color: #FF0A7A; }
          .footer { margin-top: 40px; text-align: center; font-size: 10px; color: #888888; border-top: 1px solid #EEEEEE; padding-top: 15px; }
        </style>
      </head>
      <body>
        <div class="header">
          <img src="${logoSrc}" class="logo" alt="True Strength Logo" />
          <h1>Gym Liability Waiver & Release</h1>
          <div class="subtitle">Official Membership Access Agreement</div>
        </div>
        
        <div class="card section">
          <h3>1. Physical Condition & Assumption of Risk</h3>
          <p>By signing below, I acknowledge that participating in exercise and gym activities involves inherent risks of physical injury. I declare that I am physically fit, authorised to engage in exercise, and have no medical condition that would prevent my safe participation.</p>
        </div>

        <div class="card section">
          <h3>2. Code of Conduct & Safety Rules</h3>
          <p>I agree to abide by all facility rules, return equipment to proper storage after use, minimise disruptions, and treat staff, authorised trainers, and fellow members with respect at all times.</p>
        </div>

        <div class="card section">
          <h3>3. Limitation of Liability</h3>
          <p>I release True Strength Gym, its owners, and employees from any liability for personal injury, property loss, or damage incurred on the premises to the fullest extent permitted by law.</p>
        </div>

        <div class="sig-box">
          <div class="sig-row"><span class="sig-label">Full Printed Name:</span> <span>${name}</span></div>
          <div class="sig-row"><span class="sig-label">Digital Signature:</span> <span class="signature">${signature}</span></div>
          <div class="sig-row" style="margin-bottom: 0;"><span class="sig-label">Date Signed:</span> <span>${dateString}</span></div>
        </div>

        <div class="footer">
          Generated via True Strength Gym Mobile App &bull; User ID: ${userId || 'N/A'}
        </div>
      </body>
    </html>
  `;
};

  const generateAndSharePDF = async (htmlContent: string) => {
    try {
      const { base64 } = await Print.printToFileAsync({
        html: htmlContent,
        base64: true,
      });

      if (!base64) {
        throw new Error('Failed to generate PDF contents.');
      }

      const fileName = `TrueStrength_Waiver_${Date.now()}.pdf`;
      const fileUri = `${FileSystem.cacheDirectory}${fileName}`;

      await FileSystem.writeAsStringAsync(fileUri, base64, {
        encoding: FileSystem.EncodingType.Base64,
      });

      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(fileUri, {
          mimeType: 'application/pdf',
          dialogTitle: 'True Strength Gym Waiver',
          UTI: 'com.adobe.pdf',
        });
      } else {
        setErrorMessage('File sharing is not supported on this device.');
      }
    } catch (err: any) {
      throw new Error(err.message || 'Failed to generate PDF document.');
    }
  };

 const handleSignWaiver = async () => {
    setErrorMessage(null);

    if (!signerName.trim() || !signatureText.trim()) {
      setErrorMessage('Please type your full name and sign your name to accept the waiver.');
      return;
    }

    setIsSubmittingWaiver(true);
    try {
      const logoSrc = await getBase64Logo();
      const htmlContent = generateWaiverHTML(signerName, signatureText, logoSrc);

      if (userId) {
        const { error } = await supabase
          .from('profiles')
          .update({
            waiver_signed: true,
            full_name: signerName.trim(),
            digital_signature: signatureText.trim(),
            waiver_signed_at: new Date().toISOString(),
          })
          .eq('id', userId);

        if (error) throw error;
      }

      setHasSignedWaiver(true);
      setShowWaiverModal(false);

      await generateAndSharePDF(htmlContent);
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to record waiver signature.');
    } finally {
      setIsSubmittingWaiver(false);
    }
  };

 const handleViewExistingWaiver = async () => {
    setErrorMessage(null);
    try {
      const nameToUse = signerName.trim() || 'Member';
      const sigToUse = signatureText.trim() || nameToUse;

      const logoSrc = await getBase64Logo();
      const htmlContent = generateWaiverHTML(nameToUse, sigToUse, logoSrc);
      await generateAndSharePDF(htmlContent);
    } catch (err) {
      setErrorMessage('Could not open signed waiver document.');
    }
  };

  const ErrorBanner = () => {
    if (!errorMessage) return null;
    return (
      <View style={styles.errorBanner}>
        <Ionicons name="alert-circle" size={20} color="#FFFFFF" />
        <Text style={styles.errorBannerText}>{errorMessage}</Text>
        <TouchableOpacity onPress={() => setErrorMessage(null)}>
          <Ionicons name="close" size={20} color="#FFFFFF" />
        </TouchableOpacity>
      </View>
    );
  };

  if (loading) {
    return (
      <View style={styles.loaderContainer}>
        <ActivityIndicator size="large" color={theme.primary} />
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <ErrorBanner />

      {/* --- WAIVER MODAL --- */}
      <Modal visible={showWaiverModal} animationType="slide" transparent={false}>
        <SafeAreaView style={styles.modalContainer}>
          <ErrorBanner />
          
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Facility Liability Waiver</Text>
            <Text style={styles.modalSub}>
              Please review and sign the terms to activate your QR pass.
            </Text>
          </View>

          <ScrollView style={styles.termsScrollView} contentContainerStyle={styles.termsContent}>
  <Text style={styles.termsHeading}>1. Physical Condition & Assumption of Risk</Text>
  <Text style={styles.termsBody}>
    By signing below, I acknowledge that participating in exercise and gym activities involves inherent risks of physical injury. I declare that I am physically fit, authorised to engage in exercise, and have no medical condition that would prevent my safe participation.
  </Text>

  <Text style={styles.termsHeading}>2. Code of Conduct & Safety Rules</Text>
  <Text style={styles.termsBody}>
    I agree to abide by all facility rules, return equipment to proper storage after use, minimise disruptions, and treat staff, authorised trainers, and fellow members with respect at all times.
  </Text>

  <Text style={styles.termsHeading}>3. Limitation of Liability</Text>
  <Text style={styles.termsBody}>
    I release True Strength Gym, its owners, and employees from any liability for personal injury, property loss, or damage incurred on the premises to the fullest extent permitted by law.
  </Text>
</ScrollView>

          <View style={styles.formContainer}>
            <Text style={styles.inputLabel}>Full Legal Name</Text>
            <TextInput
              style={styles.input}
              placeholder="e.g. John Doe"
              placeholderTextColor={theme.textMuted}
              value={signerName}
              onChangeText={setSignerName}
            />

            <Text style={styles.inputLabel}>Digital Signature (Type Signature)</Text>
            <TextInput
              style={[styles.input, styles.sigInput]}
              placeholder="Type your signature..."
              placeholderTextColor={theme.textMuted}
              value={signatureText}
              onChangeText={setSignatureText}
            />

            <TouchableOpacity
              style={[styles.signBtn, isSubmittingWaiver && styles.signBtnDisabled]}
              disabled={isSubmittingWaiver}
              onPress={handleSignWaiver}
            >
              {isSubmittingWaiver ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <Text style={styles.signBtnText}>Agree & Generate Waiver PDF</Text>
              )}
            </TouchableOpacity>

            <TouchableOpacity 
              style={styles.cancelLink}
              onPress={() => {
                setShowWaiverModal(false);
                router.back();
              }}
            >
              <Text style={styles.cancelLinkText}>Cancel & Go Back</Text>
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      </Modal>

      {/* --- MAIN PASS SCREEN --- */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.closeBtn} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={24} color="#FFFFFF" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Member Access Pass</Text>
        <View style={{ width: 40 }} />
      </View>

      <View style={styles.content}>
        {hasSignedWaiver ? (
          qrToken ? (
            <View style={styles.passCard}>
              <View style={styles.qrWrapper}>
                <QRCode
                  value={qrToken}
                  size={220}
                  color="#000000"
                  backgroundColor="#FFFFFF"
                />
              </View>

              <View style={styles.timerRow}>
                <Ionicons name="time-outline" size={16} color={theme.primary} />
                <Text style={styles.timerText}>Refreshing in {timeLeft}s</Text>
              </View>

              <Text style={styles.instructions}>
                Hold this screen up to the front desk scanner to check in.
              </Text>

              <TouchableOpacity 
                style={styles.viewWaiverBtn} 
                onPress={handleViewExistingWaiver}
              >
                <Ionicons name="document-text-outline" size={16} color={theme.primary} />
                <Text style={styles.viewWaiverText}>View Signed Waiver PDF</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <ActivityIndicator size="large" color={theme.primary} />
          )
        ) : (
          <View style={styles.passCard}>
            <Ionicons name="document-lock-outline" size={48} color={theme.primary} style={{ marginBottom: 16 }} />
            <Text style={[styles.headerTitle, { color: theme.primary }]}>Waiver Required</Text>
            <Text style={[styles.instructions, { marginTop: 12, marginBottom: 24 }]}>
              You must sign the facility liability waiver before you can access your QR pass.
            </Text>
            <TouchableOpacity 
              style={[styles.signBtn, { width: '100%', marginTop: 0 }]} 
              onPress={() => setShowWaiverModal(true)}
            >
              <Text style={styles.signBtnText}>Review & Sign Waiver</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.background,
  },
  loaderContainer: {
    flex: 1,
    backgroundColor: theme.background,
    justifyContent: 'center',
    alignItems: 'center',
  },
  errorBanner: {
    position: 'absolute',
    top: 60,
    left: 20,
    right: 20,
    backgroundColor: theme.danger,
    borderRadius: 12,
    padding: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    zIndex: 999,
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
  errorBannerText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '600',
    flex: 1,
    marginHorizontal: 12,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 24,
    paddingVertical: 12,
    marginTop: 20,
  },
  closeBtn: {
    width: 40,
    height: 40,
    backgroundColor: theme.surface,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: theme.border,
  },
  headerTitle: {
    color: theme.textLight,
    fontSize: 18,
    fontWeight: 'bold',
  },
  content: {
    flex: 1,
    padding: 24,
    justifyContent: 'center',
    alignItems: 'center',
  },
  passCard: {
    backgroundColor: theme.surface,
    borderRadius: 24,
    padding: 30,
    alignItems: 'center',
    width: '100%',
    borderWidth: 1,
    borderColor: theme.border,
    ...Platform.select({
      web: {
        boxShadow: '0px 8px 12px rgba(0, 0, 0, 0.4)',
      },
      default: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.4,
        shadowRadius: 12,
        elevation: 10,
      },
    }),
  },
  qrWrapper: {
    padding: 16,
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    marginBottom: 20,
  },
  timerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 10, 122, 0.1)',
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 20,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: 'rgba(255, 10, 122, 0.3)',
  },
  timerText: {
    color: theme.primary,
    fontSize: 13,
    fontWeight: '600',
    marginLeft: 6,
  },
  instructions: {
    color: theme.textMuted,
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 18,
  },
  viewWaiverBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 20,
    paddingVertical: 8,
    paddingHorizontal: 16,
    backgroundColor: 'rgba(255, 10, 122, 0.08)',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(255, 10, 122, 0.2)',
  },
  viewWaiverText: {
    color: theme.primary,
    fontSize: 12,
    fontWeight: '600',
    marginLeft: 6,
  },
  modalContainer: {
    flex: 1,
    backgroundColor: theme.background,
    paddingHorizontal: 20,
  },
  modalHeader: {
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: theme.border,
    marginTop: 10,
  },
  modalTitle: {
    color: theme.textLight,
    fontSize: 22,
    fontWeight: 'bold',
  },
  modalSub: {
    color: theme.textMuted,
    fontSize: 13,
    marginTop: 4,
  },
  termsScrollView: {
    flex: 1,
    marginVertical: 16,
    backgroundColor: theme.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: theme.border,
  },
  termsContent: {
    padding: 16,
  },
  termsHeading: {
    color: theme.primary,
    fontSize: 14,
    fontWeight: 'bold',
    marginTop: 10,
    marginBottom: 4,
  },
  termsBody: {
    color: theme.textLight,
    fontSize: 12,
    lineHeight: 18,
    marginBottom: 10,
  },
  formContainer: {
    paddingBottom: 20,
  },
  inputLabel: {
    color: theme.textMuted,
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 6,
  },
  input: {
    backgroundColor: theme.surfaceElevated,
    color: theme.textLight,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: theme.border,
    marginBottom: 14,
    fontSize: 14,
  },
  sigInput: {
    fontStyle: 'italic',
    letterSpacing: 1,
  },
  signBtn: {
    backgroundColor: theme.primary,
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 6,
  },
  signBtnDisabled: {
    opacity: 0.6,
  },
  signBtnText: {
    color: '#FFFFFF',
    fontWeight: 'bold',
    fontSize: 15,
  },
  cancelLink: {
    marginTop: 12,
    alignItems: 'center',
    paddingVertical: 10,
  },
  cancelLinkText: {
    color: theme.textMuted,
    fontSize: 13,
  },
});