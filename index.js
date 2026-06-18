/**
 * @format
 */

import {AppRegistry} from 'react-native';
import App from './App';
import {name as appName} from './app.json';
import BackgroundGeolocation from './src/react-native-background-geolocation';
import BackgroundFetch from 'react-native-background-fetch';
import {
  processGeofenceEventHeadless,
  processLocationHeadless,
  processHeartbeatHeadless,
  initHeadlessMode,
  isTrackingActive,
} from './src/amenityTracker';
import {getStationById} from './src/stationData';
import {log} from './src/logger';

// Config profiles for dynamic switching
const CONFIG_BATTERY_EFFICIENT = {
  distanceFilter: 10,
  stopTimeout: 1,
  heartbeatInterval: 60,
};

const CONFIG_STATION_TRACKING = {
  distanceFilter: 2,
  stopTimeout: 1,
  heartbeatInterval: 15,
};

AppRegistry.registerComponent(appName, () => App);

/**
 * BackgroundGeolocation Headless JS task.
 * This runs when the app is KILLED/QUIT on Android.
 * On iOS, the app is "suspended" but still in memory, so headless is less critical.
 *
 * IMPORTANT: This task handles:
 * 1. geofence - Station enter/exit events
 * 2. location - Location updates for amenity tracking
 * 3. motionchange - Activity changes (optional)
 *
 * For more information, see:
 * https://github.com/transistorsoft/react-native-background-geolocation/wiki/Android-Headless-Mode
 */
const BackgroundGeolocationHeadlessTask = async event => {
  const params = event.params;
  const eventName = event.name;

  log('[HeadlessTask] Event received:', eventName);

  // Initialize headless mode - restore state from persistence
  // This is important for recovering tracking state after app is killed
  initHeadlessMode();

  switch (eventName) {
    case 'geofence':
      await handleGeofenceHeadless(params);
      break;

    case 'location':
      await handleLocationHeadless(params);
      break;

    case 'motionchange':
      handleMotionChangeHeadless(params);
      break;

    case 'heartbeat':
      await handleHeartbeatHeadless(params);
      break;

    default:
      log('[HeadlessTask] Unhandled event:', eventName, params);
  }
};

/**
 * Handle geofence events in headless mode
 * This is triggered when user enters/exits a station geofence
 */
async function handleGeofenceHeadless(params) {
  const action = params?.action; // 'ENTER' or 'EXIT'
  const identifier = params?.identifier; // Station ID
  const location = params?.location;

  log('[HeadlessTask:Geofence]', action, identifier);

  if (!action || !identifier) {
    log('[HeadlessTask:Geofence] Missing action or identifier');
    return;
  }

  // Check if this is a station we're tracking
  const station = getStationById(identifier);
  if (!station) {
    log('[HeadlessTask:Geofence] Unknown station:', identifier);
    return;
  }

  const locationUpdate = location?.coords
    ? {
        latitude: location.coords.latitude,
        longitude: location.coords.longitude,
        accuracy: location.coords.accuracy || 10,
        timestamp: location.timestamp,
      }
    : {latitude: 0, longitude: 0, accuracy: 100};

  if (action === 'ENTER') {
    log('[HeadlessTask] Station ENTER:', identifier);

    // Initialize amenity tracking for this station
    processGeofenceEventHeadless('ENTER', identifier, locationUpdate);

    // Switch to aggressive tracking config for amenity detection
    log('[HeadlessTask:Config] Switching to station tracking mode');
    await BackgroundGeolocation.setConfig({
      distanceFilter: CONFIG_STATION_TRACKING.distanceFilter,
      stopTimeout: CONFIG_STATION_TRACKING.stopTimeout,
      heartbeatInterval: CONFIG_STATION_TRACKING.heartbeatInterval,
    });

    // Start more frequent location updates for amenity tracking
    try {
      const currentPos = await BackgroundGeolocation.getCurrentPosition({
        samples: 1,
        persist: true,
        timeout: 30,
        extras: {
          event: 'station-enter-headless',
          stationId: identifier,
        },
      });
      log('[HeadlessTask] Got position after station enter:', {
        lat: currentPos.coords.latitude,
        lon: currentPos.coords.longitude,
      });

      processLocationHeadless({
        latitude: currentPos.coords.latitude,
        longitude: currentPos.coords.longitude,
        accuracy: currentPos.coords.accuracy || 10,
        timestamp: currentPos.timestamp,
      });
    } catch (error) {
      log('[HeadlessTask] Failed to get position:', error);
    }

    // API call placeholder for station entry
    const apiData = {
      event: 'STATION_ENTER',
      stationId: identifier,
      latitude: locationUpdate.latitude,
      longitude: locationUpdate.longitude,
      timestamp: new Date().toISOString(),
    };
    log('[HeadlessTask] Station enter data for API:', apiData);
  } else if (action === 'EXIT') {
    log('[HeadlessTask] Station EXIT:', identifier);

    // Stop amenity tracking for this station (will emit pending EXIT events)
    processGeofenceEventHeadless('EXIT', identifier, locationUpdate);

    // Switch back to battery-efficient config
    log('[HeadlessTask:Config] Switching to battery-efficient mode');
    await BackgroundGeolocation.setConfig({
      distanceFilter: CONFIG_BATTERY_EFFICIENT.distanceFilter,
      stopTimeout: CONFIG_BATTERY_EFFICIENT.stopTimeout,
      heartbeatInterval: CONFIG_BATTERY_EFFICIENT.heartbeatInterval,
    });

    // API call placeholder for station exit
    const apiData = {
      event: 'STATION_EXIT',
      stationId: identifier,
      latitude: locationUpdate.latitude,
      longitude: locationUpdate.longitude,
      timestamp: new Date().toISOString(),
    };
    log('[HeadlessTask] Station exit data for API:', apiData);
  }
}

