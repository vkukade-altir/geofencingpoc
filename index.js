/**
 * @format
 */

import {AppRegistry} from 'react-native';
import App from './App';
import {name as appName} from './app.json';
import BackgroundGeolocation from './src/react-native-background-geolocation';
// import BackgroundFetch from 'react-native-background-fetch';

AppRegistry.registerComponent(appName, () => App);

/**
 * BackgroundGeolocation Headless JS task.
 * For more information, see:  https://github.com/transistorsoft/react-native-background-geolocation/wiki/Android-Headless-Mode
 */
const BackgroundGeolocationHeadlessTask = async event => {
  let params = event.params;
  /*
  // Type of params
  {
   "action": "ENTER" | "EXIT",
   "identifier":"Station 2",
   "location":{
      "activity":{
         "confidence":100,
         "type":"still"
      },
      "age":85,
      "battery":{
         "is_charging":false,
         "level":1
      },
      "coords":{
         "accuracy":5,
         "age":86,
         "altitude":-0.1,
         "altitude_accuracy":0.4,
         "ellipsoidal_altitude":-0.1,
         "heading":112.1,
         "heading_accuracy":30,
         "latitude":52.3300959,
         "longitude":5.0362416,
         "speed":59.48,
         "speed_accuracy":0.5
      },
      "event":"geofence",
      "extras":{
         
      },
      "geofence":{
         "action":"ENTER",
         "identifier":"Station 2",
         "timestamp":"2024-07-07T16:15:11.296Z"
      },
      "is_moving":true,
      "odometer":5599.2998046875,
      "timestamp":"2024-07-07T16:15:11.210Z",
      "uuid":"c2069194-70c2-4c39-955a-fad6b4bdcdb3"
   },
   "timestamp":"2024-07-07T16:15:11.296Z"
}
  */
  console.log('[BackgroundGeolocation HeadlessTask] -', event.name, params);
  switch (event.name) {
    case 'geofence':
      //in case user enters of exit geofence
      //get current location of user if required
      //   const location = await BackgroundGeolocation.getCurrentPosition({
      //     samples: 2,
      //     persist: true,
      //     extras: {
      //       event: 'geofence',
      //       headless: true,
      //     },
      //   });
      //   console.log(
      //     '[BackgroundGeolocation HeadlessTask] - getCurrentPosition:',
      //     location,
      //   );
      //call the api to pass this data to the backend
      let data = {
        action: params?.action || '',
        identifier: params?.identifier || '',
        lattitude: params?.location?.coords?.latitude || '',
        longitude: params?.location?.coords?.longitude || '',
      };
      if (data.action === 'ENTER') {
        console.log('✅✅ Geofence Enter', data.identifier);
      } else if (data.action === 'EXIT') {
        console.log('❌❌ Geofence Exit', data.identifier);
      }
      break;
  }
};

BackgroundGeolocation.registerHeadlessTask(BackgroundGeolocationHeadlessTask);

/**
 * BackgroundFetch Headless JS Task.
 * For more information, see:  https://github.com/transistorsoft/react-native-background-fetch#config-boolean-enableheadless-false
 */
const BackgroundFetchHeadlessTask = async event => {
  console.log('[BackgroundFetch HeadlessTask] start', event.taskId);

  if (event.taskId == 'react-native-background-fetch') {
    const location = await BackgroundGeolocation.getCurrentPosition({
      samples: 2,
      extras: {
        event: 'background-fetch',
        headless: true,
      },
    });
    console.log('[BackgroundFetch] getCurrentPosition: ', location);

    /*
        await BackgroundFetch.scheduleTask({
          taskId: 'com.transistorsoft.customtask',
          delay: 5000,
          stopOnTerminate: false,
          enableHeadless: true,
          forceAlarmManager: true
        });
        */
  }
  // Important:  await asychronous tasks when using HeadlessJS.
  /* DISABLED
    const location = await BackgroundGeolocation.getCurrentPosition({persist: false, samples: 1});
    console.log('- current position: ', location);
    // Required:  Signal to native code that your task is complete.
    // If you don't do this, your app could be terminated and/or assigned
    // battery-blame for consuming too much time in background.
    */
  console.log('[BackgroundFetch HeadlessTask] finished');

  // BackgroundFetch.finish(event.taskId);
};

// Register your BackgroundFetch HeadlessTask
// BackgroundFetch.registerHeadlessTask(BackgroundFetchHeadlessTask);
