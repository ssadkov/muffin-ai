import { NavigationContainer, DefaultTheme } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { initializeDatabase } from './src/db/schema';
import { seedDatabase } from './src/db/seed';
import HomeScreen from './src/screens/HomeScreen';
import AccountsScreen from './src/screens/AccountsScreen';
import ChatScreen from './src/screens/ChatScreen';
import { colors } from './src/theme/theme';

const Tab = createBottomTabNavigator();

const navTheme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    background: colors.bg,
    card: colors.surface,
    text: colors.textPrimary,
    border: colors.border,
    primary: colors.accent,
  },
};

const TAB_ICONS: Record<string, { active: keyof typeof Ionicons.glyphMap; inactive: keyof typeof Ionicons.glyphMap }> = {
  Home: { active: 'home', inactive: 'home-outline' },
  Accounts: { active: 'wallet', inactive: 'wallet-outline' },
  Chat: { active: 'sparkles', inactive: 'sparkles-outline' },
};

export default function App() {
  const [isDbReady, setDbReady] = useState(false);

  useEffect(() => {
    // Initialize SQLite database
    try {
      initializeDatabase();
      seedDatabase();
      setDbReady(true);
    } catch (e) {
      console.error('Failed to initialize database', e);
    }
  }, []);

  if (!isDbReady) {
    return null; // Return a loading spinner here in a real app
  }

  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <NavigationContainer theme={navTheme}>
        <Tab.Navigator
          initialRouteName="Home"
          screenOptions={({ route }) => ({
            headerStyle: {
              backgroundColor: colors.bg,
              elevation: 0,
              shadowOpacity: 0,
              borderBottomWidth: 0,
            },
            headerTintColor: colors.textPrimary,
            headerTitleStyle: { fontWeight: '800', fontSize: 18 },
            sceneContainerStyle: { backgroundColor: colors.bg },
            tabBarStyle: {
              backgroundColor: colors.surface,
              borderTopColor: colors.border,
              borderTopWidth: 1,
              height: 64,
              paddingTop: 6,
              paddingBottom: 10,
            },
            tabBarActiveTintColor: colors.accent,
            tabBarInactiveTintColor: colors.textMuted,
            tabBarLabelStyle: { fontSize: 11, fontWeight: '600' },
            tabBarIcon: ({ color, size, focused }) => {
              const set = TAB_ICONS[route.name] ?? TAB_ICONS.Home;
              return (
                <Ionicons
                  name={focused ? set.active : set.inactive}
                  size={size ?? 22}
                  color={color}
                />
              );
            },
          })}
        >
          <Tab.Screen name="Home" component={HomeScreen} options={{ title: 'Muffin AI' }} />
          <Tab.Screen name="Accounts" component={AccountsScreen} options={{ title: 'Accounts' }} />
          <Tab.Screen name="Chat" component={ChatScreen} options={{ title: 'Ask Muffin' }} />
        </Tab.Navigator>
      </NavigationContainer>
    </SafeAreaProvider>
  );
}
