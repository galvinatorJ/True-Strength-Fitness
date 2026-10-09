import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import { AppState, Platform } from 'react-native';
import 'react-native-url-polyfill/auto';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL || '';
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || '';

// SSR-safe storage adapter that prevents "window is not defined" on Web SSR
const customStorage = {
  getItem: async (key: string) => {
    if (Platform.OS === 'web' && typeof window === 'undefined') {
      return null;
    }
    return AsyncStorage.getItem(key);
  },
  setItem: async (key: string, value: string) => {
    if (Platform.OS === 'web' && typeof window === 'undefined') {
      return;
    }
    return AsyncStorage.setItem(key, value);
  },
  removeItem: async (key: string) => {
    if (Platform.OS === 'web' && typeof window === 'undefined') {
      return;
    }
    return AsyncStorage.removeItem(key);
  },
};

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: customStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});

if (Platform.OS !== 'web') {
  AppState.addEventListener('change', (state) => {
    if (state === 'active') {
      supabase.auth.startAutoRefresh();
    } else {
      supabase.auth.stopAutoRefresh();
    }
  });
}

// ============= AUTHENTICATION =============

export const signUp = async (email: string, password: string, fullName: string) => {
  try {
    const { data, error } = await supabase.auth.signUp({ 
      email, 
      password,
      options: {
        data: {
          full_name: fullName,
        }
      }
    });
    
    if (error || !data.user) return { user: null, error };

    await supabase.from('user_subscriptions').insert([
      { user_id: data.user.id, status: 'inactive', plan_name: 'Gym Access', has_recovery_access: false }
    ]);

    return { user: data.user, error: null };
  } catch (err) {
    return { user: null, error: err as Error };
  }
};

export const signIn = async (email: string, password: string) => {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  return { user: data?.user, session: data?.session, error };
};

export const signOut = async () => {
  return await supabase.auth.signOut();
};

// ============= USER PROFILE & SUBSCRIPTIONS =============

export const getUserProfile = async (userId: string) => {
  const { data, error } = await supabase.from('profiles').select('*').eq('id', userId).single();
  return { data, error };
};

export const getUserSubscription = async (userId: string) => {
  const { data, error } = await supabase.from('user_subscriptions').select('*').eq('user_id', userId).single();
  return { data, error };
};

// ============= PAYMENTS & LOGGING =============

export const logPaymentAttempt = async (userId: string, planName: string, status: 'success' | 'failed', errorMessage?: string) => {
  const { error } = await supabase.from('payment_logs').insert([
    { 
      user_id: userId, 
      plan_attempted: planName, 
      status, 
      error_message: errorMessage || null 
    }
  ]);

  if (error) {
    console.error('Failed to log payment attempt:', error);
  }
};

export const processSubscriptionPayment = async (userId: string, planName: string, hasRecovery: boolean, cardLast4: string = '4242') => {
  const nextPaymentDate = new Date();
  nextPaymentDate.setMonth(nextPaymentDate.getMonth() + 1);

  const { data, error } = await supabase
    .from('user_subscriptions')
    .update({
      plan_name: planName,
      has_recovery_access: hasRecovery,
      status: 'active',
      next_payment_date: nextPaymentDate.toISOString(),
      card_last4: cardLast4,
      updated_at: new Date().toISOString()
    })
    .eq('user_id', userId)
    .select();

  if (!error) {
    await logPaymentAttempt(userId, planName, 'success');
  }

  return { data, error };
};

// ============= GYM CHECK-INS =============

export const checkInGym = async (userId: string) => {
  const { data, error } = await supabase
    .from('gym_check_ins')
    .insert([{ user_id: userId, check_in_time: new Date().toISOString() }])
    .select();
  return { data, error };
};

export const getLatestCheckIn = async (userId: string) => {
  const { data, error } = await supabase
    .from('gym_check_ins')
    .select('check_in_time')
    .eq('user_id', userId)
    .order('check_in_time', { ascending: false })
    .limit(1)
    .single();
  return { data, error };
};

export default supabase;