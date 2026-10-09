import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useNavigation, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Modal,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useStripe } from '../../services/stripeWrapper';
import { supabase } from '../../services/supabase';

const theme = {
  background: '#050505',
  surface: '#121212',
  surfaceLight: '#1C1C1E',
  primary: '#FF0A7A', // True Strength Pink
  warning: '#F59E0B', 
  danger: '#EF4444',  
  textLight: '#FFFFFF',
  textMuted: '#8E8E93',
  border: '#2C2C2E',
};

export default function HomeScreen() {
  const router = useRouter();
  const navigation = useNavigation();
  const { initPaymentSheet, presentPaymentSheet } = useStripe();
  
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [processingAction, setProcessingAction] = useState(false);
  const [showResumeModal, setShowResumeModal] = useState(false);
  const [networkError, setNetworkError] = useState(false);

  // --- Custom Feedback Modal State ---
  const [feedbackModal, setFeedbackModal] = useState<{
    visible: boolean;
    title: string;
    message: string;
    type: 'success' | 'error' | 'info';
    onClose?: () => void;
  }>({
    visible: false,
    title: '',
    message: '',
    type: 'info',
  });
  
  // --- Role & Pass State ---
  const [role, setRole] = useState<'member' | 'admin'>('member');
  const [isDayPass, setIsDayPass] = useState<boolean>(false);

  const [fullName, setFullName] = useState<string>('Member');
  const [nextPaymentDate, setNextPaymentDate] = useState<string>('Pending');
  const [membershipPlan, setMembershipPlan] = useState<string>('Gym Access');
  const [paymentWarning, setPaymentWarning] = useState<string | null>(null);
  const [isOverdue, setIsOverdue] = useState<boolean>(false);
  const [isPastDue, setIsPastDue] = useState<boolean>(false);
  const [isCancellationRequested, setIsCancellationRequested] = useState<boolean>(false);
  const [isCanceledState, setIsCanceledState] = useState<boolean>(false);
  const [is12MonthContract, setIs12MonthContract] = useState<boolean>(false);
  const [lastCheckIn, setLastCheckIn] = useState<string>('No recent visits');

  // Modal alert helper
  const showAlert = (title: string, message: string, type: 'success' | 'error' | 'info' = 'info', onClose?: () => void) => {
    setFeedbackModal({
      visible: true,
      title,
      message,
      type,
      onClose,
    });
  };

  const hideFeedbackModal = () => {
    const callback = feedbackModal.onClose;
    setFeedbackModal((prev) => ({ ...prev, visible: false }));
    if (callback) callback();
  };

  // Hide bottom tab bar dynamically for Admin users
  useEffect(() => {
    const parent = navigation.getParent();
    if (role === 'admin') {
      parent?.setOptions({
        tabBarStyle: { display: 'none' },
      });
    } else {
      parent?.setOptions({
        tabBarStyle: undefined,
      });
    }
  }, [role, navigation]);

  const formatCheckInTime = (timestamp: string) => {
    const date = new Date(timestamp);
    const today = new Date();
    
    const isToday = 
      date.getDate() === today.getDate() &&
      date.getMonth() === today.getMonth() &&
      date.getFullYear() === today.getFullYear();

    const timeOptions: Intl.DateTimeFormatOptions = { 
      hour: 'numeric', 
      minute: '2-digit', 
      hour12: true 
    };
    
    const timeString = date.toLocaleTimeString('en-US', timeOptions);

    if (isToday) {
      return `Today ${timeString}`;
    }

    const dateOptions: Intl.DateTimeFormatOptions = { 
      day: 'numeric', 
      month: 'short' 
    };
    return `${date.toLocaleDateString('en-GB', dateOptions)} ${timeString}`;
  };

  const fetchUserData = async () => {
    try {
      setNetworkError(false);
      const { data: { user } } = await supabase.auth.getUser();
      
      if (user) {
        const { data: profile, error: profileError } = await supabase
          .from('profiles')
          .select('full_name, role')
          .eq('id', user.id)
          .maybeSingle();

        if (profileError) {
          console.warn('Profile fetch error:', profileError.message);
        }

        const rawName = profile?.full_name || user.user_metadata?.full_name || user.email?.split('@')[0] || 'Member';
        setFullName(rawName.trim());

        const dbRole = profile?.role ? profile.role.toLowerCase().trim() : '';
        const metaRole = user.user_metadata?.role ? user.user_metadata.role.toLowerCase().trim() : '';
        
        const finalRole = (dbRole === 'admin' || metaRole === 'admin') ? 'admin' : 'member';
        setRole(finalRole);

        if (finalRole !== 'admin') {
          const { data: subscription } = await supabase
            .from('user_subscriptions')
            .select('next_payment_date, plan_name, status, updated_at, created_at, cancel_at_period_end, pass_dates')
            .eq('user_id', user.id)
            .maybeSingle();

          const today = new Date();
          today.setHours(0, 0, 0, 0);

          if (subscription) {
            const subStatus = subscription.status?.toLowerCase().trim();
            const planNameLower = subscription.plan_name?.toLowerCase() || '';
            const is12Contract = planNameLower.includes('12 month') || planNameLower.includes('12-month');
            setIs12MonthContract(is12Contract);

            const isCanceled = subStatus === 'canceled' || subStatus === 'cancelled';
            const isCancelled = subStatus === 'cancellation_requested' || (subStatus === 'active' && subscription.cancel_at_period_end === true);
            const isPastDueStatus = subStatus === 'past_due';
            const isDayPassPlan = subscription.plan_name?.toLowerCase().includes('day pass');

            setIsCancellationRequested(isCancelled);
            setIsPastDue(isPastDueStatus);
            setIsCanceledState(isCanceled);

            let isPastDate = false;

            if (subscription.next_payment_date) {
              const paymentDate = new Date(subscription.next_payment_date);
              paymentDate.setHours(0, 0, 0, 0);
              if (paymentDate.getTime() < today.getTime()) {
                isPastDate = true;
              }
            }

            const statusIsActive = subStatus === 'active' || isCancelled;

            if (isDayPassPlan && statusIsActive) {
              // Extract dates strictly from the pass_dates array
              let rawDates: string[] = subscription.pass_dates || [];
              if (rawDates.length === 0 && subscription.created_at) rawDates = [subscription.created_at];

              // Filter out past dates and sort from earliest to latest
              const futureOrTodayDates = rawDates
                .map(d => {
                  const dateObj = new Date(d);
                  dateObj.setHours(0, 0, 0, 0);
                  return dateObj;
                })
                .filter(d => d.getTime() >= today.getTime())
                .sort((a, b) => a.getTime() - b.getTime());

              if (futureOrTodayDates.length > 0) {
                const nextPassDate = futureOrTodayDates[0];
                const isPassToday = nextPassDate.getTime() === today.getTime();
                const isFuturePass = !isPassToday && (nextPassDate.getTime() > today.getTime());

                // Format all purchased future/today dates cleanly
                const formattedDatesList = futureOrTodayDates.map(d => {
                  const isToday = d.getTime() === today.getTime();
                  const dateStr = d.toLocaleDateString('en-GB', {
                    day: 'numeric',
                    month: 'short',
                    year: 'numeric'
                  });
                  return isToday ? `Today (${dateStr})` : dateStr;
                });

                const allDatesFormatted = formattedDatesList.join(', ');
                const firstPassDateStr = futureOrTodayDates[0].toLocaleDateString('en-GB', {
                  day: 'numeric',
                  month: 'short',
                  year: 'numeric'
                });

                if (isPassToday) {
                  setIsDayPass(true);
                  setMembershipPlan('Day Pass');
                  setIsOverdue(false);
                  setPaymentWarning(null);
                  setNextPaymentDate(allDatesFormatted);
                } else if (isFuturePass) {
                  setIsDayPass(true); 
                  setIsOverdue(true); // Locks QR until scheduled pass date
                  setMembershipPlan('Day Pass');
                  setNextPaymentDate(allDatesFormatted);
                  setPaymentWarning(`Your next Day Pass is scheduled for ${firstPassDateStr}. QR access will unlock on that day.`);
                }
              } else {
                setIsDayPass(false);
                setIsOverdue(true);
                setMembershipPlan('No Active Membership');
                setNextPaymentDate('Expired');
                setPaymentWarning('Your Day Pass has expired. Please purchase a new pass or membership.');
              }
            } else if (isPastDueStatus) {
              setIsDayPass(false);
              setIsOverdue(true);
              setIsCancellationRequested(false);
              setMembershipPlan(subscription.plan_name || 'Gym Membership');
              setNextPaymentDate('Payment Overdue');
              setPaymentWarning('Your subscription payment failed. Please update your payment details to restore gym access.');
            } else {
              setIsDayPass(false);

              if (!statusIsActive || isPastDate) {
                setIsOverdue(true);
                setIsCancellationRequested(false);
                setIsCanceledState(isCanceled);
                setMembershipPlan(subscription.plan_name || 'Gym Membership'); 
                setNextPaymentDate('Expired');
                setPaymentWarning('Your membership contract has ended. Please renew to restore gym access.');
              } else {
                setIsOverdue(false);
                setMembershipPlan(subscription.plan_name || 'Gym Membership');

                if (subscription.next_payment_date) {
                  const rawDateString = subscription.next_payment_date;
                  const paymentDate = new Date(rawDateString);
                  paymentDate.setHours(0, 0, 0, 0);

                  const formattedDate = paymentDate.toLocaleDateString('en-GB', {
                    day: 'numeric',
                    month: 'short',
                    year: 'numeric'
                  });

                  if (isCancelled) {
                    setNextPaymentDate(formattedDate);
                    setPaymentWarning(null);
                  } else {
                    setNextPaymentDate(formattedDate);

                    const diffTime = paymentDate.getTime() - today.getTime();
                    const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24));

                    if (diffDays <= 5) {
                      if (diffDays === 0) setPaymentWarning('Your membership payment is due today.');
                      else if (diffDays === 1) setPaymentWarning('Your membership payment is due tomorrow.');
                      else setPaymentWarning(`Your membership payment is due in ${diffDays} days.`);
                    } else {
                      setPaymentWarning(null);
                    }
                  }
                } else {
                  setNextPaymentDate('Active');
                  setPaymentWarning(null);
                }
              }
            }
          
          } else {
            setIsDayPass(false);
            setIsOverdue(true);
            setIsPastDue(false);
            setIsCancellationRequested(false);
            setMembershipPlan('No Active Membership');
            setNextPaymentDate('Expired');
            setPaymentWarning('No active membership found. Please renew your membership to activate your account.');
          }

          const { data: checkIn } = await supabase
            .from('gym_check_ins')
            .select('check_in_time')
            .eq('user_id', user.id)
            .order('check_in_time', { ascending: false })
            .limit(1)
            .maybeSingle();

          if (checkIn && checkIn.check_in_time) {
            setLastCheckIn(formatCheckInTime(checkIn.check_in_time));
          }
        }
      }
    } catch (error) {
      
      console.warn('Error fetching dashboard user data:', error);
    setNetworkError(true); // Add this inside the catch block
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useFocusEffect(
    useCallback(() => {
      fetchUserData();
    }, [])
  );

  const onRefresh = () => {
    setRefreshing(true);
    fetchUserData();
  };

  const handleSignOut = async () => {
    try {
      setProcessingAction(true);
      const { error } = await supabase.auth.signOut();
      if (error) throw error;

      router.replace('/');
    } catch (err: any) {
      showAlert('Sign Out Error', err.message || 'Failed to sign out.', 'error');
    } finally {
      setProcessingAction(false);
    }
  };

  const handleUpdatePayment = async () => {
    try {
      setProcessingAction(true);
      const { data, error } = await supabase.functions.invoke('resume-subscription', {
        body: { action: 'update_payment' }
      });

      if (error) throw error;
      
      if (data?.paymentIntentClientSecret) {
        const { error: initError } = await initPaymentSheet({
          merchantDisplayName: 'True Strength',
          customerId: data.customerId,
          customerEphemeralKeySecret: data.ephemeralKeySecret,
          paymentIntentClientSecret: data.paymentIntentClientSecret,
          allowsDelayedPaymentMethods: false,
          defaultBillingDetails: { name: fullName } 
        });

        if (initError) throw new Error(initError.message);

        const { error: presentError } = await presentPaymentSheet();
        
        if (presentError) {
          if (presentError.code === 'Canceled') {
            return;
          }
          throw new Error(presentError.message);
        }

        showAlert('Success', 'Payment processed successfully! Your membership is active.', 'success', () => {
          fetchUserData();
        });
      } else {
        throw new Error('Did not receive secure payment configuration from server.');
      }
    } catch (error: any) {
      console.error('Error opening payment sheet:', error);
      showAlert('Error', error.message || 'Failed to open secure payment sheet.', 'error');
    } finally {
      setProcessingAction(false);
    }
  };

  const handleResumeMembership = async () => {
    try {
      setProcessingAction(true);
      const { error } = await supabase.functions.invoke('resume-subscription', {
        body: { action: 'resume_cancelled' } 
      });

      if (error) throw error;

      setShowResumeModal(false);
      showAlert('Success', 'Membership resumed successfully!', 'success', () => {
        fetchUserData();
      });
    } catch (error: any) {
      console.error('Error resuming membership:', error);
      showAlert('Error', error.message || 'Failed to resume membership.', 'error');
    } finally {
      setProcessingAction(false);
    }
  };

  if (loading) {
    return (
      <View style={styles.loaderContainer}>
        <ActivityIndicator size="large" color={theme.primary} />
      </View>
    );
  }

// ADD THIS ENTIRE BLOCK
  if (networkError) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.errorContainer}>
          <Ionicons name="wifi-outline" size={64} color={theme.textMuted} style={{ marginBottom: 16 }} />
          <Text style={styles.errorTitle}>Connection Error</Text>
          <Text style={styles.errorSubtitle}>
            Unable to load your dashboard. Please check your internet connection and try again.
          </Text>
          <TouchableOpacity style={styles.retryButton} onPress={fetchUserData}>
            <Text style={styles.retryButtonText}>Tap to Retry</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  // ==================== ADMIN VIEW ====================
  if (role === 'admin') {
    return (
      <SafeAreaView style={styles.container}>
        <ScrollView 
          contentContainerStyle={styles.scrollContent}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.primary} />}
        >
          <View style={styles.header}>
            <Image
              source={require('../../../assets/images/logo.jpeg')}
              style={styles.logo}
              resizeMode="contain"
            />
            <Text style={styles.greetingMain}>
              Admin Portal: <Text style={styles.greetingName}>{fullName}</Text>
            </Text>
            <View style={styles.adminBadge}>
              <Ionicons name="shield-checkmark" size={14} color={theme.primary} />
              <Text style={styles.adminBadgeText}>Staff / Manager</Text>
            </View>
          </View>

          <TouchableOpacity
            style={styles.adminScanBtn}
            activeOpacity={0.8}
            onPress={() => router.push('/scanner' as any)}
          >
            <Ionicons name="qr-code-outline" size={48} color="#FFFFFF" />
            <Text style={styles.adminScanTitle}>Scan Member QR Code</Text>
            <Text style={styles.adminScanSub}>Tap to open device camera</Text>
          </TouchableOpacity>

          <TouchableOpacity 
            style={styles.signOutButton}
            activeOpacity={0.8}
            onPress={handleSignOut}
            disabled={processingAction}
          >
            {processingAction ? (
              <ActivityIndicator color={theme.danger} size="small" />
            ) : (
              <>
                <Ionicons name="log-out-outline" size={20} color={theme.danger} style={{ marginRight: 8 }} />
                <Text style={styles.signOutButtonText}>Log Out</Text>
              </>
            )}
          </TouchableOpacity>
        </ScrollView>
      </SafeAreaView>
    );
  }

  // ==================== MEMBER VIEW ====================
  return (
    <SafeAreaView style={styles.container}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.primary} />
        }
      >
        <View style={styles.header}>
          <Image
            source={require('../../../assets/images/logo.jpeg')}
            style={styles.logo}
            resizeMode="contain"
          />
          <Text style={styles.greetingMain}>
            Welcome back, <Text style={styles.greetingName}>{fullName}</Text>
          </Text>
          
          <View style={[styles.activeBadge, isOverdue && styles.overdueBadge]}>
            <Ionicons 
              name={isOverdue ? "alert-circle" : "checkmark-circle"} 
              size={14} 
              color={isOverdue ? theme.danger : theme.primary} 
            />
            <Text style={styles.activeBadgeText}>
              {isOverdue 
                ? (isPastDue ? 'Payment Past Due' : 'Membership Locked') 
                : isDayPass 
                  ? 'Day Pass Active' 
                  : 'Active Member'}
            </Text>
          </View>
        </View>

        {paymentWarning && (
          <View style={[styles.warningBanner, isOverdue && styles.overdueBanner]}>
            <View style={styles.warningLeft}>
              <Ionicons 
                name="alert-circle" 
                size={22} 
                color={isOverdue ? theme.danger : theme.warning} 
              />
              <Text style={[styles.warningText, isOverdue && styles.overdueText]}>
                {paymentWarning}
              </Text>
            </View>
            
            {isOverdue && !isDayPass && (
              <TouchableOpacity 
                style={styles.renewBannerBtn}
                activeOpacity={0.8}
                onPress={isPastDue ? handleUpdatePayment : () => router.push('/membership?action=renew' as any)}
                disabled={processingAction}
              >
                {processingAction ? (
                  <ActivityIndicator color="#FFF" size="small" />
                ) : (
                  <Text style={styles.renewBannerBtnText}>
                    {isPastDue ? 'Update Payment' : 'Renew'}
                  </Text>
                )}
              </TouchableOpacity>
            )}
          </View>
        )}

        <TouchableOpacity
          style={[styles.qrPassBtn, isOverdue && styles.qrPassBtnDisabled]}
          activeOpacity={isOverdue ? 1 : 0.8}
          disabled={isOverdue}
          onPress={() => router.push('/qr' as any)}
        >
          <View style={styles.qrPassLeft}>
            <View style={[styles.qrIconWrapper, isOverdue && styles.qrIconWrapperDisabled]}>
              <Ionicons 
                name={isOverdue ? "lock-closed-outline" : "qr-code-outline"} 
                size={26} 
                color={isOverdue ? theme.textMuted : "#FFFFFF"} 
              />
            </View>
            <View>
              <Text style={[styles.qrPassTitle, isOverdue && styles.disabledText]}>
                {isOverdue 
                  ? 'Access Locked' 
                  : isDayPass 
                    ? 'Open Day Pass' 
                    : 'Open Gym Pass'}
              </Text>
              <Text style={[styles.qrPassSub, isOverdue && styles.disabledSubText]}>
                {isOverdue ? 'Pass valid on a future date' : 'Tap to scan & check in'}
              </Text>
            </View>
          </View>
          <Ionicons 
            name={isOverdue ? "lock-closed" : "chevron-forward"} 
            size={22} 
            color={isOverdue ? theme.textMuted : "#FFFFFF"} 
          />
        </TouchableOpacity>
        
        {/* Subscription Info Cards */}
        {(() => {
          const isContractEnding = isCancellationRequested && !isCanceledState;
          const isContractEnded = isOverdue && isCanceledState && !isDayPass;

          return (
            <View style={[styles.fullWidthCard, (isContractEnding || isContractEnded) && styles.cancellationCard]}>
              <Text style={styles.infoLabel}>
                {isDayPass 
                  ? 'Pass Validity' 
                  : isContractEnding 
                    ? 'Contract Expiry' 
                    : isContractEnded
                      ? 'Contract Ended'
                      : 'Next Payment'}
              </Text>
              <View style={styles.infoValueRow}>
                <Ionicons 
                  name={
                    isDayPass 
                      ? "ticket-outline" 
                      : isContractEnding 
                        ? "time-outline" 
                        : isContractEnded
                          ? "checkmark-done-circle-outline"
                          : "calendar-outline"
                  } 
                  size={18} 
                  color={(isOverdue && !isContractEnded && !isDayPass) ? theme.danger : isContractEnding ? theme.warning : theme.primary} 
                />
                <Text style={[
                  styles.infoValue, 
                  (isOverdue && !isContractEnded && !isDayPass) && styles.overdueValue,
                  isContractEnding && styles.cancellationValue,
                  isContractEnded && { color: theme.textLight }
                ]}>
                  {isContractEnding 
                    ? `Cancels on ${nextPaymentDate}` 
                    : isContractEnded
                      ? 'Subscription Completed'
                      : nextPaymentDate}
                </Text>
              </View>
              
              {/* Show Resume button for active cancellation-requested rolling subscriptions */}
              {isCancellationRequested && !isCanceledState && !is12MonthContract && (
                <TouchableOpacity
                  style={styles.resumeCardButton}
                  onPress={() => setShowResumeModal(true)}
                >
                  <Ionicons name="refresh-outline" size={14} color={theme.primary} />
                  <Text style={styles.resumeCardButtonText}>Resume Membership</Text>
                </TouchableOpacity>
              )}

              {/* Show Renew button when the contract has fully ended/cancelled */}
              {isContractEnded && (
                <TouchableOpacity
                  style={styles.resumeCardButton}
                  onPress={() => router.push('/membership' as any)}
                >
                  <Ionicons name="refresh-outline" size={14} color={theme.primary} />
                  <Text style={styles.resumeCardButtonText}>Renew Membership</Text>
                </TouchableOpacity>
              )}

              {/* Show Buy Additional Pass button for active Day Pass users */}
              {isDayPass && (
                <TouchableOpacity
                  style={styles.resumeCardButton}
                  onPress={isPastDue ? handleUpdatePayment : () => router.push('/membership?action=renew' as any)}
                >
                  <Ionicons name="add-circle-outline" size={14} color={theme.primary} />
                  <Text style={styles.resumeCardButtonText}>Buy Another Pass</Text>
                </TouchableOpacity>
              )}
            </View>
          );
        })()}

        <View style={styles.fullWidthCard}>
          <Text style={styles.infoLabel}>Membership Plan</Text>
          <View style={styles.infoValueRow}>
            <Ionicons 
              name="apps-outline" 
              size={18} 
              color={(isOverdue && !isDayPass) ? theme.danger : theme.primary} 
            />
            <Text style={[styles.infoValue, (isOverdue && !isDayPass) && styles.overdueValue]}>
              {membershipPlan}
            </Text>
          </View>
        </View>

        <View style={styles.actionGrid}>
          <TouchableOpacity 
            style={[styles.actionBox, isOverdue && styles.actionBoxDisabled]}
            disabled={isOverdue}
            activeOpacity={0.8}
            onPress={() => router.push('/qr' as any)}
          >
            <Ionicons 
              name="qr-code-outline" 
              size={26} 
              color={isOverdue ? theme.textMuted : theme.primary} 
              style={styles.actionIcon} 
            />
            <Text style={[styles.actionBoxText, isOverdue && styles.disabledText]}>
              View QR Code
            </Text>
          </TouchableOpacity>

          <TouchableOpacity 
            style={styles.actionBox}
            activeOpacity={0.8}
            onPress={() => router.push('/account' as any)}
          >
            <Ionicons 
              name="person-outline" 
              size={26} 
              color={theme.primary} 
              style={styles.actionIcon} 
            />
            <Text style={styles.actionBoxText}>Account</Text>
          </TouchableOpacity>
        </View>

        {/* Last Check-in Card */}
        <TouchableOpacity 
          style={styles.checkInCard}
          activeOpacity={0.8}
        >
          <View style={styles.checkInLeft}>
            <View style={styles.checkInIconWrapper}>
              <Ionicons name="time-outline" size={22} color={theme.primary} />
            </View>
            <View style={styles.checkInTexts}>
              <Text style={styles.checkInLabel}>Last Check-in</Text>
              <Text style={styles.checkInValue}>{lastCheckIn}</Text>
            </View>
          </View>
          <Ionicons name="chevron-forward" size={18} color={theme.textMuted} />
        </TouchableOpacity>

        {/* Sign Out Button - Matching Account Style */}
        <TouchableOpacity 
          style={styles.signOutButton}
          activeOpacity={0.8}
          onPress={handleSignOut}
          disabled={processingAction}
        >
          {processingAction ? (
            <ActivityIndicator color={theme.danger} size="small" />
          ) : (
            <>
              <Ionicons name="log-out-outline" size={20} color={theme.danger} style={{ marginRight: 8 }} />
              <Text style={styles.signOutButtonText}>Sign Out</Text>
            </>
          )}
        </TouchableOpacity>

      </ScrollView>

      {/* Resume Membership Action Modal */}
      <Modal 
        visible={showResumeModal} 
        transparent 
        animationType="fade"
        onRequestClose={() => setShowResumeModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Ionicons name="refresh-circle" size={48} color={theme.primary} style={styles.modalIcon} />
            <Text style={styles.modalTitle}>Resume Membership</Text>
            <Text style={styles.modalBody}>
              This will reactivate your monthly subscription and remove your scheduled cancellation. Do you want to resume?
            </Text>
            <View style={styles.modalActions}>
              <TouchableOpacity
                style={styles.modalCancelBtn}
                onPress={() => setShowResumeModal(false)}
                disabled={processingAction}
              >
                <Text style={styles.modalCancelText}>Go Back</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.modalConfirmBtn}
                onPress={handleResumeMembership}
                disabled={processingAction}
              >
                {processingAction ? (
                  <ActivityIndicator color="#FFF" size="small" />
                ) : (
                  <Text style={styles.modalConfirmText}>Yes, Resume</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Custom Branded Feedback Modal (Replaces Native Alert Popups) */}
      <Modal 
        visible={feedbackModal.visible} 
        transparent 
        animationType="fade"
        onRequestClose={hideFeedbackModal}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Ionicons 
              name={
                feedbackModal.type === 'success' 
                  ? "checkmark-circle-outline" 
                  : feedbackModal.type === 'error' 
                    ? "alert-circle-outline" 
                    : "information-circle-outline"
              } 
              size={48} 
              color={
                feedbackModal.type === 'success' 
                  ? theme.primary 
                  : feedbackModal.type === 'error' 
                    ? theme.danger 
                    : theme.primary
              } 
              style={styles.modalIcon} 
            />
            <Text style={styles.modalTitle}>{feedbackModal.title}</Text>
            <Text style={styles.modalBody}>{feedbackModal.message}</Text>
            
            <TouchableOpacity
              style={[
                styles.modalConfirmBtn, 
                { width: '100%', marginLeft: 0 },
                feedbackModal.type === 'error' && { backgroundColor: theme.danger }
              ]}
              onPress={hideFeedbackModal}
              activeOpacity={0.8}
            >
              <Text style={styles.modalConfirmText}>OK</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.background },
  scrollContent: { paddingHorizontal: 20, paddingTop: 10, paddingBottom: 40 },
  loaderContainer: { flex: 1, backgroundColor: theme.background, justifyContent: 'center', alignItems: 'center' },
  header: { alignItems: 'center', marginBottom: 20 },
  logo: { width: 240, height: 100, marginBottom: 8 },
  greetingMain: { color: theme.textLight, fontSize: 21, fontWeight: '700', marginBottom: 10 },
  greetingName: { color: theme.primary },
  activeBadge: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(255, 10, 122, 0.1)', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, borderWidth: 1, borderColor: 'rgba(255, 10, 122, 0.3)' },
  overdueBadge: { backgroundColor: 'rgba(239, 68, 68, 0.1)', borderColor: 'rgba(239, 68, 68, 0.3)' },
  activeBadgeText: { color: theme.textLight, fontSize: 12, fontWeight: '600', marginLeft: 6 },
  adminBadge: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(255, 10, 122, 0.15)', paddingHorizontal: 14, paddingVertical: 6, borderRadius: 20, borderWidth: 1, borderColor: theme.primary },
  adminBadgeText: { color: theme.primary, fontSize: 12, fontWeight: '700', marginLeft: 6 },
  adminScanBtn: { backgroundColor: theme.primary, borderRadius: 20, padding: 28, alignItems: 'center', justifyContent: 'center', marginTop: 10, marginBottom: 16 },
  adminScanTitle: { color: '#FFFFFF', fontSize: 20, fontWeight: 'bold', marginTop: 12 },
  adminScanSub: { color: 'rgba(255, 255, 255, 0.8)', fontSize: 13, marginTop: 4 },
  warningBanner: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: 'rgba(245, 158, 11, 0.12)', borderWidth: 1, borderColor: 'rgba(245, 158, 11, 0.35)', borderRadius: 14, padding: 14, marginBottom: 16 },
  overdueBanner: { backgroundColor: 'rgba(239, 68, 68, 0.12)', borderColor: 'rgba(239, 68, 68, 0.35)' },
  warningLeft: { flexDirection: 'row', alignItems: 'center', flex: 1, marginRight: 8 },
  warningText: { color: '#FCD34D', fontSize: 13, fontWeight: '600', marginLeft: 10, flex: 1, lineHeight: 18 },
  overdueText: { color: '#FCA5A5' },
  renewBannerBtn: { backgroundColor: theme.danger, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8, minHeight: 44, justifyContent: 'center' },
  renewBannerBtnText: { color: '#FFFFFF', fontSize: 12, fontWeight: 'bold' },
  qrPassBtn: { backgroundColor: theme.primary, borderRadius: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 18, marginBottom: 14, minHeight: 64 },
  qrPassBtnDisabled: { backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.border },
  qrPassLeft: { flexDirection: 'row', alignItems: 'center' },
  qrIconWrapper: { width: 44, height: 44, backgroundColor: 'rgba(255, 255, 255, 0.2)', borderRadius: 12, justifyContent: 'center', alignItems: 'center', marginRight: 14 },
  qrIconWrapperDisabled: { backgroundColor: theme.surfaceLight },
  qrPassTitle: { color: '#FFFFFF', fontSize: 17, fontWeight: 'bold', marginBottom: 2 },
  disabledText: { color: theme.textMuted },
  qrPassSub: { color: 'rgba(255, 255, 255, 0.85)', fontSize: 13 },
  disabledSubText: { color: '#666666' },
  fullWidthCard: { backgroundColor: theme.surface, borderRadius: 16, padding: 16, width: '100%', borderWidth: 1, borderColor: theme.border, marginBottom: 12 },
  cancellationCard: { borderColor: 'rgba(245, 158, 11, 0.4)', backgroundColor: 'rgba(245, 158, 11, 0.08)' },
  infoLabel: { color: theme.textMuted, fontSize: 12, marginBottom: 6, fontWeight: '500' },
  infoValueRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' },
  infoValue: { color: theme.textLight, fontSize: 15, fontWeight: '700', marginLeft: 8, flex: 1 },
  overdueValue: { color: theme.danger },
  cancellationValue: { color: theme.warning },
  resumeCardButton: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(255, 10, 122, 0.1)', paddingVertical: 10, paddingHorizontal: 14, borderRadius: 10, borderWidth: 1, borderColor: 'rgba(255, 10, 122, 0.3)', alignSelf: 'flex-start', marginTop: 14, minHeight: 44 },
  resumeCardButtonText: { color: theme.primary, fontSize: 13, fontWeight: '600', marginLeft: 6 },
  actionGrid: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 12 },
  actionBox: { backgroundColor: theme.surface, width: '48.5%', borderRadius: 16, paddingVertical: 18, paddingHorizontal: 12, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: theme.border, minHeight: 80 },
  actionBoxDisabled: { opacity: 0.5, borderColor: '#1C1C1E' },
  actionIcon: { marginBottom: 6 },
  actionBoxText: { color: theme.textLight, fontSize: 13, fontWeight: '600', textAlign: 'center' },
  checkInCard: { backgroundColor: theme.surface, borderRadius: 16, padding: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderWidth: 1, borderColor: theme.border, minHeight: 64 },
  checkInLeft: { flexDirection: 'row', alignItems: 'center' },
  checkInIconWrapper: { width: 38, height: 38, borderRadius: 10, backgroundColor: 'rgba(255, 10, 122, 0.1)', justifyContent: 'center', alignItems: 'center', marginRight: 14 },
  checkInTexts: { justifyContent: 'center' },
  checkInLabel: { color: theme.textMuted, fontSize: 12, fontWeight: '500', marginBottom: 2 },
  checkInValue: { color: theme.textLight, fontSize: 14, fontWeight: '700' },
  signOutButton: { 
    flexDirection: 'row', 
    alignItems: 'center', 
    justifyContent: 'center', 
    backgroundColor: 'rgba(239, 68, 68, 0.08)', 
    borderRadius: 14, 
    paddingVertical: 16, 
    paddingHorizontal: 20, 
    borderWidth: 1, 
    borderColor: 'rgba(239, 68, 68, 0.25)', 
    marginTop: 16, 
    width: '100%',
    minHeight: 52
  },
  signOutButtonText: { color: theme.danger, fontSize: 15, fontWeight: '700' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0, 0, 0, 0.85)', justifyContent: 'center', alignItems: 'center', paddingHorizontal: 24 },
  modalCard: { backgroundColor: theme.surface, borderRadius: 20, padding: 24, width: '100%', alignItems: 'center', borderWidth: 1, borderColor: theme.border },
  modalIcon: { marginBottom: 12 },
  modalTitle: { color: theme.textLight, fontSize: 20, fontWeight: 'bold', marginBottom: 8, textAlign: 'center' },
  modalBody: { color: theme.textMuted, fontSize: 14, textAlign: 'center', lineHeight: 20, marginBottom: 24 },
  modalActions: { flexDirection: 'row', width: '100%', justifyContent: 'space-between' },
  modalCancelBtn: { flex: 1, backgroundColor: theme.surfaceLight, paddingVertical: 14, borderRadius: 12, alignItems: 'center', marginRight: 8, minHeight: 48, justifyContent: 'center' },
  modalCancelText: { color: theme.textLight, fontSize: 14, fontWeight: '600' },
  // Add these inside styles = StyleSheet.create({ ... })
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  errorTitle: {
    fontSize: 22,
    fontWeight: 'bold',
    color: theme.textLight,
    marginBottom: 8,
    textAlign: 'center',
  },
  errorSubtitle: {
    fontSize: 15,
    color: theme.textMuted,
    textAlign: 'center',
    marginBottom: 24,
    lineHeight: 22,
  },
  retryButton: {
    backgroundColor: theme.primary,
    paddingVertical: 14,
    paddingHorizontal: 32,
    borderRadius: 12,
  },
  retryButtonText: {
    color: '#FFFFFF',
    fontWeight: 'bold',
    fontSize: 16,
  },
 modalConfirmBtn: { 
    flex: 1, 
    backgroundColor: theme.primary, 
    paddingVertical: 14, 
    borderRadius: 12, 
    alignItems: 'center', 
    marginLeft: 8, 
    minHeight: 48, 
    justifyContent: 'center', // Fix: Changed 'justify' to 'justifyContent'
    ...Platform.select({
      web: { boxShadow: '0px 4px 8px rgba(255, 10, 122, 0.3)' },
      default: { 
        shadowColor: theme.primary, 
        shadowOffset: { width: 0, height: 4 }, 
        shadowOpacity: 0.3, 
        shadowRadius: 6, 
        elevation: 4 
      }
    })
  },
  modalConfirmText: { color: '#FFFFFF', fontSize: 14, fontWeight: 'bold' },
});