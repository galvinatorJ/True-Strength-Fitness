import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Linking,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useStripe } from '../services/stripeWrapper';
import { supabase } from '../services/supabase';

// 👇 STRIPE PRICE IDs 👇
const PLAN_PRICE_IDS = {
  recovery: 'price_1UEUTx7RMmHfKOtjCBZnAknR', // Full Gym Use - 12 Month Contract
  yearcontract: 'price_1UEUU17RMmHfKOtjO7vbTR6b', // Full Gym Use - Pay Monthly
  daypass: 'price_1UQoVO7RMmHfKOtjDFNKMJMX', // Gym Day Pass
};

// 👇 PLAN METADATA 👇
const PLAN_DETAILS = {
  recovery: { name: 'Full Gym Use - 12 Month Contract', amount: 40, recurring: true, period: 'month' },
  yearcontract: { name: 'Full Gym Use - Pay Monthly', amount: 50, recurring: true, period: 'month' },
  daypass: { name: 'Gym Day Pass', amount: 15, recurring: false, period: 'day' },
};

type PlanKey = keyof typeof PLAN_PRICE_IDS;

const theme = {
  background: '#050505',
  surface: '#121212',
  primary: '#FF0A7A',
  textLight: '#FFFFFF',
  textMuted: '#8E8E93',
  border: '#2C2C2E',
  error: '#FF3B30',
};

