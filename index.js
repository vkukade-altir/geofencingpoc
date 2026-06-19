/**
 * @format
 */

import {AppRegistry} from 'react-native';
import App from './App';
import {name as appName} from './app.json';
import BackgroundGeolocation from './src/react-native-background-geolocation';
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
  preventSuspend: true,
};

const CONFIG_STATION_TRACKING = {
  distanceFilter: 2,
  stopTimeout: 1,
  heartbeatInterval: 15,
  preventSuspend: true,
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
  const action = params?.action;
  const identifier = params?.identifier;
  const location = params?.location;

  if (!action || !identifier) {
    return;
  }

  const station = getStationById(identifier);
  if (!station) {
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
    processGeofenceEventHeadless('ENTER', identifier, locationUpdate);

    await BackgroundGeolocation.setConfig(CONFIG_STATION_TRACKING);

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

      processLocationHeadless({
        latitude: currentPos.coords.latitude,
        longitude: currentPos.coords.longitude,
        accuracy: currentPos.coords.accuracy || 10,
        timestamp: currentPos.timestamp,
      });
    } catch (error) {
      log('[HeadlessTask] Failed to get position:', error);
    }
  } else if (action === 'EXIT') {
    processGeofenceEventHeadless('EXIT', identifier, locationUpdate);

    await BackgroundGeolocation.setConfig(CONFIG_BATTERY_EFFICIENT);
  }
}

/**
 * Handle location updates in headless mode
 * This is triggered on each location update when tracking is active
 */
async function handleLocationHeadless(params) {
  const coords = params?.coords;
  if (!coords) {
    return;
  }

  processLocationHeadless({
    latitude: coords.latitude,
    longitude: coords.longitude,
    accuracy: coords.accuracy || 10,
    timestamp: params.timestamp,
  });
}

/**
 * Handle motion change in headless mode
 */
function handleMotionChangeHeadless(params) {
  const isMoving = params?.isMoving;
  const location = params?.location;

  if (!isMoving && location?.coords) {
    processLocationHeadless({
      latitude: location.coords.latitude,
      longitude: location.coords.longitude,
      accuracy: location.coords.accuracy || 10,
      timestamp: location.timestamp,
    });
  }
}

/**
 * Handle heartbeat events in headless mode
 * This is triggered periodically when user is stationary (if configured)
 * Critical for amenity detection when user is not moving inside a station
 */
async function handleHeartbeatHeadless(params) {
  if (!isTrackingActive()) {
    return;
  }

  try {
    const location = await BackgroundGeolocation.getCurrentPosition({
      samples: 1,
      persist: true,
      timeout: 30,
      extras: {
        event: 'heartbeat-headless',
      },
    });

    processHeartbeatHeadless({
      latitude: location.coords.latitude,
      longitude: location.coords.longitude,
      accuracy: location.coords.accuracy || 10,
      timestamp: location.timestamp,
    });
  } catch (error) {
    log('[HeadlessTask:Heartbeat] Failed to get position:', error);
  }
}

// Register the headless task
BackgroundGeolocation.registerHeadlessTask(BackgroundGeolocationHeadlessTask);
