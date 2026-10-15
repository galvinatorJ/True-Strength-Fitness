import { useRouter } from 'expo-router';
import React, { useEffect } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

export default function EmailConfirmedScreen() {
  const router = useRouter();

  useEffect(() => {
    const timer = setTimeout(() => {
      router.replace('/');
    }, 2000);
    return () => clearTimeout(timer);
  }, []);

  return (
    <View style={styles.container}>
      <ActivityIndicator size="large" color="#FF0A7A" style={{ marginBottom: 16 }} />
      <Text style={styles.title}>Email Verified!</Text>
      <Text style={styles.subtitle}>Your account is confirmed. Redirecting to login...</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#050505', justifyContent: 'center', alignItems: 'center', padding: 24 },
  title: { color: '#FFFFFF', fontSize: 24, fontWeight: 'bold', marginBottom: 8, textAlign: 'center' },
  subtitle: { color: '#8E8E93', fontSize: 14, textAlign: 'center' }
});