import React from 'react';
import {StatusBar, StyleSheet} from 'react-native';
import {SafeAreaProvider, SafeAreaView} from 'react-native-safe-area-context';

import './src/helpers';
import {Geofencing} from './src/Geofencing';

function App(): React.JSX.Element {
  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.shell} edges={['top', 'left', 'right']}>
        <StatusBar barStyle="light-content" backgroundColor="#0f172a" />
        <Geofencing />
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  shell: {
    flex: 1,
    backgroundColor: '#0f172a',
    paddingHorizontal: 16,
  },
});

export default App;
