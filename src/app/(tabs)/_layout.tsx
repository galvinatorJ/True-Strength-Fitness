import { Ionicons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { supabase } from '../../services/supabase'; // Adjust path if needed based on your file structure

export default function TabLayout() {
  const [isAdmin, setIsAdmin] = useState<boolean>(false);

  useEffect(() => {
    const checkUserRole = async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
          const { data: profile } = await supabase
            .from('profiles')
            .select('role')
            .eq('id', user.id)
            .maybeSingle();

          const dbRole = profile?.role?.toLowerCase().trim();
          const metaRole = user.user_metadata?.role?.toLowerCase().trim();

          if (dbRole === 'admin' || metaRole === 'admin') {
            setIsAdmin(true);
          } else {
            setIsAdmin(false);
          }
        }
      } catch (error) {
        console.warn('Error fetching role in layout:', error);
      }
    };

    checkUserRole();

    // Listen for auth state changes (login/logout)
    const { data: authListener } = supabase.auth.onAuthStateChange(() => {
      checkUserRole();
    });

    return () => {
      authListener?.subscription.unsubscribe();
    };
  }, []);

  return (
    <Tabs
      screenOptions={{ 
        headerShown: false,
        tabBarStyle: { 
          backgroundColor: '#050505', 
          borderTopColor: '#2C2C2E',
          display: isAdmin ? 'none' : 'flex', // Dynamically hides tab bar for Admins
        },
        tabBarActiveTintColor: '#E91E63', // True Strength Hot Pink
        tabBarInactiveTintColor: '#8E8E93', // Muted gray
      }}
    >
      <Tabs.Screen 
        name="home" 
        options={{ 
          title: 'Home', 
          tabBarIcon: ({ color }) => <Ionicons name="home" size={24} color={color} /> 
        }} 
      />    

      <Tabs.Screen 
        name="qr" 
        options={{ 
          title: 'Access ID', 
          tabBarIcon: ({ color }) => <Ionicons name="qr-code-outline" size={24} color={color} /> 
        }} 
      />
      
      <Tabs.Screen 
        name="account" 
        options={{ 
          title: 'Account', 
          tabBarIcon: ({ color }) => <Ionicons name="person" size={24} color={color} /> 
        }} 
      />
    </Tabs>
  );
}