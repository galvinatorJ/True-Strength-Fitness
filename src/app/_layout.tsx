import AsyncStorage from '@react-native-async-storage/async-storage'; // <-- IMPORT ASYNCSTORAGE
import { Stack, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { StripeProvider } from '../services/stripeWrapper';
import { supabase } from '../services/supabase';

export default function RootLayout() {
  const router = useRouter();
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    let isMounted = true;

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (!isMounted) return;

      // 🔥 CRITICAL: Check if we are in a password recovery flow
      const isRecovery = await AsyncStorage.getItem('is_password_recovery');
      if (event === 'PASSWORD_RECOVERY' || isRecovery === 'true') {
        setTimeout(() => { if (isMounted) setIsReady(true); }, 100);
        return; // Stops _layout from redirecting to home!
      }

      if (!session) {
        router.replace('/');
        setTimeout(() => { if (isMounted) setIsReady(true); }, 100);
        return;
      }

      // 1. Check user profile role first
      const { data: profile } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', session.user.id)
        .maybeSingle();

      const userRole = profile?.role ? profile.role.toLowerCase().trim() : 'member';

      // 2. If user is an admin, skip subscription requirements and go straight home
      if (userRole === 'admin') {
        router.replace('/(tabs)/home');
        setTimeout(() => { if (isMounted) setIsReady(true); }, 100);
        return;
      }
      
      // 3. Otherwise, check if regular user subscription exists/is active
      const { data, error } = await supabase
        .from('user_subscriptions')
        .select('status')
        .eq('user_id', session.user.id)
        .maybeSingle();

      if (!isMounted) return;

      const allowedHomeStatuses = ['active', 'cancellation_requested', 'past_due'];

      if (!data || !allowedHomeStatuses.includes(data.status)) {
        router.replace('/membership');
      } else {
        router.replace('/(tabs)/home');
      }

      setTimeout(() => {
        if (isMounted) setIsReady(true);
      }, 100);
    });

    return () => {
      isMounted = false;
      subscription.unsubscribe();
    };
  }, []);

  return (
    <StripeProvider
      publishableKey="pk_live_51TwIva7RMmHfKOtj1crMx6Q7MFmkWHv3kcbYevZkqDBY4bnOCdyrGsZEX62cGeVlXrxNeE5FiGa9ixArgWiErHJq00gkyh02y3"
      merchantIdentifier="merchant.com.truestrength"
    >
      <StatusBar style="light" />
      
      <View style={styles.container}>
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: '#050505' },
          }}
        >
          <Stack.Screen name="index" />
          <Stack.Screen 
            name="membership" 
            options={{ gestureEnabled: false }} 
          />
          <Stack.Screen 
            name="(tabs)" 
            options={{ gestureEnabled: false }} 
          />
        </Stack>

        {!isReady && (
          <View style={styles.loaderOverlay}>
            <ActivityIndicator size="large" color="#FF0A7A" />
          </View>
        )}
      </View>
    </StripeProvider>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#050505',
  },
  loaderOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#050505',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 1000,
  },
});