// Helper: Format Date to YYYY-MM-DD
const formatDateISO = (d: Date) => {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

// Helper: Format YYYY-MM-DD for UI Display (e.g. 5 Oct 2026)
const formatDisplayDate = (dateStr: string) => {
  if (!dateStr) return '';
  const parts = dateStr.split('-');
  if (parts.length !== 3) return dateStr;
  const year = parseInt(parts[0], 10);
  const month = parseInt(parts[1], 10) - 1;
  const day = parseInt(parts[2], 10);
  const d = new Date(year, month, day);
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
};

interface ModalConfig {
  visible: boolean;
  title: string;
  message: string;
}

export default function MembershipScreen() {
  const router = useRouter();
  const { action } = useLocalSearchParams();

  const [selectedPlan, setSelectedPlan] = useState<PlanKey | null>(null);
  const [acceptedContract, setAcceptedContract] = useState(false);
  
  // Day Pass Calendar State
  const todayStr = formatDateISO(new Date());
  const [selectedDate, setSelectedDate] = useState<string>(todayStr);
  const [calendarDate, setCalendarDate] = useState<Date>(() => {
    const d = new Date();
    d.setDate(1);
    return d;
  });

  // User Subscription & Pass State
  const [userPassDates, setUserPassDates] = useState<string[]>([]);
  const [isMonthlyActive, setIsMonthlyActive] = useState<boolean>(false);
  const [hasActiveSubOrPass, setHasActiveSubOrPass] = useState<boolean>(false);

  // Modal & Loading States
  const [modalConfig, setModalConfig] = useState<ModalConfig>({ visible: false, title: '', message: '' });
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [checkingAuth, setCheckingAuth] = useState(true);
  const { initPaymentSheet, presentPaymentSheet } = useStripe();

  const showModal = (title: string, message: string) => {
    setModalConfig({ visible: true, title, message });
  };

  const hideModal = () => {
    setModalConfig(prev => ({ ...prev, visible: false }));
  };

  // 👇 CHECK SUBSCRIPTION STATUS ON MOUNT 👇
  useEffect(() => {
    let isMounted = true;
    const checkActiveSubscription = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) {
          if (isMounted) setCheckingAuth(false);
          return;
        }

        const { data } = await supabase
          .from('user_subscriptions')
          .select('status, next_payment_date, plan_name, pass_date, pass_dates, created_at')
          .eq('user_id', session.user.id)
          .single();

        if (data && isMounted) {
          const subStatus = data.status?.toLowerCase().trim() || '';
          const planNameLower = data.plan_name?.toLowerCase() || '';
          const isDayPassPlan = planNameLower.includes('day pass');
          const allowedHomeStatuses = ['active', 'cancellation_requested', 'past_due'];
          
          const today = new Date();
          today.setHours(0, 0, 0, 0);

          // Extract stored pass dates
          let rawDates: string[] = data.pass_dates || [];
          if (rawDates.length === 0 && data.pass_date) rawDates = [data.pass_date];
          if (rawDates.length === 0 && data.created_at && isDayPassPlan) rawDates = [data.created_at];

          setUserPassDates(rawDates);

          const hasValidPass = rawDates.some(d => {
            if (!d) return false;
            const passDateObj = new Date(d);
            passDateObj.setHours(0, 0, 0, 0);
            return passDateObj.getTime() >= today.getTime();
          });

          let monthlyActive = false;
          if (!isDayPassPlan && allowedHomeStatuses.includes(subStatus)) {
            let isPastDate = false;
            if (data.next_payment_date) {
              const paymentDate = new Date(data.next_payment_date);
              paymentDate.setHours(0, 0, 0, 0);
              if (paymentDate.getTime() < today.getTime()) {
                isPastDate = true;
              }
            }
            if (!isPastDate || subStatus === 'past_due') {
              monthlyActive = true;
            }
          }

          setIsMonthlyActive(monthlyActive);
          const isEffectivelyActive = hasValidPass || monthlyActive;
          setHasActiveSubOrPass(isEffectivelyActive);

          // 1. Skip redirect if user explicitly clicked 'Renew' or 'Buy Another Pass'
          const bypassActions = ['buy_additional', 'renew', 'upgrade'];
          if (bypassActions.includes(action as string)) {
            if (isMounted) setCheckingAuth(false);
            return;
          }
        }
      } catch (err) {
        // Safe fallback
      } finally {
        if (isMounted) setCheckingAuth(false);
      }
    };

    checkActiveSubscription();
    return () => { isMounted = false; };
  }, [router, action]);

  const handleSignOut = async () => {
    await supabase.auth.signOut();
  };

  // Calendar Helpers
  const handlePrevMonth = () => {
    const now = new Date();
    if (calendarDate.getFullYear() > now.getFullYear() || 
       (calendarDate.getFullYear() === now.getFullYear() && calendarDate.getMonth() > now.getMonth())) {
      setCalendarDate(new Date(calendarDate.getFullYear(), calendarDate.getMonth() - 1, 1));
    }
  };

  const handleNextMonth = () => {
    const now = new Date();
    const maxDate = new Date(now.getFullYear(), now.getMonth() + 2, 1);
    const nextDate = new Date(calendarDate.getFullYear(), calendarDate.getMonth() + 1, 1);
    if (nextDate <= maxDate) {
      setCalendarDate(nextDate);
    }
  };

  const handleSelectCalendarDay = (day: number) => {
    const year = calendarDate.getFullYear();
    const month = calendarDate.getMonth();
    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

    if (dateStr < todayStr) return; // Past date

    // Prevent selecting date already purchased
    if (userPassDates.includes(dateStr)) {
      showModal('Pass Already Active', `You already have an active pass for ${formatDisplayDate(dateStr)}.`);
      return;
    }

    setSelectedDate(dateStr);
    setErrorMessage(null);
  };

 const handleSelectPlan = (plan: PlanKey) => {
    setErrorMessage(null);

    // Prevent day pass selection for monthly members
    if (plan === 'daypass' && isMonthlyActive) {
      showModal(
        'Active Membership Found',
        'You already have an active full gym membership. Day passes are not required while your monthly membership is active.'
      );
      return;
    }

    // Prevent duplicate monthly subscriptions
    if ((plan === 'recovery' || plan === 'yearcontract') && isMonthlyActive) {
      showModal(
        'Active Subscription',
        'You already have an active membership subscription. Duplicate payments are not allowed.'
      );
      return;
    }

    // NEW: Prevent monthly contract selection if user has a day pass for today or the future
    if (plan === 'recovery' || plan === 'yearcontract') {
      const hasValidDayPass = userPassDates.some(dateStr => dateStr >= todayStr);
      if (hasValidDayPass) {
        showModal(
          'Active Day Pass Found',
          'You currently have a valid day pass for today or a future date. Please wait until your pass has been used before purchasing a monthly contract.'
        );
        return;
      }
    }

    setSelectedPlan(plan);
  };

  const handleSubscribe = async () => {
   setErrorMessage(null);

    if (!selectedPlan) {
      setErrorMessage('Please select a membership plan to proceed.');
      return;
    }

    // 1. Guard against duplicate payments / active memberships
    if (selectedPlan === 'daypass') {
      if (isMonthlyActive) {
        showModal(
          'Active Membership Found',
          'You already have an active full gym membership. Day passes are not required.'
        );
        return;
      }

      if (userPassDates.includes(selectedDate)) {
        showModal(
          'Pass Already Active',
          `You already have an active pass for ${formatDisplayDate(selectedDate)}.`
        );
        return;
      }
    } else {
      if (isMonthlyActive) {
        showModal(
          'Active Subscription',
          'You already have an active membership subscription. Duplicate payments are not allowed.'
        );
        return;
      }

      // NEW: Guard against buying a contract while having a valid day pass
      const hasValidDayPass = userPassDates.some(dateStr => dateStr >= todayStr);
      if (hasValidDayPass) {
        showModal(
          'Active Day Pass Found',
          'You currently have a valid day pass for today or a future date. Please wait until your pass has been used before purchasing a monthly contract.'
        );
        return;
      }
    }

    // 2. Validate contract checkbox
    if (selectedPlan === 'recovery' && !acceptedContract) {
      setErrorMessage('You must agree and accept the 12 Month Contract terms and conditions to proceed.');
      return;
    }

    setLoading(true);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      
      if (!session) {
        setErrorMessage('You must be logged in to continue.');
        setLoading(false);
        return;
      }

      // Fetch payment intents from Edge Function
      const response = await fetch('https://kwqiavavreynroruqkvs.supabase.co/functions/v1/create-subscription', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          priceId: PLAN_PRICE_IDS[selectedPlan],
          planType: selectedPlan,
          passDate: selectedDate,
        }),
      });

      const responseJson = await response.json();
      const { 
        paymentIntentClientSecret, 
        setupIntentClientSecret, 
        ephemeralKey, 
        customerId,
        subscriptionId, 
        error 
      } = responseJson;

      if (error) {
        setErrorMessage(error);
        setLoading(false);
        return;
      }

      // Initialize Payment Sheet
      const { error: initError } = await initPaymentSheet({
        merchantDisplayName: 'True Strength',
        customerId: customerId,
        customerEphemeralKeySecret: ephemeralKey,
        paymentIntentClientSecret: paymentIntentClientSecret,
        setupIntentClientSecret: setupIntentClientSecret,
        allowsDelayedPaymentMethods: selectedPlan !== 'yearcontract', 
        returnURL: 'truestrength://stripe-redirect',
        googlePay: {
          merchantCountryCode: 'GB',
          currencyCode: 'GBP',
          testEnv: __DEV__,
        },
        defaultBillingDetails: {
          name: session.user.user_metadata?.full_name || session.user.email?.split('@')[0] || 'Customer',
          email: session.user.email,
        },
      });

      if (initError) {
        setErrorMessage(initError.message);
        setLoading(false);
        return;
      }

      // Present Payment Sheet
      const { error: paymentError } = await presentPaymentSheet();

      if (paymentError) {
        if (paymentError.code !== 'Canceled') {
          setErrorMessage(paymentError.message);
        }
      } else {
        // --- PAYMENT SUCCESSFUL: UPSERT EXISTING INACTIVE ROW ---
        const currentPlan = PLAN_DETAILS[selectedPlan];
        const isDayPass = selectedPlan === 'daypass';
        
       const date = new Date();
        date.setMonth(date.getMonth() + 1); // Automatically handles varying month lengths (28, 30, 31 days)
        const nextPaymentDate = isDayPass ? null : date.toISOString();
        
        // Fetch existing dates so we don't accidentally wipe them when buying a monthly plan
        const { data: existingSub } = await supabase
          .from('user_subscriptions')
          .select('pass_date, pass_dates')
          .eq('user_id', session.user.id)
          .maybeSingle();

        let existingDates: string[] = existingSub?.pass_dates || [];
        if (existingDates.length === 0 && existingSub?.pass_date) {
          existingDates = [existingSub?.pass_date];
        }

        let updatedPassDates = [...existingDates];

        // Append the new date if it's a Day Pass and not already in the array
        if (isDayPass && !updatedPassDates.includes(selectedDate)) {
          updatedPassDates.push(selectedDate);
        }

        const { error: subError } = await supabase
          .from('user_subscriptions')
          .upsert(
            {
              user_id: session.user.id,
              plan_name: currentPlan.name,
              status: 'active',
              has_recovery_access: selectedPlan === 'recovery',
              stripe_customer_id: customerId,
              stripe_subscription_id: subscriptionId || null,
              stripe_price_id: PLAN_PRICE_IDS[selectedPlan],
              updated_at: new Date().toISOString(),
              next_payment_date: nextPaymentDate,
              pass_date: isDayPass ? selectedDate : existingSub?.pass_date || null, 
              pass_dates: updatedPassDates, // <--- SAFELY PRESERVES YOUR FUTURE DAY PASSES
            },
            { onConflict: 'user_id' }
          );

        if (subError) {
          console.error('Failed to update subscription record:', subError.message);
        }

        await supabase
          .from('payment_logs')
          .insert({
            user_id: session.user.id,
            amount: currentPlan.amount,
            status: 'succeeded',
            plan_name: currentPlan.name,
            plan_attempted: currentPlan.name,
            stripe_email: session.user.email || null,
          });

        showModal(
          'Success!',
          isDayPass
            ? `Your Day Pass is active for ${formatDisplayDate(selectedDate)}`
            : 'Your membership is now active.'
        );
        
        setTimeout(() => {
          router.replace('/home');
        }, 1500);
      }
    } catch (err: any) {
      setErrorMessage(err.message || 'Something went wrong.');
    } finally {
      setLoading(false);
    }
  };

  if (checkingAuth) {
    return (
      <View style={[styles.safeArea, { justifyContent: 'center', alignItems: 'center' }]}>
        <ActivityIndicator size="large" color={theme.primary} />
      </View>
    );
  }

  // Generate Calendar Days Grid
  const calYear = calendarDate.getFullYear();
  const calMonth = calendarDate.getMonth();
  const daysInMonth = new Date(calYear, calMonth + 1, 0).getDate();
  const firstDayIndex = new Date(calYear, calMonth, 1).getDay();
  const calendarDays: ({ day: number; dateStr: string } | null)[] = [];

  for (let i = 0; i < firstDayIndex; i++) calendarDays.push(null);
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${calYear}-${String(calMonth + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    calendarDays.push({ day: d, dateStr });
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        
        {/* Top Header Bar with Back Button if user already has an active plan */}
        {hasActiveSubOrPass && (
          <TouchableOpacity 
            style={styles.topBackButton} 
            onPress={() => router.replace('/home')}
            activeOpacity={0.8}
          >
            <Ionicons name="arrow-back" size={20} color={theme.textLight} />
            <Text style={styles.topBackButtonText}>Back to Home</Text>
          </TouchableOpacity>
        )}

        <View style={styles.headerContainer}>
          <Image 
            source={require('../../assets/images/logo.jpeg')} 
            style={styles.logo}
            resizeMode="contain"
          />
          <Text style={styles.pageTitle}>Choose Your Membership</Text>
          <Text style={styles.tagline}>Select your chosen plan and click the purchase membership button below.</Text>
        </View>

        <View style={styles.cardsContainer}>

          {/* 🎟️️ Gym Day Pass (£15) */}
          <TouchableOpacity 
            style={[styles.card, selectedPlan === 'daypass' && styles.selectedCard]}
            onPress={() => handleSelectPlan('daypass')}
            activeOpacity={0.8}
            disabled={loading}
          >
            <View style={styles.cardHeader}>
              <Text style={styles.cardTitle}>{PLAN_DETAILS.daypass.name}</Text>
              <View style={styles.belowHeadingRow}>
                <View style={styles.priceRow}>
                  <Text style={styles.price}>£{PLAN_DETAILS.daypass.amount}</Text>
                  <Text style={styles.pricePeriod}>/{PLAN_DETAILS.daypass.period}</Text>
                </View>
                <View style={[styles.radioButton, selectedPlan === 'daypass' && styles.radioButtonSelected]}>
                  {selectedPlan === 'daypass' && <Ionicons name="checkmark" size={16} color="#FFFFFF" />}
                </View>
              </View>
            </View>
            
            {/* Calendar Selector ONLY when Day Pass is selected */}
            {selectedPlan === 'daypass' && (
              <View style={styles.calendarContainer}>
                <View style={styles.calendarHeader}>
                  <TouchableOpacity onPress={handlePrevMonth} style={styles.calendarNavButton}>
                    <Ionicons name="chevron-back" size={20} color={theme.textLight} />
                  </TouchableOpacity>
                  <Text style={styles.calendarMonthText}>
                    {calendarDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
                  </Text>
                  <TouchableOpacity onPress={handleNextMonth} style={styles.calendarNavButton}>
                    <Ionicons name="chevron-forward" size={20} color={theme.textLight} />
                  </TouchableOpacity>
                </View>

                {/* Day Name Headers */}
                <View style={styles.weekDaysRow}>
                  {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => (
                    <Text key={day} style={styles.weekDayText}>{day}</Text>
                  ))}
                </View>

                {/* Days Grid */}
                <View style={styles.daysGrid}>
                  {calendarDays.map((item, index) => {
                    if (!item) return <View key={`empty-${index}`} style={styles.dayCell} />;

                    const { day, dateStr } = item;
                    const isPast = dateStr < todayStr;
                    const isBooked = userPassDates.includes(dateStr);
                    const isSelected = dateStr === selectedDate;

                    return (
                      <TouchableOpacity
                        key={dateStr}
                        style={styles.dayCell}
                        disabled={isPast}
                        onPress={() => handleSelectCalendarDay(day)}
                      >
                        <View style={[
                          styles.dayInner,
                          isSelected && styles.dayInnerSelected,
                          isBooked && !isSelected && styles.dayInnerBooked,
                          isPast && styles.dayInnerDisabled
                        ]}>
                          <Text style={[
                            styles.dayText,
                            isSelected && styles.dayTextSelected,
                            isPast && styles.dayTextDisabled
                          ]}>
                            {day}
                          </Text>
                          {isBooked && <View style={[styles.bookedDot, isSelected && { backgroundColor: '#FFFFFF' }]} />}
                        </View>
                      </TouchableOpacity>
                    );
                  })}
                </View>

                {/* Legend */}
                <View style={styles.calendarLegend}>
                  <View style={styles.legendItem}>
                    <View style={[styles.legendDot, { backgroundColor: theme.primary }]} />
                    <Text style={styles.legendText}>Selected Date</Text>
                  </View>
                  <View style={styles.legendItem}>
                    <View style={[styles.legendDot, { backgroundColor: '#2A121D', borderWidth: 1, borderColor: theme.primary }]} />
                    <Text style={styles.legendText}>Active Pass</Text>
                  </View>
                </View>
              </View>
            )}
            
            <View style={styles.divider} />
            <View style={styles.featureList}>
              <View style={styles.featureRow}><Ionicons name="checkmark-circle" size={18} color={theme.primary} /><Text style={styles.featureText}>1-Day Unlimited gym access</Text></View>
              <View style={styles.featureRow}><Ionicons name="checkmark-circle" size={18} color={theme.primary} /><Text style={styles.featureText}>Valid only on selected date</Text></View>
            </View>
          </TouchableOpacity>


          {/* Package 1: Pay Monthly (£50) */}
          <TouchableOpacity 
            style={[styles.card, selectedPlan === 'yearcontract' && styles.selectedCard]}
            onPress={() => handleSelectPlan('yearcontract')}
            activeOpacity={0.8}
            disabled={loading}
          >
            <View style={styles.cardHeader}>
              <Text style={styles.cardTitle}>{PLAN_DETAILS.yearcontract.name}</Text>
              <View style={styles.belowHeadingRow}>
                <View style={styles.priceRow}>
                  <Text style={styles.price}>£{PLAN_DETAILS.yearcontract.amount}</Text>
                  <Text style={styles.pricePeriod}>/{PLAN_DETAILS.yearcontract.period}</Text>
                </View>
                <View style={[styles.radioButton, selectedPlan === 'yearcontract' && styles.radioButtonSelected]}>
                  {selectedPlan === 'yearcontract' && <Ionicons name="checkmark" size={16} color="#FFFFFF" />}
                </View>
              </View>
            </View>
            <View style={styles.divider} />
            <View style={styles.featureList}>
              <View style={styles.featureRow}><Ionicons name="checkmark-circle" size={18} color={theme.primary} /><Text style={styles.featureText}>Unlimited gym access</Text></View>
              <View style={styles.featureRow}><Ionicons name="checkmark-circle" size={18} color={theme.primary} /><Text style={styles.featureText}>Ice Bath</Text></View>
              <View style={styles.featureRow}><Ionicons name="checkmark-circle" size={18} color={theme.primary} /><Text style={styles.featureText}>Sauna</Text></View>
              <View style={styles.featureRow}><Ionicons name="checkmark-circle" size={18} color={theme.primary} /><Text style={styles.featureText}>On-going support</Text></View>
            </View>
          </TouchableOpacity>

          {/* Package 2: Gym + Recovery (£40/month) - 12 Month Contract */}
          <TouchableOpacity 
            style={[styles.card, selectedPlan === 'recovery' && styles.selectedCard]}
            onPress={() => handleSelectPlan('recovery')}
            activeOpacity={0.8}
            disabled={loading}
          >
            <View style={styles.popularBadge}>
              <Text style={styles.popularBadgeText}>MOST POPULAR</Text>
            </View>
            <View style={styles.cardHeader}>
              <Text style={styles.cardTitle}>{PLAN_DETAILS.recovery.name}</Text>
              <View style={styles.belowHeadingRow}>
                <View style={styles.priceRow}>
                  <Text style={styles.price}>£{PLAN_DETAILS.recovery.amount}</Text>
                  <Text style={styles.pricePeriod}>/{PLAN_DETAILS.recovery.period}</Text>
                </View>
                <View style={[styles.radioButton, selectedPlan === 'recovery' && styles.radioButtonSelected]}>
                  {selectedPlan === 'recovery' && <Ionicons name="checkmark" size={16} color="#FFFFFF" />}
                </View>
              </View>
            </View>
            <View style={styles.divider} />
            <View style={styles.featureList}>
              <View style={styles.featureRow}><Ionicons name="checkmark-circle" size={18} color={theme.primary} /><Text style={styles.featureText}>Unlimited gym access</Text></View>
              <View style={styles.featureRow}><Ionicons name="checkmark-circle" size={18} color={theme.primary} /><Text style={styles.featureText}>Ice Bath</Text></View>
              <View style={styles.featureRow}><Ionicons name="checkmark-circle" size={18} color={theme.primary} /><Text style={styles.featureText}>Sauna</Text></View>
              <View style={styles.featureRow}><Ionicons name="checkmark-circle" size={18} color={theme.primary} /><Text style={styles.featureText}>On-going support</Text></View>
            </View>
            <Text style={styles.cardTermsNote}>* Terms & Conditions apply</Text>
          </TouchableOpacity>

        </View>

        <View style={styles.footerContainer}>
          
          {selectedPlan === 'recovery' && (
            <TouchableOpacity 
              style={styles.checkboxContainer} 
              activeOpacity={0.8}
              onPress={() => {
                setAcceptedContract(!acceptedContract);
                setErrorMessage(null);
              }}
            >
              <View style={[styles.checkbox, acceptedContract && styles.checkboxChecked]}>
                {acceptedContract && <Ionicons name="checkmark" size={14} color="#FFFFFF" />}
              </View>
              <Text style={styles.checkboxLabel}>
                I agree and accept the{' '}
                <Text 
                  style={styles.linkText}
                  onPress={(e) => {
                    e.stopPropagation();
                    Linking.openURL('https://truestrengthandfitness.co.uk/terms-and-conditions/');
                  }}
                >
                  12 Month Contract terms and conditions
                </Text>
              </Text>
            </TouchableOpacity>
          )}

          {errorMessage && (
            <View style={styles.errorBox}>
              <Ionicons name="alert-circle" size={18} color={theme.error} />
              <Text style={styles.errorText}>{errorMessage}</Text>
            </View>
          )}

          <TouchableOpacity 
            style={styles.continueButton} 
            onPress={handleSubscribe}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <Text style={styles.continueButtonText}>
              {!selectedPlan 
                ? 'Select a Membership Plan' 
                : selectedPlan === 'daypass' 
                ? `Buy Pass for ${formatDisplayDate(selectedDate)}` 
                : 'Purchase Membership'}
            </Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity style={styles.signOutButton} onPress={handleSignOut} disabled={loading}>
            <Ionicons name="log-out-outline" size={18} color={theme.textMuted} style={{ marginRight: 6 }} />
            <Text style={styles.signOutButtonText}>Sign Out</Text>
          </TouchableOpacity>
        </View>

      </ScrollView>

      {/* 🔔 Custom Modal Alert */}
      <Modal
        visible={modalConfig.visible}
        transparent
        animationType="fade"
        onRequestClose={hideModal}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContainer}>
            <View style={styles.modalIconContainer}>
              <Ionicons name="alert-circle" size={36} color={theme.primary} />
            </View>
            <Text style={styles.modalTitle}>{modalConfig.title}</Text>
            <Text style={styles.modalMessage}>{modalConfig.message}</Text>
            <TouchableOpacity style={styles.modalButton} onPress={hideModal} activeOpacity={0.8}>
              <Text style={styles.modalButtonText}>Got it</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: theme.background },
  scrollContent: { paddingHorizontal: 24, paddingVertical: 20 },
  topBackButton: { flexDirection: 'row', alignItems: 'center', marginBottom: 16, gap: 8 },
  topBackButtonText: { color: theme.textLight, fontSize: 15, fontWeight: '600' },
  headerContainer: { alignItems: 'center', marginBottom: 24 },
  logo: { width: 400, height: 165, marginBottom: 8 },
  pageTitle: { fontSize: 26, color: theme.textLight, fontWeight: 'bold', marginBottom: 6, textAlign: 'center' },
  tagline: { fontSize: 14, color: theme.textLight, textAlign: 'center', opacity: 0.85 },
  cardsContainer: { gap: 16, marginBottom: 28 },
  card: { backgroundColor: theme.surface, borderRadius: 16, padding: 20, borderWidth: 1.5, borderColor: theme.border, position: 'relative' },
  selectedCard: { borderColor: theme.primary, backgroundColor: '#161214' },
  popularBadge: { position: 'absolute', top: -12, right: 20, backgroundColor: theme.primary, paddingHorizontal: 12, paddingVertical: 4, borderRadius: 12 },
  popularBadgeText: { color: '#FFFFFF', fontSize: 10, fontWeight: 'bold', letterSpacing: 0.5 },
  cardHeader: { width: '100%' },
  cardTitle: { color: theme.textLight, fontSize: 18, fontWeight: 'bold', width: '100%' },
  belowHeadingRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 12 },
  priceRow: { flexDirection: 'row', alignItems: 'baseline' },
  price: { color: theme.primary, fontSize: 28, fontWeight: 'bold' },
  pricePeriod: { color: theme.textMuted, fontSize: 14, marginLeft: 4 },
  radioButton: { width: 24, height: 24, borderRadius: 12, borderWidth: 2, borderColor: theme.border, justifyContent: 'center', alignItems: 'center' },
  radioButtonSelected: { backgroundColor: theme.primary, borderColor: theme.primary },
  
  // Calendar View Styles
  calendarContainer: { marginTop: 18, backgroundColor: '#18181A', borderRadius: 16, padding: 14, borderWidth: 1, borderColor: theme.border },
  calendarHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  calendarMonthText: { color: theme.textLight, fontSize: 15, fontWeight: 'bold' },
  calendarNavButton: { padding: 4 },
  weekDaysRow: { flexDirection: 'row', justifyContent: 'space-around', marginBottom: 8, borderBottomWidth: 1, borderBottomColor: theme.border, paddingBottom: 8 },
  weekDayText: { color: theme.textMuted, fontSize: 12, fontWeight: '600', width: 36, textAlign: 'center' },
  daysGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  dayCell: { width: '14.28%', aspectRatio: 1, justifyContent: 'center', alignItems: 'center', padding: 2 },
  dayInner: { width: 32, height: 32, borderRadius: 16, justifyContent: 'center', alignItems: 'center', position: 'relative' },
  dayInnerSelected: { backgroundColor: theme.primary },
  dayInnerBooked: { backgroundColor: '#2A121D', borderWidth: 1, borderColor: theme.primary },
  dayInnerDisabled: { opacity: 0.25 },
  dayText: { color: theme.textLight, fontSize: 13, fontWeight: '500' },
  dayTextSelected: { color: '#FFFFFF', fontWeight: 'bold' },
  dayTextDisabled: { color: theme.textMuted },
  bookedDot: { position: 'absolute', bottom: 3, width: 4, height: 4, borderRadius: 2, backgroundColor: theme.primary },
  calendarLegend: { flexDirection: 'row', justifyContent: 'center', gap: 20, marginTop: 12, paddingTop: 10, borderTopWidth: 1, borderTopColor: theme.border },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendDot: { width: 10, height: 10, borderRadius: 5 },
  legendText: { color: theme.textMuted, fontSize: 12 },

  divider: { height: 1, backgroundColor: theme.border, marginVertical: 16 },
  featureList: { gap: 10 },
  featureRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  featureText: { color: theme.textLight, fontSize: 14 },
  cardTermsNote: { color: theme.textMuted, fontSize: 12, marginTop: 12, fontStyle: 'italic' },
  footerContainer: { gap: 16, alignItems: 'center' },
  checkboxContainer: { flexDirection: 'row', alignItems: 'flex-start', width: '100%', paddingHorizontal: 4 },
  checkbox: { width: 20, height: 20, borderRadius: 6, borderWidth: 1.5, borderColor: theme.border, backgroundColor: theme.surface, justifyContent: 'center', alignItems: 'center', marginRight: 12, marginTop: 2 },
  checkboxChecked: { backgroundColor: theme.primary, borderColor: theme.primary },
  checkboxLabel: { flex: 1, color: theme.textMuted, fontSize: 13, lineHeight: 18 },
  linkText: { color: theme.primary, textDecorationLine: 'underline' },
  errorBox: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(255, 59, 48, 0.12)', borderWidth: 1, borderColor: 'rgba(255, 59, 48, 0.3)', borderRadius: 12, padding: 14, width: '100%', gap: 10 },
  errorText: { color: theme.error, fontSize: 13, flex: 1, lineHeight: 18 },
  continueButton: { 
    backgroundColor: theme.primary, 
    height: 56, 
    borderRadius: 28, 
    justifyContent: 'center', 
    alignItems: 'center', 
    width: '100%', 
    ...Platform.select({
      web: { boxShadow: `0px 4px 8px ${theme.primary}66` },
      default: { shadowColor: theme.primary, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.4, shadowRadius: 8, elevation: 5 }
    }),
  },
  continueButtonText: { color: '#FFFFFF', fontWeight: 'bold', fontSize: 16 },
  signOutButton: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10 },
  signOutButtonText: { color: theme.textMuted, fontSize: 14, fontWeight: '600' },

  // Modal Popup Styles
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0, 0, 0, 0.75)', justifyContent: 'center', alignItems: 'center', padding: 24 },
  modalContainer: { backgroundColor: theme.surface, borderRadius: 20, padding: 24, width: '100%', maxWidth: 380, alignItems: 'center', borderWidth: 1, borderColor: theme.border },
  modalIconContainer: { width: 60, height: 60, borderRadius: 30, backgroundColor: 'rgba(255, 10, 122, 0.12)', justifyContent: 'center', alignItems: 'center', marginBottom: 16 },
  modalTitle: { fontSize: 20, fontWeight: 'bold', color: theme.textLight, marginBottom: 10, textAlign: 'center' },
  modalMessage: { fontSize: 14, color: theme.textMuted, textAlign: 'center', lineHeight: 20, marginBottom: 24 },
  modalButton: { backgroundColor: theme.primary, paddingVertical: 14, paddingHorizontal: 32, borderRadius: 25, width: '100%', alignItems: 'center' },
  modalButtonText: { color: '#FFFFFF', fontSize: 15, fontWeight: 'bold' },
});