import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage'; // Ensure imported
import { useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  Image,
  KeyboardAvoidingView,
  Linking,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View
} from 'react-native';
import { signIn, supabase } from '../services/supabase';

const theme = {
  background: '#050505',
  surface: '#121212',
  primary: '#FF0A7A', 
  textLight: '#FFFFFF',
  textMuted: '#8E8E93',
  border: '#2C2C2E',
  error: '#FF3B30', 
  success: '#34C759', 
};


let lastProcessedUrl: string | null = null;
export default function AuthScreen() {
  const router = useRouter();
 
  // App Navigation States
  const [isLogin, setIsLogin] = useState(true);
  const [accountCreated, setAccountCreated] = useState(false); 
  const [isResettingPassword, setIsResettingPassword] = useState(false); // NEW STATE
  

  const [loading, setLoading] = useState(false);
  
  // Inline message states
  const [errorText, setErrorText] = useState<string | null>(null);
  const [successText, setSuccessText] = useState<string | null>(null);

  // Form Fields
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [acceptedPrivacy, setAcceptedPrivacy] = useState(false);

  // --- ADD THESE NEW STATES ---
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const appState = React.useRef(AppState.currentState);


  const isNetworkError = (msg: string) => {
    const lower = msg.toLowerCase();
    return lower.includes('fetch failed') || lower.includes('network request failed') || lower.includes('unable to resolve host');
  };

  // --- ADD THIS EFFECT TO CLEAR PASSWORDS WHEN APP LEAVES FOREGROUND ---
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextAppState) => {
      if (
        appState.current.match(/active/) &&
        (nextAppState === 'inactive' || nextAppState === 'background')
      ) {
        setPassword('');
        setConfirmPassword('');
      }
      appState.current = nextAppState;
    });

    return () => {
      subscription.remove();
    };
  }, []);

// Listen for Supabase auth state changes and manual Deep Links
  useEffect(() => {
    // 1. Standard Auth Listener (Single source of truth for recovery state)
    const { data: authListener } = supabase.auth.onAuthStateChange(async (event, session) => {
      console.log('Auth event:', event);
      if (event === 'USER_UPDATED') {
        setAccountCreated(false);
        setIsLogin(true);
        setErrorText(null);
        setSuccessText('Your account has been verified. You can now sign in.');
      } 
      else if (event === 'PASSWORD_RECOVERY') {
        await AsyncStorage.setItem('is_password_recovery', 'true');
        setAccountCreated(false);
        setIsResettingPassword(true);
        setErrorText(null);
        setSuccessText('Link verified. Please enter your new password below.');
      }
    });

    // 2. Streamlined Deep Link Interceptor
    const processDeepLink = async (url: string | null) => {
      if (!url) return;
      
      console.log('Incoming Deep Link URL:', url);

      try {
        setLoading(true);

        // Handle Token Hash / OTP Recovery Flow
        if (url.includes('token_hash=') || (url.includes('token=') && url.includes('type=recovery'))) {
          const match = url.match(/[?&]token_hash=([^&]+)/) || url.match(/[?&]token=([^&]+)/);
          if (match && match[1]) {
            const tokenHash = decodeURIComponent(match[1]);
            const { error } = await supabase.auth.verifyOtp({
              token_hash: tokenHash,
              type: 'recovery',
            });
            
            if (error) {
              // If expired or already used, wipe session and force clean login
              await supabase.auth.signOut();
              setIsResettingPassword(false);
              setIsLogin(true);
              setPassword('');
              setConfirmPassword('');
              setErrorText('This password reset link has expired or has already been used. Please request a new one.');
            }
            // Note: If successful, onAuthStateChange ('PASSWORD_RECOVERY') handles opening the form automatically!
          }
        }
        // Handle PKCE Code Flow if applicable
        else if (url.includes('code=')) {
          const codeMatch = url.match(/[?&]code=([^&]+)/);
          if (codeMatch && codeMatch[1]) {
            const code = decodeURIComponent(codeMatch[1]);
            const { error } = await supabase.auth.exchangeCodeForSession(code);
            if (error) {
              await supabase.auth.signOut();
              setIsResettingPassword(false);
              setIsLogin(true);
              setErrorText('Password reset session error. Please request a new link.');
            }
          }
        }
      } catch (err: any) {
        setErrorText('Deep link error: ' + err.message);
      } finally {
        setLoading(false);
      }
    };

    // Handle deep link when app opens from a fully closed state
    Linking.getInitialURL().then((url) => {
      if (url && url !== lastProcessedUrl) {
        lastProcessedUrl = url;
        processDeepLink(url);
      }
    });

    // Handle deep link when app is already running in the background
    const subscription = Linking.addEventListener('url', (event) => {
      if (event.url && event.url !== lastProcessedUrl) {
        lastProcessedUrl = event.url;
        processDeepLink(event.url);
      }
    });

    return () => {
      authListener.subscription.unsubscribe();
      subscription.remove();
    };
  }, []);


  // Helper to format missing fields array cleanly
  const formatFieldsList = (fields: string[]) => {
    if (fields.length === 1) return fields[0];
    if (fields.length === 2) return `${fields[0]} and ${fields[1]}`;
    return `${fields.slice(0, -1).join(', ')}, and ${fields[fields.length - 1]}`;
  };

