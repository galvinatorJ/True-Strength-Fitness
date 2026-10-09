import { useFocusEffect, useRouter } from 'expo-router';
import {
  AlertCircle,
  Calendar,
  Check,
  ChevronRight,
  Crown,
  Edit2,
  HelpCircle,
  LogOut,
  PlusCircle, // <-- NEW
  RefreshCw,
  ShieldCheck,
  Trash2,
  User,
  X,
  XCircle,
} from 'lucide-react-native';
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Linking,
  Modal,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useStripe } from '../../services/stripeWrapper';
import { supabase } from '../../services/supabase';

const BRAND_PINK = '#e8256a';
const CARD_BG = '#141414';

interface UIMessage {
  type: 'success' | 'error' | 'info';
  text: string;
}

export default function ProfileScreen() {
  const router = useRouter();
  const { initPaymentSheet, presentPaymentSheet } = useStripe();

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [processingAction, setProcessingAction] = useState(false);

  const [uiMessage, setUiMessage] = useState<UIMessage | null>(null);

  // Modals state
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [showContractBlockModal, setShowContractBlockModal] = useState(false);
  const [showResumeModal, setShowResumeModal] = useState(false);

  const [isEditing, setIsEditing] = useState(false);
  const [editableName, setEditableName] = useState('');

  const [userData, setUserData] = useState({
    id: '',
    name: '',
    email: '',
  });

  const [subscriptionData, setSubscriptionData] = useState({
    planName: 'Loading...',
    nextPayment: 'Checking...',
    status: 'inactive',
    rawDate: '', 
    isCancellationRequested: false,
    isDayPass: false, // <-- NEW
  });

  const isTestMode = true; 

  const isTwelveMonthContract = 
    subscriptionData.planName?.toLowerCase().includes('12 month') || 
    subscriptionData.planName?.toLowerCase().includes('12-month');

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>; 
    if (uiMessage) {
      timer = setTimeout(() => {
        setUiMessage(null);
      }, 3000);
    }
    return () => {
      if (timer) clearTimeout(timer);
    };
  }, [uiMessage]);

  const fetchUserProfileAndSubscription = async () => {
    try {
      const {
        data: { user },
        error: authError,
      } = await supabase.auth.getUser();

      if (authError || !user) {
        router.replace('/');
        return;
      }

      const { data: profile } = await supabase
        .from('profiles')
        .select('full_name, email')
        .eq('id', user.id)
        .single();

      const currentName = profile?.full_name || user.user_metadata?.full_name || 'Member';
      const currentEmail = profile?.email || user.email || '';

      setUserData({
        id: user.id,
        name: currentName,
        email: currentEmail,
      });
      setEditableName(currentName);

      // UPDATE 1: Change pass_date to pass_dates here
      const { data: subscription } = await supabase
        .from('user_subscriptions')
        .select('plan_name, next_payment_date, pass_dates, created_at, status, cancel_at_period_end')
        .eq('user_id', user.id)
        .maybeSingle();

      const today = new Date();
      today.setHours(0, 0, 0, 0);

      if (subscription) {
        const subStatus = subscription.status?.toLowerCase().trim();
        const isCancelled = subStatus === 'cancellation_requested' || subscription.cancel_at_period_end === true;
        const statusIsActive = subStatus === 'active' || isCancelled;
        const isPastDueStatus = subStatus === 'past_due';

        const planNameLower = subscription.plan_name?.toLowerCase() || '';
        const isDayPassPlan = planNameLower.includes('day pass');

        // UPDATE 2: Replace the entire if (isDayPassPlan) block with this:
        if (isDayPassPlan) {
          let rawDates: string[] = subscription.pass_dates || [];
          if (rawDates.length === 0 && subscription.created_at) rawDates = [subscription.created_at];

          const futureOrTodayDates = rawDates
            .map(d => {
              const dateObj = new Date(d);
              dateObj.setHours(0, 0, 0, 0);
              return dateObj;
            })
            .filter(d => d.getTime() >= today.getTime())
            .sort((a, b) => a.getTime() - b.getTime());

          let isPassToday = false;
          let isFuturePass = false;
          let formattedPassDate = '';

          if (futureOrTodayDates.length > 0) {
            const nextPassDate = futureOrTodayDates[0];
            isPassToday = nextPassDate.getTime() === today.getTime();
            isFuturePass = nextPassDate.getTime() > today.getTime();

            formattedPassDate = nextPassDate.toLocaleDateString('en-GB', {
              day: 'numeric',
              month: 'short',
              year: 'numeric'
            });
          }

          if (statusIsActive && (isPassToday || isFuturePass)) {
            const remaining = futureOrTodayDates.length - 1;
            let nextPaymentText = 'Valid today';
            
            if (isPassToday) {
               nextPaymentText = remaining > 0 ? `Valid Today (+${remaining} future)` : 'Valid Today';
            } else if (isFuturePass) {
               nextPaymentText = `Valid on ${formattedPassDate}`;
            }

            setSubscriptionData({
              planName: subscription.plan_name || 'Gym Day Pass',
              nextPayment: nextPaymentText,
              status: 'active',
              rawDate: formattedPassDate,
              isCancellationRequested: false,
              isDayPass: true,
            });
          } else {
            setSubscriptionData({
              planName: subscription.plan_name || 'Gym Day Pass',
              nextPayment: 'Your day pass has expired, please purchase a new pass or membership',
              status: 'inactive',
              rawDate: '',
              isCancellationRequested: false,
              isDayPass: true,
            });
          }
        } else {
          // Standard recurring membership logic
          let isPastDate = false;
          let formattedDate = 'Active (No expiry)';
          let cleanRawDate = '';

          if (subscription.next_payment_date) {
            const paymentDate = new Date(subscription.next_payment_date);
            paymentDate.setHours(0, 0, 0, 0);

            if (paymentDate.getTime() < today.getTime()) {
              isPastDate = true;
            }
            
            cleanRawDate = paymentDate.toLocaleDateString('en-GB', {
              day: 'numeric',
              month: 'short',
              year: 'numeric',
            });
            
            formattedDate = isCancelled 
              ? `Cancels on ${cleanRawDate}` 
              : `Next payment on ${cleanRawDate}`;
          }

          if (isPastDueStatus) {
            setSubscriptionData({
              planName: subscription.plan_name || 'Gym Membership',
              nextPayment: 'Payment Overdue',
              status: 'past_due',
              rawDate: cleanRawDate,
              isCancellationRequested: false,
              isDayPass: false, // <-- ADD THIS
            });
          } else if (!statusIsActive || isPastDate) {
            setSubscriptionData({
              planName: 'No Active Membership',
              nextPayment: isPastDate ? 'Expired' : 'No active membership',
              status: 'inactive',
              rawDate: cleanRawDate,
              isCancellationRequested: false,
              isDayPass: false, // <-- ADD THIS
            });
          } else {
            setSubscriptionData({
              planName: subscription.plan_name || 'Gym Access',
              nextPayment: formattedDate,
              status: subStatus,
              rawDate: cleanRawDate,
              isCancellationRequested: isCancelled,
              isDayPass: false, // <-- ADD THIS
            });
          }
        }
      } else {
        setSubscriptionData({
          planName: 'No Active Membership',
          nextPayment: 'No active membership',
          status: 'inactive',
          rawDate: '',
          isCancellationRequested: false,
          isDayPass: false, // <-- ADD THIS
        });
      }
    } catch (error) {
      console.error('Error fetching profile/subscription:', error);
      setUiMessage({ type: 'error', text: 'Failed to load profile data.' });
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useFocusEffect(
    useCallback(() => {
      fetchUserProfileAndSubscription();
      return () => {
        setUiMessage(null);
      };
    }, [])
  );

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    fetchUserProfileAndSubscription();
  }, []);

  const handleSaveProfile = async () => {
    if (!editableName.trim()) {
      setUiMessage({ type: 'error', text: 'Name cannot be empty.' });
      return;
    }

    try {
      setSaving(true);
      setUiMessage(null);

      const { error } = await supabase
        .from('profiles')
        .update({ full_name: editableName.trim() })
        .eq('id', userData.id);

      if (error) throw error;

      setUserData((prev) => ({ ...prev, name: editableName.trim() }));
      setIsEditing(false);
      setUiMessage({ type: 'success', text: 'Profile updated successfully!' });
    } catch (error: any) {
      console.error('Error updating profile:', error);
      setUiMessage({ type: 'error', text: error.message || 'Failed to update profile.' });
    } finally {
      setSaving(false);
    }
  };

  const handleCancelIntent = () => {
    const planNameLower = subscriptionData.planName?.toLowerCase() || '';
    if (planNameLower.includes('day pass')) {
      setUiMessage({ type: 'info', text: 'You cannot cancel a day pass membership.' });
      return;
    }

    if (isTwelveMonthContract) {
      setShowContractBlockModal(true);
    } else {
      setShowCancelModal(true);
    }
  };

  const handleDeleteIntent = () => {
    setShowDeleteModal(true);
  };

  const handleUpdatePayment = async () => {
    try {
      setProcessingAction(true);
      setUiMessage(null);
      
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
          defaultBillingDetails: { name: userData.name, email: userData.email } 
        });

        if (initError) throw new Error(initError.message);

        const { error: presentError } = await presentPaymentSheet();
        
        if (presentError) {
          if (presentError.code === 'Canceled') {
            return;
          }
          throw new Error(presentError.message);
        }

        setUiMessage({ type: 'success', text: 'Payment processed successfully! Your membership is active.' });
        fetchUserProfileAndSubscription(); 
      } else {
        throw new Error('Did not receive secure payment configuration from server.');
      }
    } catch (error: any) {
      console.error('Error opening payment sheet:', error);
      setUiMessage({ type: 'error', text: error.message || 'Failed to open secure payment sheet.' });
    } finally {
      setProcessingAction(false);
    }
  };

  const handleCancelMembership = async () => {
    try {
      setProcessingAction(true);
      setUiMessage(null);

      const { error } = await supabase.functions.invoke('cancel-subscription', {
        body: { 
          action: 'cancel_at_period_end',
          isTestMode 
        }
      });

      // Extract the exact error from the Edge Function body
      if (error) {
        let detailedMessage = error.message;
        try {
          const errorBody = await (error as any).context?.json();
          if (errorBody?.error) {
            detailedMessage = errorBody.error;
          }
        } catch (_e) {}
        throw new Error(detailedMessage);
      }

      setSubscriptionData((prev) => ({ 
        ...prev, 
        status: 'cancellation_requested',
        isCancellationRequested: true 
      }));
      setShowCancelModal(false);
      setUiMessage({
        type: 'success',
        text: 'Membership cancelled. You have access until your billing period ends.',
      });
    } catch (error: any) {
      console.error('Error cancelling membership:', error);
      setUiMessage({ type: 'error', text: error.message || 'Failed to cancel membership.' });
    } finally {
      setProcessingAction(false);
    }
  };

  const handleResumeMembership = async () => {
    try {
      setProcessingAction(true);
      setUiMessage(null);

      const { error } = await supabase.functions.invoke('cancel-subscription', {
        body: { 
          action: 'resume',
          isTestMode 
        }
      });

      // Extract the exact error from the Edge Function body
      if (error) {
        let detailedMessage = error.message;
        try {
          const errorBody = await (error as any).context?.json();
          if (errorBody?.error) {
            detailedMessage = errorBody.error;
          }
        } catch (_e) {}
        throw new Error(detailedMessage);
      }

      setSubscriptionData((prev) => ({ 
        ...prev, 
        status: 'active',
        isCancellationRequested: false 
      }));
      
      setShowResumeModal(false);
      setUiMessage({
        type: 'success',
        text: 'Membership resumed successfully!',
      });
      
      fetchUserProfileAndSubscription();
    } catch (error: any) {
      console.error('Error resuming membership:', error);
      setUiMessage({ type: 'error', text: error.message || 'Failed to resume membership.' });
    } finally {
      setProcessingAction(false);
    }
  };

  const handleDeleteAccount = async () => {
    try {
      setProcessingAction(true);
      setUiMessage(null);

      const { error } = await supabase.functions.invoke('delete-account', {
        body: { 
          isTestMode,
          keepStripeActive: isTwelveMonthContract 
        }
      });

      if (error) {
        let detailedMessage = error.message;
        try {
          const errorBody = await error.context?.json();
          if (errorBody?.error) {
            detailedMessage = errorBody.error;
          }
        } catch (_e) {}
        throw new Error(detailedMessage);
      }

      setShowDeleteModal(false);
      await supabase.auth.signOut();
      router.replace('/');
    } catch (error: any) {
      console.error('Error deleting account:', error);
      setUiMessage({ 
        type: 'error', 
        text: error.message || 'Failed to delete account. Please try again.' 
      });
    } finally {
      setProcessingAction(false);
    }
  };

  const handleLogout = async () => {
    try {
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
      router.replace('/');
    } catch (error) {
      console.error('Error signing out:', error);
      setUiMessage({ type: 'error', text: 'Failed to log out.' });
    }
  };

  const openPrivacyPolicy = () => {
    Linking.openURL('https://truestrengthandfitness.co.uk/privacy-policy/').catch(() => {
      setUiMessage({ type: 'error', text: 'Unable to open privacy policy link.' });
    });
  };

  const openContactSupport = () => {
    Linking.openURL('mailto:support@truestrengthandfitness.co.uk').catch(() => {
      setUiMessage({ type: 'error', text: 'Unable to open mail client.' });
    });
  };

  const isMembershipActive = ['active', 'cancellation_requested'].includes(subscriptionData.status) || subscriptionData.isCancellationRequested;
  const isPastDue = subscriptionData.status === 'past_due';

  if (loading) {
    return (
      <SafeAreaView style={[styles.container, styles.centerContent]}>
        <ActivityIndicator size="large" color={BRAND_PINK} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      {uiMessage && (
        <View
          style={[
            styles.banner,
            uiMessage.type === 'error'
              ? styles.bannerError
              : uiMessage.type === 'success'
              ? styles.bannerSuccess
              : styles.bannerInfo,
          ]}
        >
          <AlertCircle size={18} color="#FFFFFF" />
          <Text style={styles.bannerText}>{uiMessage.text}</Text>
          <TouchableOpacity onPress={() => setUiMessage(null)}>
            <X size={18} color="#FFFFFF" />
          </TouchableOpacity>
        </View>
      )}

      <ScrollView 
        contentContainerStyle={styles.scrollContent} 
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl 
            refreshing={refreshing} 
            onRefresh={onRefresh} 
            tintColor={BRAND_PINK} 
          />
        }
      >
        <View style={styles.header}>
          <Image
            source={require('../../../assets/images/logo.jpeg')}
            style={styles.logoImage}
            resizeMode="contain"
          />
          <Text style={styles.pageTitle}>Account</Text>
          <Text style={styles.pageSubtitle}>Manage your profile and membership.</Text>
        </View>

        <View style={styles.card}>
          <View style={styles.profileRow}>
            <View style={styles.profileInfo}>
              {isEditing ? (
                <View style={styles.editContainer}>
                  <TextInput
                    style={styles.input}
                    value={editableName}
                    onChangeText={setEditableName}
                    placeholder="Enter your name"
                    placeholderTextColor="#666"
                    autoFocus
                  />
                  <View style={styles.editActions}>
                    <TouchableOpacity
                      style={styles.saveButton}
                      onPress={handleSaveProfile}
                      disabled={saving}
                    >
                      {saving ? (
                        <ActivityIndicator size="small" color="#FFF" />
                      ) : (
                        <>
                          <Check size={14} color="#FFF" />
                          <Text style={styles.saveButtonText}>Save</Text>
                        </>
                      )}
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.cancelButton}
                      onPress={() => {
                        setEditableName(userData.name);
                        setIsEditing(false);
                      }}
                    >
                      <X size={14} color="#888" />
                    </TouchableOpacity>
                  </View>
                </View>
              ) : (
                <>
                  <Text style={styles.profileName}>{userData.name}</Text>
                  <Text style={styles.profileEmail}>{userData.email}</Text>
                </>
              )}
            </View>
            {!isEditing && (
              <TouchableOpacity onPress={() => setIsEditing(true)} style={styles.editIconBtn}>
                <Edit2 size={18} color={BRAND_PINK} />
              </TouchableOpacity>
            )}
          </View>
        </View>

        <View style={styles.card}>
          <View style={styles.membershipTop}>
            <View style={{ flex: 1 }}>
              <Text style={styles.cardLabel}>Current Membership</Text>
              <Text style={styles.membershipTitle}>{subscriptionData.planName}</Text>
            </View>
            <Crown size={28} color={isMembershipActive ? BRAND_PINK : '#666'} fill={isMembershipActive ? BRAND_PINK : '#666'} />
          </View>

          {/* Date Row */}
          <View style={styles.dateRow}>
            <Calendar size={14} color={isPastDue ? '#EF4444' : '#888'} />
            <Text style={[styles.dateText, isPastDue && { color: '#EF4444', fontWeight: 'bold' }]}>
              {subscriptionData.nextPayment}
            </Text>
          </View>

          {/* Show Resume button for active cancellation-requested rolling subscriptions */}
          {subscriptionData.isCancellationRequested && !isTwelveMonthContract && (
            <TouchableOpacity
              style={styles.resumeCardButton}
              onPress={() => setShowResumeModal(true)}
            >
              <RefreshCw size={14} color={BRAND_PINK} />
              <Text style={styles.resumeCardButtonText}>Resume Membership</Text>
            </TouchableOpacity>
          )}

          {/* NEW: Show Buy Another Pass button for active Day Pass users */}
          {subscriptionData.isDayPass && isMembershipActive && (
            <TouchableOpacity
              style={styles.resumeCardButton}
              onPress={() => router.push('/membership?action=renew')}
            >
              <PlusCircle size={14} color={BRAND_PINK} />
              <Text style={styles.resumeCardButtonText}>Buy Another Pass</Text>
            </TouchableOpacity>
          )}

          {/* DYNAMIC STATUS ROW */}
          <View 
            style={[
              styles.statusRow, 
              (subscriptionData.isCancellationRequested && !isTwelveMonthContract) && { alignItems: 'flex-start' }
            ]}
          >
            <Text style={[styles.statusLabel, (subscriptionData.isCancellationRequested && !isTwelveMonthContract) && { marginTop: 2 }]}>
              Status:
            </Text>
            <Text
              style={[
                styles.statusValue,
                { color: isMembershipActive ? '#22C55E' : '#EF4444', flex: 1, lineHeight: 18 },
              ]}
            >
              {subscriptionData.isCancellationRequested 
                ? (isTwelveMonthContract 
                    ? 'ACTIVE (Expires Soon)'
                    : `Your membership is set to cancel on ${subscriptionData.rawDate}. Please resume your membership to keep your gym access.`)
                : subscriptionData.status === 'past_due' 
                ? 'Payment Overdue' 
                : subscriptionData.status.toUpperCase().replace(/_/g, ' ')}
            </Text>
          </View>

          {!isMembershipActive && (
            <TouchableOpacity
      style={styles.renewButton}
      onPress={isPastDue ? handleUpdatePayment : () => router.push('/membership?action=renew')}
      disabled={processingAction}
    >
                  {processingAction ? (
                <ActivityIndicator color="#FFFFFF" size="small" />
              ) : (
                <>
                  <RefreshCw size={16} color="#FFFFFF" />
                  <Text style={styles.renewButtonText}>
                    {isPastDue ? 'Update Payment' : 'Renew Membership'}
                  </Text>
                </>
              )}
            </TouchableOpacity>
          )}
        </View>

        <View style={styles.card}>
          <MenuRow
            icon={User}
            title="Edit Personal Details"
            onPress={() => setIsEditing(!isEditing)}
          />
          
          {isMembershipActive && (
            <MenuRow
              icon={XCircle}
              title="Cancel Membership"
              onPress={handleCancelIntent}
            />
          )}

          <MenuRow
            icon={Trash2}
            title="Delete Account"
            onPress={handleDeleteIntent}
            isDanger
          />
          <MenuRow
            icon={HelpCircle}
            title="Contact Support"
            onPress={openContactSupport}
          />
          <MenuRow
            icon={ShieldCheck}
            title="Privacy Policy"
            onPress={openPrivacyPolicy}
            isLast
          />
        </View>

        <TouchableOpacity style={styles.logoutButton} onPress={handleLogout}>
          <LogOut size={18} color="#EF4444" />
          <Text style={styles.logoutText}>Log Out</Text>
        </TouchableOpacity>
      </ScrollView>

      <Modal visible={showCancelModal} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <XCircle size={36} color={BRAND_PINK} style={styles.modalIcon} />
            <Text style={styles.modalTitle}>Cancel Membership</Text>
            <Text style={styles.modalBody}>
              This will stop your membership from renewing. You will still have full access until your current billing period ends.
            </Text>
            <View style={styles.modalActions}>
              <TouchableOpacity
                style={styles.modalCancelBtn}
                onPress={() => setShowCancelModal(false)}
                disabled={processingAction}
              >
                <Text style={styles.modalCancelText}>Keep Membership</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.modalConfirmBtn}
                onPress={handleCancelMembership}
                disabled={processingAction}
              >
                {processingAction ? (
                  <ActivityIndicator color="#FFF" size="small" />
                ) : (
                  <Text style={styles.modalConfirmText}>Cancel Renewal</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={showResumeModal} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <RefreshCw size={36} color={BRAND_PINK} style={styles.modalIcon} />
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

      <Modal visible={showContractBlockModal} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <ShieldCheck size={36} color={BRAND_PINK} style={styles.modalIcon} />
            <Text style={styles.modalTitle}>Contract Commitment Active</Text>
            <Text style={[styles.modalBody, { textAlign: 'left' }]}>
              You are currently within an active 12-Month Contract. Early cancellation is not permitted via the app unless you qualify for an exemption (e.g., medical, redundancy, relocation {'>'}15 miles). 
              {'\n\n'}
              Please contact support@truestrengthandfitness.co.uk to discuss your contract.
            </Text>
            <View style={styles.modalActions}>
              <TouchableOpacity
                style={[styles.modalConfirmBtn, { marginLeft: 0 }]}
                onPress={() => setShowContractBlockModal(false)}
              >
                <Text style={styles.modalConfirmText}>Understood</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={showDeleteModal} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Trash2 size={36} color="#EF4444" style={styles.modalIcon} />
            <Text style={[styles.modalTitle, { color: '#EF4444' }]}>
              {isTwelveMonthContract 
                ? "Delete Account & Contract Notice" 
                : "Delete Account & App Access?"}
            </Text>
            
            <Text style={[styles.modalBody, isTwelveMonthContract && { textAlign: 'left' }]}>
              {isTwelveMonthContract 
                ? "Deleting your account will permanently remove your profile data and digital app pass.\n\nIMPORTANT: Account deletion DOES NOT cancel your signed 12-Month Contract. Your monthly billing will remain active via Stripe for the duration of your agreed contract term."
                : "This action is permanent. It will permanently delete your profile data, immediately cancel your monthly subscription, and revoke app access."}
            </Text>

            <View style={styles.modalActions}>
              <TouchableOpacity
                style={styles.modalCancelBtn}
                onPress={() => setShowDeleteModal(false)}
                disabled={processingAction}
              >
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.modalConfirmBtn, { backgroundColor: '#EF4444' }]}
                onPress={handleDeleteAccount}
                disabled={processingAction}
              >
                {processingAction ? (
                  <ActivityIndicator color="#FFF" size="small" />
                ) : (
                  <Text style={styles.modalConfirmText}>
                    {isTwelveMonthContract ? "I Understand, Delete" : "Delete Account"}
                  </Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const MenuRow = ({
  icon: Icon,
  title,
  onPress,
  isLast = false,
  isDanger = false,
}: any) => (
  <TouchableOpacity
    style={[styles.menuRow, !isLast && styles.menuRowBorder]}
    onPress={onPress}
    activeOpacity={0.7}
  >
    <View style={styles.menuRowLeft}>
      <Icon size={20} color={isDanger ? '#EF4444' : BRAND_PINK} />
      <Text style={[styles.menuTitle, isDanger && { color: '#EF4444' }]}>{title}</Text>
    </View>
    <ChevronRight size={20} color="#666666" />
  </TouchableOpacity>
);

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000000' },
  centerContent: { justifyContent: 'center', alignItems: 'center' },
  scrollContent: { paddingHorizontal: 16, paddingBottom: 40 },
  banner: { marginHorizontal: 16, marginTop: 10, marginBottom: 6, borderRadius: 12, padding: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  bannerError: { backgroundColor: '#EF4444' },
  bannerSuccess: { backgroundColor: '#10B981' },
  bannerInfo: { backgroundColor: BRAND_PINK },
  bannerText: { color: '#FFFFFF', fontSize: 13, fontWeight: '600', flex: 1, marginHorizontal: 10 },
  header: { alignItems: 'center', marginTop: 10, marginBottom: 20 },
  logoImage: { width: 400, height: 165, marginBottom: 8 },
  pageTitle: { color: '#FFFFFF', fontSize: 24, fontWeight: '700', marginBottom: 4 },
  pageSubtitle: { color: '#888888', fontSize: 14 },
  card: { backgroundColor: CARD_BG, borderRadius: 16, padding: 16, marginBottom: 16 },
  profileRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  profileInfo: { flex: 1 },
  profileName: { color: '#FFFFFF', fontSize: 18, fontWeight: '600', marginBottom: 2, flexShrink: 1 },
  profileEmail: { color: '#888888', fontSize: 13, flexShrink: 1 },
  editContainer: { width: '100%' },
  input: { backgroundColor: '#222222', color: '#FFFFFF', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, marginBottom: 10, borderWidth: 1, borderColor: '#444444' },
  editActions: { flexDirection: 'row', alignItems: 'center' },
  saveButton: { flexDirection: 'row', backgroundColor: BRAND_PINK, paddingVertical: 8, paddingHorizontal: 16, borderRadius: 8, alignItems: 'center', marginRight: 8 },
  saveButtonText: { color: '#FFFFFF', fontSize: 13, fontWeight: '600', marginLeft: 6 },
  cancelButton: { padding: 8, backgroundColor: '#222222', borderRadius: 8 },
  editIconBtn: { padding: 8 },
  membershipTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 },
  cardLabel: { color: '#888888', fontSize: 12, marginBottom: 4 },
  membershipTitle: { color: BRAND_PINK, fontSize: 18, fontWeight: '700', flexWrap: 'wrap' },
  resumeCardButton: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#1A1114', paddingVertical: 8, paddingHorizontal: 12, borderRadius: 8, borderWidth: 1, borderColor: '#4d192c', alignSelf: 'flex-start', marginBottom: 12 },
  resumeCardButtonText: { color: BRAND_PINK, fontSize: 13, fontWeight: '600', marginLeft: 6 },
  dateRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
  dateText: { color: '#888888', fontSize: 13, marginLeft: 6, flex: 1 },
  statusRow: { flexDirection: 'row', alignItems: 'center' },
  statusLabel: { color: '#888888', fontSize: 13, marginRight: 6 },
  statusValue: { fontSize: 13, fontWeight: 'bold' },
  renewButton: { flexDirection: 'row', backgroundColor: BRAND_PINK, paddingVertical: 14, borderRadius: 12, justifyContent: 'center', alignItems: 'center', marginTop: 18 },
  renewButtonText: { color: '#FFFFFF', fontSize: 15, fontWeight: 'bold', marginLeft: 8 },
  menuRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 16 },
  menuRowBorder: { borderBottomWidth: 1, borderBottomColor: '#222222' },
  menuRowLeft: { flexDirection: 'row', alignItems: 'center', flex: 1 },
  menuTitle: { color: '#EAEAEA', fontSize: 15, marginLeft: 14, fontWeight: '400', flexShrink: 1 },
  logoutButton: { flexDirection: 'row', backgroundColor: '#1A1416', borderRadius: 16, paddingVertical: 16, justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: '#331A22', marginBottom: 20 },
  logoutText: { color: '#EF4444', fontSize: 16, fontWeight: '600', marginLeft: 8 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0, 0, 0, 0.8)', justifyContent: 'center', alignItems: 'center', paddingHorizontal: 20 },
  modalCard: { backgroundColor: CARD_BG, borderRadius: 20, padding: 24, width: '100%', alignItems: 'center', borderWidth: 1, borderColor: '#2C2C2E' },
  modalIcon: { marginBottom: 12 },
  modalTitle: { color: '#FFFFFF', fontSize: 20, fontWeight: 'bold', marginBottom: 8, textAlign: 'center' },
  modalBody: { color: '#888888', fontSize: 14, textAlign: 'center', lineHeight: 20, marginBottom: 24 },
  modalActions: { flexDirection: 'row', width: '100%', justifyContent: 'space-between' },
  modalCancelBtn: { flex: 1, backgroundColor: '#222222', paddingVertical: 14, borderRadius: 12, alignItems: 'center', marginRight: 8 },
  modalCancelText: { color: '#FFFFFF', fontSize: 14, fontWeight: '600' },
  modalConfirmBtn: { flex: 1, backgroundColor: BRAND_PINK, paddingVertical: 14, borderRadius: 12, alignItems: 'center', marginLeft: 8 },
  modalConfirmText: { color: '#FFFFFF', fontSize: 14, fontWeight: 'bold' },
});