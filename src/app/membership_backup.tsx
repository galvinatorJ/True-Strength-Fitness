import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    Image,
    Linking,
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
  recovery: 'price_1TwL9F9nla8sR27vfPqFjnVm', // Full Gym Use - 12 Month Contract
  yearcontract: 'price_1U1lzl9nla8sR27vjOZPWodX', // Full Gym Use - Pay Monthly
};

// 👇 PLAN METADATA 👇
const PLAN_DETAILS = {
  recovery: { name: 'Full Gym Use - 12 Month Contract', amount: 40, recurring: true, period: 'month' },
  yearcontract: { name: 'Full Gym Use - Pay Monthly', amount: 50, recurring: true, period: 'month' },
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

export default function MembershipScreen() {
  const router = useRouter();

  const [selectedPlan, setSelectedPlan] = useState<PlanKey>('recovery');
  const [acceptedContract, setAcceptedContract] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [checkingAuth, setCheckingAuth] = useState(true);
  const { initPaymentSheet, presentPaymentSheet } = useStripe();

  // 👇 AUTO-BYPASS CHECK ON MOUNT 👇
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
          .select('status, next_payment_date')
          .eq('user_id', session.user.id)
          .single();

       const allowedHomeStatuses = ['active', 'cancellation_requested', 'past_due'];

        if (data && allowedHomeStatuses.includes(data.status)) {
          router.replace('/home');
          return;
        }
      } catch (err) {
        // Safe fallback: proceed to show membership options if query fails/no row
      } finally {
        if (isMounted) setCheckingAuth(false);
      }
    };

    checkActiveSubscription();
    return () => { isMounted = false; };
  }, [router]);

  const handleSignOut = async () => {
    await supabase.auth.signOut();
  };

  const handleSubscribe = async () => {
    // Clear previous error message
    setErrorMessage(null);

    // Validate 12-month contract agreement if selected plan is recovery
    if (selectedPlan === 'recovery' && !acceptedContract) {
      setErrorMessage('You must agree and accept the 12 Month Contract terms and conditions to proceed.');
      return;
    }

    setLoading(true);

    try {
      // 1. Get current session
      const { data: { session } } = await supabase.auth.getSession();
      
      if (!session) {
        setErrorMessage('You must be logged in to continue.');
        setLoading(false);
        return;
      }

      // 2. Fetch secrets from your Supabase Edge Function
      const response = await fetch('https://kwqiavavreynroruqkvs.supabase.co/functions/v1/create-subscription', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          priceId: PLAN_PRICE_IDS[selectedPlan],
          planType: selectedPlan,
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

      // 3. Initialize Stripe Payment Sheet
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

      // 4. Open Payment Sheet
      const { error: paymentError } = await presentPaymentSheet();

      if (paymentError) {
        if (paymentError.code !== 'Canceled') {
          setErrorMessage(paymentError.message);
        }
      } else {
        // --- PAYMENT SUCCESSFUL: UPSERT EXISTING INACTIVE ROW ---
        const currentPlan = PLAN_DETAILS[selectedPlan];
        
        const date = new Date();
        date.setDate(date.getDate() + 30);
        const nextPaymentDate = date.toISOString();

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
            },
            { onConflict: 'user_id' }
          );

        if (subError) {
          console.error('Failed to update subscription record:', subError.message, subError.details);
        }

        const { error: logError } = await supabase
          .from('payment_logs')
          .insert({
            user_id: session.user.id,
            amount: currentPlan.amount,
            status: 'succeeded',
            plan_name: currentPlan.name,
            plan_attempted: currentPlan.name,
            stripe_email: session.user.email || null,
          });

        if (logError) {
          console.error('Failed to insert payment log:', logError.message, logError.details);
        }

        Alert.alert('Success!', 'Your membership is now active.');
        router.replace('/home'); 
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

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        
        {/* Logo Area */}
        <View style={styles.headerContainer}>
          <Image 
            source={require('../../assets/images/logo.jpeg')} 
            style={styles.logo}
            resizeMode="contain"
          />
          <Text style={styles.pageTitle}>Choose Your Membership</Text>
          <Text style={styles.tagline}>Select your chosen plan and click the purchase membership button below.</Text>
        </View>

        {/* Membership Options */}
        <View style={styles.cardsContainer}>

          {/* Package 1: Monthly Rolling (£50) */}
          <TouchableOpacity 
            style={[styles.card, selectedPlan === 'yearcontract' && styles.selectedCard]}
            onPress={() => {
              setSelectedPlan('yearcontract');
              setErrorMessage(null);
            }}
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
            onPress={() => {
              setSelectedPlan('recovery');
              setErrorMessage(null);
            }}
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

        {/* Primary Action & Sign Out */}
        <View style={styles.footerContainer}>
          
          {/* Mandatory Checkbox for 12 Month Contract */}
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

          {/* In-App Error Box */}
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
                Purchase Membership
              </Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity style={styles.signOutButton} onPress={handleSignOut} disabled={loading}>
            <Ionicons name="log-out-outline" size={18} color={theme.textMuted} style={{ marginRight: 6 }} />
            <Text style={styles.signOutButtonText}>Sign Out</Text>
          </TouchableOpacity>
        </View>

      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: theme.background },
  scrollContent: { paddingHorizontal: 24, paddingVertical: 20 },
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
      web: {
        boxShadow: `0px 4px 8px ${theme.primary}66`, // '66' adds 40% opacity to your hex color
      },
      default: {
        shadowColor: theme.primary, 
        shadowOffset: { width: 0, height: 4 }, 
        shadowOpacity: 0.4, 
        shadowRadius: 8, 
        elevation: 5 
      }
    }),
  },
  
  
  continueButtonText: { color: '#FFFFFF', fontWeight: 'bold', fontSize: 16 },
  signOutButton: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10 },
  signOutButtonText: { color: theme.textMuted, fontSize: 14, fontWeight: '600' },
});