const handleForgotPassword = async () => {
  setErrorText(null);
  setSuccessText(null);

  const cleanEmail = email.trim();
  if (!cleanEmail) {
    setErrorText('Please enter your email address to reset your password.');
    return;
  }

  setLoading(true);
  try {
    const { error } = await supabase.auth.resetPasswordForEmail(cleanEmail, {
      redirectTo: 'truestrength://',
    });
    setLoading(false);

    if (error) {
      if (isNetworkError(error.message)) {
        setErrorText('Unable to connect to the network. Please check your internet connection and try again.');
      } else {
        setErrorText(error.message);
      }
    } else {
      setPassword(''); 
      setSuccessText('Password reset instructions have been sent to your email.');
    }
  } catch (err: any) {
    setLoading(false);
    setErrorText('Unable to connect to the network. Please check your internet connection and try again.');
  }
};

  const handleUpdatePassword = async () => {
    setErrorText(null);
    setSuccessText(null);

    if (!password || !confirmPassword) {
      setErrorText('Please enter and confirm your new password.');
      return;
    }

    if (password !== confirmPassword) {
      setErrorText('Passwords do not match.');
      return;
    }

    setLoading(true);
    const { error } = await supabase.auth.updateUser({
      password: password
    });
    setLoading(false);

    if (error) {
      setErrorText(error.message);
    } else {
      // ✅ SUCCESS: Now clean up session and recovery flag
      await supabase.auth.signOut();
      await AsyncStorage.removeItem('is_password_recovery');
      
      setIsResettingPassword(false);
      setPassword('');
      setConfirmPassword('');
      setIsLogin(true);
      setSuccessText('Password updated successfully! You can now log in.');
    }
  };

  const handleAuthentication = async () => {
    // Clear any previous messages on new submission attempt
    setErrorText(null);
    setSuccessText(null);
    
    const cleanEmail = email.trim();

    // 1. Dynamic Missing Fields Check
    const missingFields: string[] = [];
    
    if (!isLogin && !fullName.trim()) missingFields.push('Full Name');
    if (!cleanEmail) missingFields.push('Email');
    if (!password) missingFields.push('Password');
    if (!isLogin && !confirmPassword) missingFields.push('Confirm Password');

    if (missingFields.length > 0) {
      const fieldsString = formatFieldsList(missingFields);
      setErrorText(`Please enter your ${fieldsString}.`);
      return;
    }

    // 2. Password Match Check (Sign Up only)
    if (!isLogin && password !== confirmPassword) {
      setErrorText('Passwords do not match.');
      return;
    }

    // 3. Privacy Policy Agreement Check (Sign Up only)
    if (!isLogin && !acceptedPrivacy) {
      setErrorText('You must agree to the True Strength & Fitness Privacy Policy to create an account.');
      return;
    }

    // 4. Strict Email Formatting Check
    const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
    if (!emailRegex.test(cleanEmail)) {
      setErrorText('Please enter a valid email address with a proper domain suffix (e.g. name@example.com).');
      return;
    }

    setLoading(true);

    try {
      if (isLogin) {
        // PRE-CHECK: Securely check if email exists using our database RPC
        const { data: emailExists, error: checkError } = await supabase
          .rpc('check_email_exists', { lookup_email: cleanEmail });

        // If the RPC explicitly returns false, block login and show custom error
        if (!checkError && emailExists === false) {
          setLoading(false);
          setErrorText("Email doesn't exist, please create your account first.");
          return;
        }

        // Proceed with actual login
        const { user, error } = await signIn(cleanEmail, password);
        
        if (error) {
          setLoading(false);
         if (isNetworkError(error.message)) {
            setErrorText('Unable to connect to the network. Please check your internet connection and try again.');
        } else if (error.message.includes('Email not confirmed')) {
          setErrorText('unverified');
        } else if (error.message.includes('Invalid login credentials') || error.message.includes('invalid') || error.message.includes('password')) {
            setErrorText('invalid_credentials');
          } else {
            setErrorText(error.message);
          }
        } else if (user) {
          // Check profile verification and role status from database
          const { data: profile, error: profileError } = await supabase
            .from('profiles')
            .select('is_verified, role')
            .eq('id', user.id)
            .single();

          if (profileError || !profile?.is_verified) {
            await supabase.auth.signOut(); 
            setLoading(false);
            setAccountCreated(true); 
            return;
          }

          if (profile?.role && profile.role.toLowerCase() === 'admin') {
            setLoading(false);
            router.replace('/home'); 
            return;
          }

          // Check subscription status
          const { data: sub, error: subError } = await supabase
            .from('user_subscriptions')
            .select('status, plan_name, next_payment_date')
            .eq('user_id', user.id)
            .maybeSingle();

          const allowedHomeStatuses = ['active', 'cancellation_requested', 'past_due'];
          const isAllowedHome = !subError && sub && allowedHomeStatuses.includes(sub.status);

          setLoading(false);

          if (isAllowedHome) {
            router.replace('/home'); 
          } else {
            router.replace('/membership');
          }
        }
      } else {
  // SIGN UP FLOW
  const { data: emailExists, error: checkError } = await supabase
    .rpc('check_email_exists', { lookup_email: cleanEmail });

  if (checkError) {
    if (isNetworkError(checkError.message)) {
      setLoading(false);
      setErrorText('Unable to connect to the network. Please check your internet connection and try again.');
      return;
    }
  }

  if (!checkError && emailExists === true) {
    setLoading(false);
    setErrorText('already_registered');
    return;
  }

  const { data: authData, error } = await supabase.auth.signUp({
    email: cleanEmail,
    password: password,
    options: {
      data: {
        full_name: fullName.trim(),
      },
      emailRedirectTo: 'truestrength://email-address-confirmed/',
    }
  });
  
  const user = authData?.user;
  
  if (error) {
    setLoading(false);
    if (isNetworkError(error.message)) {
      setErrorText('Unable to connect to the network. Please check your internet connection and try again.');
    } else if (error.message.includes('security purposes') || error.message.includes('rate limit')) {
      setErrorText('already_registered');
    } else {
      setErrorText(error.message);
    }
  } else if (user) {
          await supabase.from('profiles').upsert({
            id: user.id,
            email: cleanEmail,
            full_name: fullName.trim(),
            is_verified: false,
            role: 'user'
          }, { onConflict: 'id' });

          await supabase.from('user_subscriptions').upsert({
            user_id: user.id,
            status: 'inactive'
          }, { onConflict: 'user_id' });

          setLoading(false);
          setIsLogin(true);
          setAccountCreated(true); 
        } else {
          setLoading(false);
        }
      }
    } catch (err: any) {
      setLoading(false);
      setErrorText('Unable to connect to the network. Please check your internet connection and try again.');
    }
  };

  const handleResendEmail = async () => {
    setErrorText(null);
    setSuccessText(null);

    if (!email.trim()) {
      setErrorText('No email address found. Please enter your email in the login form.');
      return;
    }
  
    setLoading(true);
    const { error } = await supabase.auth.resend({
      type: 'signup',
      email: email.trim(),
      options: {
        emailRedirectTo: 'truestrength://email-address-confirmed/',
      }
    });
    setLoading(false);

    if (error) {
      setErrorText(error.message);
    } else {
      setSuccessText('Verification email resent. Please check your inbox or spam/junk folder.');
    }
  };

  const openMailApp = async () => {
    setErrorText(null);
    setSuccessText(null);
    
    try {
      if (Platform.OS === 'ios') {
        const mailScheme = 'message://';
        const supported = await Linking.canOpenURL(mailScheme);
        if (supported) {
          await Linking.openURL(mailScheme);
          return;
        }
      } else {
        for (const scheme of ['googlegmail://', 'ms-outlook://']) {
          try {
            const supported = await Linking.canOpenURL(scheme);
            if (supported) {
              await Linking.openURL(scheme);
              return;
            }
          } catch (e) {}
        }
      }
      await Linking.openURL('mailto:');
    } catch (error) {
      setErrorText('Could not open the mail application.');
    }
  };

  return (
    <KeyboardAvoidingView 
      style={styles.container} 
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView 
        contentContainerStyle={styles.scrollContainer}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.formContainer}>
          
          <View style={styles.headerContainer}>
            <Image 
              source={require('../../assets/images/logo.jpeg')} 
              style={styles.logo}
              resizeMode="contain"
            />
          </View>

          {isResettingPassword ? (
            // 🔥 NEW: RESET PASSWORD UI VIEW
            <>
              <Text style={styles.pageTitle}>Update Password</Text>
              <Text style={styles.tagline}>Create a new, secure password.</Text>

              {successText !== null && (
                <View style={styles.successBox}>
                  <Text style={styles.successMessageText}>{successText}</Text>
                </View>
              )}
              
              {errorText !== null && (
                <View style={styles.errorBox}>
                  <Text style={styles.errorText}>{errorText}</Text>
                </View>
              )}

             <View style={styles.inputContainer}>
                <Ionicons name="lock-closed-outline" size={20} color={theme.textMuted} style={styles.inputIcon} />
                <TextInput
                  style={styles.inputWithIcon}
                  placeholder="New Password"
                  placeholderTextColor={theme.textMuted}
                  value={password}
                  onChangeText={setPassword}
                  secureTextEntry={!showPassword}
                />
                <TouchableOpacity onPress={() => setShowPassword(!showPassword)}>
                  <Ionicons name={showPassword ? 'eye-outline' : 'eye-off-outline'} size={20} color={theme.textMuted} />
                </TouchableOpacity>
              </View>

              <View style={styles.inputContainer}>
                <Ionicons name="lock-closed-outline" size={20} color={theme.textMuted} style={styles.inputIcon} />
                <TextInput
                  style={styles.inputWithIcon}
                  placeholder="Confirm New Password"
                  placeholderTextColor={theme.textMuted}
                  value={confirmPassword}
                  onChangeText={setConfirmPassword}
                  secureTextEntry={!showConfirmPassword}
                />
                <TouchableOpacity onPress={() => setShowConfirmPassword(!showConfirmPassword)}>
                  <Ionicons name={showConfirmPassword ? 'eye-outline' : 'eye-off-outline'} size={20} color={theme.textMuted} />
                </TouchableOpacity>
              </View>

              <TouchableOpacity 
                style={styles.button} 
                onPress={handleUpdatePassword}
                disabled={loading}
              >
                {loading ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.buttonText}>Save New Password</Text>}
              </TouchableOpacity>

              <TouchableOpacity 
    style={[styles.secondaryButton, { marginTop: 24, width: '100%' }]} 
    onPress={async () => {
      await supabase.auth.signOut();
      await AsyncStorage.removeItem('is_password_recovery'); // <-- Add this here too
      
      setIsResettingPassword(false);
      setIsLogin(true);
      setPassword('');
      setConfirmPassword('');
      setErrorText(null);
      setSuccessText(null);
    }}
  >
    <Text style={styles.secondaryButtonText}>Cancel</Text>
  </TouchableOpacity>
            </>
          ) : accountCreated ? (
            // SUCCESS / VERIFICATION VIEW
            <View style={styles.successContainer}>
              <View style={styles.successIconCircle}>
                <Ionicons name="mail-open-outline" size={40} color={theme.primary} />
              </View>
              <Text style={styles.pageTitle}>Account Created</Text>

              {successText !== null && (
                <View style={styles.successBox}>
                  <Text style={styles.successMessageText}>{successText}</Text>
                </View>
              )}
              
              {errorText !== null && (
                <View style={styles.errorBox}>
                  <Text style={styles.errorText}>{errorText}</Text>
                </View>
              )}

              <Text style={styles.successTagline}>
                Your account is not yet active, please confirm your email address by clicking the link in the verification email we sent you. If you haven't received it, please check your spam/junk folder.
              </Text>

              <TouchableOpacity style={styles.button} onPress={openMailApp}>
                <Text style={styles.buttonText}>Open Mail App</Text>
              </TouchableOpacity>

              <TouchableOpacity 
                style={[styles.secondaryButton, { marginTop: 12 }]} 
                onPress={() => {
                  setAccountCreated(false);
                  setIsLogin(true);
                  setErrorText(null);
                  setSuccessText(null);
                }}
              >
                <Text style={styles.secondaryButtonText}>Back to Login</Text>
              </TouchableOpacity>
            </View>
          ) : (
            // STANDARD AUTH VIEW (LOGIN / SIGN UP)
            <>
              <Text style={styles.pageTitle}>
                {isLogin ? 'Welcome Back' : 'Join True Strength & Fitness'}
              </Text>
              <Text style={styles.tagline}>
                {isLogin ? 'Log in to your account' : 'Start your journey today.'}
              </Text>

              {successText !== null && (
                <View style={styles.successBox}>
                  <Text style={styles.successMessageText}>{successText}</Text>
                </View>
              )}

              {errorText === 'unverified' && (
                <View style={styles.errorBox}>
                  <Text style={styles.errorText}>
                    Your email is not verified. Please check your inbox or{' '}
                    <Text style={styles.resendLink} onPress={handleResendEmail}>
                      click here to resend the link
                    </Text>.
                  </Text>
                </View>
              )}

              {errorText === 'already_registered' && (
                <View style={styles.errorBox}>
                  <Text style={styles.errorText}>
                    This email address has already been registered.
                  </Text>
                </View>
              )}

              {errorText === 'invalid_credentials' && (
                <View style={styles.errorBox}>
                  <Text style={styles.errorText}>
                    Invalid email or password.{' '}
                    <Text style={styles.resendLink} onPress={handleForgotPassword}>
                      Forgot password?
                    </Text>
                  </Text>
                </View>
              )}

              {errorText !== null && !['unverified', 'already_registered', 'invalid_credentials'].includes(errorText) && (
                <View style={styles.errorBox}>
                  <Text style={styles.errorText}>{errorText}</Text>
                </View>
              )}

              {!isLogin && (
                <View style={styles.inputContainer}>
                  <Ionicons name="person-outline" size={20} color={theme.textMuted} style={styles.inputIcon} />
                  <TextInput
                    style={styles.inputWithIcon}
                    placeholder="Full Name"
                    placeholderTextColor={theme.textMuted}
                    value={fullName}
                    onChangeText={setFullName}
                    autoCapitalize="words"
                  />
                </View>
              )}

              <View style={styles.inputContainer}>
                <Ionicons name="mail-outline" size={20} color={theme.textMuted} style={styles.inputIcon} />
                <TextInput
                  style={styles.inputWithIcon}
                  placeholder="Email Address"
                  placeholderTextColor={theme.textMuted}
                  value={email}
                  onChangeText={setEmail}
                  autoCapitalize="none"
                  keyboardType="email-address"
                />
              </View>

             <View style={styles.inputContainer}>
                <Ionicons name="lock-closed-outline" size={20} color={theme.textMuted} style={styles.inputIcon} />
                <TextInput
                  style={styles.inputWithIcon}
                  placeholder="Password"
                  placeholderTextColor={theme.textMuted}
                  value={password}
                  onChangeText={setPassword}
                  secureTextEntry={!showPassword}
                />
                <TouchableOpacity onPress={() => setShowPassword(!showPassword)}>
                  <Ionicons name={showPassword ? 'eye-outline' : 'eye-off-outline'} size={20} color={theme.textMuted} />
                </TouchableOpacity>
              </View>

              {!isLogin && (
                <View style={styles.inputContainer}>
                  <Ionicons name="lock-closed-outline" size={20} color={theme.textMuted} style={styles.inputIcon} />
                  <TextInput
                    style={styles.inputWithIcon}
                    placeholder="Confirm Password"
                    placeholderTextColor={theme.textMuted}
                    value={confirmPassword}
                    onChangeText={setConfirmPassword}
                    secureTextEntry={!showConfirmPassword}
                  />
                  <TouchableOpacity onPress={() => setShowConfirmPassword(!showConfirmPassword)}>
                    <Ionicons name={showConfirmPassword ? 'eye-outline' : 'eye-off-outline'} size={20} color={theme.textMuted} />
                  </TouchableOpacity>
                </View>
              )}

              {!isLogin && (
                <TouchableOpacity 
                  style={styles.checkboxContainer} 
                  activeOpacity={0.8}
                  onPress={() => setAcceptedPrivacy(!acceptedPrivacy)}
                >
                  <View style={[styles.checkbox, acceptedPrivacy && styles.checkboxChecked]}>
                    {acceptedPrivacy && <Ionicons name="checkmark" size={14} color="#FFFFFF" />}
                  </View>
                  <Text style={styles.checkboxLabel}>
                    I agree to the True Strength & Fitness{' '}
                    <Text 
                      style={styles.policyLink} 
                      onPress={() => Linking.openURL('https://truestrengthandfitness.co.uk/privacy-policy')}
                    >
                      Privacy Policy
                    </Text>
                  </Text>
                </TouchableOpacity>
              )}

              <TouchableOpacity 
                style={styles.button} 
                onPress={handleAuthentication}
                disabled={loading}
              >
                {loading ? (
                  <ActivityIndicator color="#FFFFFF" />
                ) : (
                  <Text style={styles.buttonText}>
                    {isLogin ? 'Sign In' : 'Create Account'}
                  </Text>
                )}
              </TouchableOpacity>

              <View style={styles.dividerContainer}>
                <View style={styles.dividerLine} />
                <Text style={styles.dividerText}>OR</Text>
                <View style={styles.dividerLine} />
              </View>

              <TouchableOpacity 
                onPress={() => {
                  setIsLogin(!isLogin);
                  setErrorText(null); 
                  setSuccessText(null);
                }} 
                style={styles.secondaryButton}
              >
                <Text style={styles.secondaryButtonText}>
                  {isLogin ? 'Create Account' : 'Back to Sign In'}
                </Text>
              </TouchableOpacity>

              {isLogin && (
                <TouchableOpacity style={styles.forgotPassword} onPress={handleForgotPassword}>
                  <Text style={styles.forgotPasswordText}>Forgot Password?</Text>
                </TouchableOpacity>
              )}
            </>
          )}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.background },
  scrollContainer: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: 24, paddingVertical: 40, paddingBottom: 60 },
  formContainer: { width: '100%' },
  headerContainer: { alignItems: 'center', marginBottom: 24 },
  logo: { width: 320, height: 130 },
  pageTitle: { fontSize: 28, color: theme.textLight, fontWeight: 'bold', marginBottom: 8, textAlign: 'center' },
  tagline: { fontSize: 14, color: theme.textMuted, marginBottom: 28, textAlign: 'center' },
  errorBox: { backgroundColor: 'rgba(255, 59, 48, 0.1)', borderWidth: 1, borderColor: 'rgba(255, 59, 48, 0.3)', borderRadius: 12, padding: 12, marginBottom: 16, width: '100%' },
  errorText: { color: theme.error, fontSize: 14, textAlign: 'center', lineHeight: 20 },
  successBox: { backgroundColor: 'rgba(52, 199, 89, 0.1)', borderWidth: 1, borderColor: 'rgba(52, 199, 89, 0.3)', borderRadius: 12, padding: 12, marginBottom: 16, width: '100%' },
  successMessageText: { color: theme.success, fontSize: 14, textAlign: 'center', lineHeight: 20, fontWeight: '500' },
  resendLink: { color: theme.primary, fontWeight: 'bold', textDecorationLine: 'underline' },
  successContainer: { alignItems: 'center', paddingVertical: 10, width: '100%' },
  successIconCircle: { width: 80, height: 80, borderRadius: 40, backgroundColor: 'rgba(255, 10, 122, 0.1)', borderWidth: 1.5, borderColor: theme.primary, justifyContent: 'center', alignItems: 'center', marginBottom: 20 },
  successTagline: { fontSize: 15, color: theme.textMuted, marginBottom: 32, textAlign: 'center', lineHeight: 22 },
  inputContainer: { flexDirection: 'row', alignItems: 'center', backgroundColor: theme.surface, height: 56, borderRadius: 12, paddingHorizontal: 16, marginBottom: 16, borderWidth: 1, borderColor: theme.border },
  inputIcon: { marginRight: 12 },
  inputWithIcon: { flex: 1, color: theme.textLight, fontSize: 16 },
  checkboxContainer: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 20, paddingHorizontal: 4 },
  checkbox: { width: 20, height: 20, borderRadius: 6, borderWidth: 1.5, borderColor: theme.border, backgroundColor: theme.surface, justifyContent: 'center', alignItems: 'center', marginRight: 12, marginTop: 2 },
  checkboxChecked: { backgroundColor: theme.primary, borderColor: theme.primary },
  checkboxLabel: { flex: 1, color: theme.textMuted, fontSize: 13, lineHeight: 18 },
  policyLink: { color: theme.primary, fontWeight: '600', textDecorationLine: 'underline' },
  button: { 
    backgroundColor: theme.primary, 
    height: 56, 
    borderRadius: 28, 
    justifyContent: 'center', 
    alignItems: 'center', 
    marginTop: 4, 
    width: '100%', 
    ...Platform.select({
      web: {
        boxShadow: `0px 4px 8px ${theme.primary}66`,
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
  buttonText: { color: '#FFFFFF', fontWeight: 'bold', fontSize: 16, letterSpacing: 0.5 },
  dividerContainer: { flexDirection: 'row', alignItems: 'center', marginVertical: 20 },
  dividerLine: { flex: 1, height: 1, backgroundColor: theme.border },
  dividerText: { color: theme.textMuted, paddingHorizontal: 16, fontSize: 12, fontWeight: '600' },
  secondaryButton: { height: 56, borderRadius: 28, justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: theme.border, backgroundColor: 'transparent', width: '100%' },
  secondaryButtonText: { color: theme.textLight, fontWeight: '600', fontSize: 16 },
  forgotPassword: { marginTop: 16, alignItems: 'center' },
  forgotPasswordText: { color: theme.textMuted, fontSize: 14 }
});