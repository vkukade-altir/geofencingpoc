import {Platform} from 'react-native';
import {PERMISSIONS, request, RESULTS} from 'react-native-permissions';

export const requestLocationPermission = ({
  onGranted,
  onBlocked,
  onDenied,
  onUnavailable,
}: {
  onGranted?: () => void;
  onBlocked?: () => void;
  onDenied?: () => void;
  onUnavailable?: () => void;
}) => {
  if (Platform.OS === 'ios') {
    Promise.all([
      request(PERMISSIONS.IOS.LOCATION_ALWAYS),
      request(PERMISSIONS.IOS.LOCATION_WHEN_IN_USE),
    ]).then(([resultAlways, resultWhenInUse]) => {
      switch (RESULTS.GRANTED) {
        // Allow while using app, Always (in the settings) - without question
        case resultAlways:
          onGranted?.();
          return;
        case resultWhenInUse:
          onGranted?.();
          return;
      }
      switch (RESULTS.LIMITED) {
        // The permission is limited: some actions are possible
        case resultAlways:
          onGranted?.();
          return;
        case resultWhenInUse:
          onGranted?.();
          return;
      }
      switch (RESULTS.BLOCKED) {
        // The permission is denied and not requestable anymore
        // Don't allow - Never, Allow once - during the session
        case resultAlways:
          onBlocked?.();
          return;
        case resultWhenInUse:
          onBlocked?.();
          return;
      }
      switch (RESULTS.UNAVAILABLE) {
        // This feature is not available (on this device / in this context)
        // Location turn off
        case resultAlways:
          onUnavailable?.();
          return;
        case resultWhenInUse:
          onUnavailable?.();
          return;
      }
      switch (RESULTS.DENIED) {
        // The permission has not been requested / is denied but requestable
        // Allow once
        case resultAlways:
          onDenied?.();
          return;
        case resultWhenInUse:
          onDenied?.();
          return;
      }
    });
  } else {
    request(PERMISSIONS.ANDROID.ACCESS_FINE_LOCATION).then(result => {
      switch (result) {
        // The permission has not been requested / is denied but requestable
        // Allow once
        case RESULTS.DENIED:
          onDenied?.();
          break;
        // The permission is limited: some actions are possible
        case RESULTS.LIMITED:
          onGranted?.();
          break;
        // Allow while using app, Always (in the settings) - without question
        case RESULTS.GRANTED:
          onGranted?.();
          break;
        // The permission is denied and not requestable anymore
        // Don't allow - Never, Allow once - during the session
        case RESULTS.BLOCKED:
          onBlocked?.();
          break;
        // This feature is not available (on this device / in this context)
        // Location turn off
        case RESULTS.UNAVAILABLE:
          onUnavailable?.();
          break;
      }
    });
  }
};

export const isWithinRange = (
  newValue: number,
  targetValue: number,
  range: number,
) => {
  return Math.abs(newValue - targetValue) <= range;
};

// Start and end coordinates
const startLat = 52.20815740228096;
const startLon = 5.176701144216742;
const endLat = 52.16080182712767;
const endLon = 5.289678003576839;

// Function to generate GPX file
function generateGPXFile() {
  // Calculate the distance between the start and end points
  const distance = calculateDistance(startLat, startLon, endLat, endLon);
  const distanceBetweenPoints = distance / 200;

  let gpxContent = `<?xml version="1.0"?>
<gpx version="1.1" creator="gpxgenerator.com">
<wpt lat="${startLat.toFixed(8)}" lon="${startLon.toFixed(8)}">
    <ele>13.66</ele>
    <time>2024-07-07T11:32:16Z</time>
</wpt>`;

  // Generate 200 intermediate points
  for (let i = 1; i <= 200; i++) {
    const lat = startLat + (endLat - startLat) * (i / 200);
    const lon = startLon + (endLon - startLon) * (i / 200);
    const time = new Date(Date.UTC(2024, 6, 7, 11, 32, 16 + i)).toISOString();

    gpxContent += `
<wpt lat="${lat.toFixed(8)}" lon="${lon.toFixed(8)}">
    <ele>0</ele>
    <time>${time}</time>
</wpt>`;
  }

  gpxContent += `
<wpt lat="${endLat.toFixed(8)}" lon="${endLon.toFixed(8)}">
    <ele>8.05</ele>
    <time>2024-07-07T11:37:16Z</time>
</wpt>
</gpx>`;

  return gpxContent;
}

// Function to calculate the distance between two points using the Haversine formula
function calculateDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
) {
  const R = 6371; // Earth's radius in kilometers
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180;
  const Δλ = ((lon2 - lon1) * Math.PI) / 180;

  const a =
    Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// Generate the GPX file
const gpxContent = generateGPXFile();
console.log(gpxContent);
