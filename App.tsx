import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useEffect, useState } from 'react';
import { initializeDatabase } from './src/db/schema';
import { seedDatabase } from './src/db/seed';
import HomeScreen from './src/screens/HomeScreen';
import AccountsScreen from './src/screens/AccountsScreen';
import ChatScreen from './src/screens/ChatScreen';

const Stack = createNativeStackNavigator();

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
    <NavigationContainer>
      <Stack.Navigator initialRouteName="Home" screenOptions={{
        headerStyle: { backgroundColor: '#1E1E1E' },
        headerTintColor: '#fff',
        headerTitleStyle: { fontWeight: 'bold' },
        contentStyle: { backgroundColor: '#121212' }
      }}>
        <Stack.Screen name="Home" component={HomeScreen} options={{ title: 'Muffin AI' }} />
        <Stack.Screen name="Accounts" component={AccountsScreen} options={{ title: 'Accounts' }} />
        <Stack.Screen name="Chat" component={ChatScreen} options={{ title: 'Ask Muffin' }} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