/**
 * Handle location updates in headless mode
 * This is triggered on each location update when tracking is active
 */
async function handleLocationHeadless(params) {
  const coords = params?.coords;
  if (!coords) {
    log('[HeadlessTask:Location] No coords in params');
    return;
  }

  log(
    '[HeadlessTask:Location]',
    coords.latitude,
    coords.longitude,
    coords.accuracy,
  );

  // Process location for amenity tracking
  const events = processLocationHeadless({
    latitude: coords.latitude,
    longitude: coords.longitude,
    accuracy: coords.accuracy || 10,
    timestamp: params.timestamp,
  });

  // Log any amenity events that were triggered
  for (const event of events) {
    log(
      '[HeadlessTask:Amenity]',
      event.type,
      event.amenityName,
      'at',
      event.stationId,
    );

    // API call placeholder for amenity events
    const apiData = {
      event: event.type,
      stationId: event.stationId,
      amenityId: event.amenityId,
      amenityName: event.amenityName,
      latitude: event.location.latitude,
      longitude: event.location.longitude,
      accuracy: event.location.accuracy,
      timestamp: event.timestamp,
    };
    log('[HeadlessTask] Amenity event data for API:', apiData);
  }
}

/**
 * Handle motion change in headless mode
 */
function handleMotionChangeHeadless(params) {
  const isMoving = params?.isMoving;
  const location = params?.location;

  log('[HeadlessTask:Motion] isMoving=', isMoving);

  // When user stops moving, we might want to get more accurate position
  // for amenity detection
  if (!isMoving && location?.coords) {
    const events = processLocationHeadless({
      latitude: location.coords.latitude,
      longitude: location.coords.longitude,
      accuracy: location.coords.accuracy || 10,
      timestamp: location.timestamp,
    });
    for (const event of events) {
      log(
        '[HeadlessTask:Motion:Amenity]',
        event.type,
        event.amenityName,
      );
    }
  }
}

/**
 * Handle heartbeat events in headless mode
 * This is triggered periodically when user is stationary (if configured)
 * Critical for amenity detection when user is not moving inside a station
 */
async function handleHeartbeatHeadless(params) {
  log('[HeadlessTask:Heartbeat] Received heartbeat');

  // Only process if we're inside a station
  if (!isTrackingActive()) {
    log('[HeadlessTask:Heartbeat] Not inside station, skipping');
    return;
  }

  // Get current position for amenity tracking when stationary
  try {
    const location = await BackgroundGeolocation.getCurrentPosition({
      samples: 1,
      persist: true,
      timeout: 30,
      extras: {
        event: 'heartbeat-headless',
      },
    });

    log(
      '[HeadlessTask:Heartbeat] Got position:',
      location.coords.latitude,
      location.coords.longitude,
    );

    // Process for amenity tracking
    const events = processHeartbeatHeadless({
      latitude: location.coords.latitude,
      longitude: location.coords.longitude,
      accuracy: location.coords.accuracy || 10,
      timestamp: location.timestamp,
    });

    // Log any amenity events
    for (const event of events) {
      log(
        '[HeadlessTask:Heartbeat:Amenity]',
        event.type,
        event.amenityName,
      );
    }
  } catch (error) {
    log('[HeadlessTask:Heartbeat] Failed to get position:', error);
  }
}

// Register the headless task
BackgroundGeolocation.registerHeadlessTask(BackgroundGeolocationHeadlessTask);

/**
 * BackgroundFetch Headless JS Task.
 * For more information, see:  https://github.com/transistorsoft/react-native-background-fetch#config-boolean-enableheadless-false
 */
const BackgroundFetchHeadlessTask = async event => {
  log('[BackgroundFetch HeadlessTask] start', event.taskId);

  if (event.taskId == 'react-native-background-fetch') {
    const location = await BackgroundGeolocation.getCurrentPosition({
      samples: 2,
      extras: {
        event: 'background-fetch',
        headless: true,
      },
    });
    log('[BackgroundFetch] getCurrentPosition: ', location);

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
    log('- current position: ', location);
    // Required:  Signal to native code that your task is complete.
    // If you don't do this, your app could be terminated and/or assigned
    // battery-blame for consuming too much time in background.
    */
  log('[BackgroundFetch HeadlessTask] finished');

  BackgroundFetch.finish(event.taskId);
};

// Register your BackgroundFetch HeadlessTask
BackgroundFetch.registerHeadlessTask(BackgroundFetchHeadlessTask);
