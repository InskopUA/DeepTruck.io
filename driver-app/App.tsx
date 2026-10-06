import React from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { DriverScreen } from './src/DriverScreen';
import { useDriver } from './src/useDriver';

export default function App() {
  const driver = useDriver();
  return <SafeAreaProvider><DriverScreen driver={driver}/></SafeAreaProvider>;
}
