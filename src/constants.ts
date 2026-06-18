// ============================================
// 20m RADIUS GEOFENCES (Original - Close together)
// Use for testing small radius behavior
// ============================================
const SHERATON_LAT_20M = 17.421879;
const SHERATON_LON_20M = 78.337274;

const FRANKLIN_LAT_20M = 17.422875;
const FRANKLIN_LON_20M = 78.335881;

const CAPGEMINI_LAT_20M = 17.419234;
const CAPGEMINI_LON_20M = 78.339111;

export const Stations20m = [
  {
    id: 'Sheraton',
    latitude: SHERATON_LAT_20M,
    longitude: SHERATON_LON_20M,
  },
  {
    id: 'Franklin',
    latitude: FRANKLIN_LAT_20M,
    longitude: FRANKLIN_LON_20M,
  },
  {
    id: 'Capgemini',
    latitude: CAPGEMINI_LAT_20M,
    longitude: CAPGEMINI_LON_20M,
  },
];

// ============================================
// 200m RADIUS GEOFENCES (Well-spaced ~600m apart)
// Use for production-like testing
// Located in Gachibowli/Hitech City area, Hyderabad
// ============================================
const EV_STATION_A_LAT = 17.419;
const EV_STATION_A_LON = 78.34;

const EV_STATION_B_LAT = 17.4235;
const EV_STATION_B_LON = 78.3355;

const EV_STATION_C_LAT = 17.428;
const EV_STATION_C_LON = 78.331;

export const Stations200m = [
  {
    id: 'EV_Station_A',
    latitude: EV_STATION_A_LAT,
    longitude: EV_STATION_A_LON,
  },
  {
    id: 'EV_Station_B',
    latitude: EV_STATION_B_LAT,
    longitude: EV_STATION_B_LON,
  },
  {
    id: 'EV_Station_C',
    latitude: EV_STATION_C_LAT,
    longitude: EV_STATION_C_LON,
  },
];

// ============================================
// ACTIVE CONFIGURATION
// Change these exports to switch between test configs
// ============================================

// For 20m/50m testing (original close geofences - Sheraton, Franklin, Capgemini)
// export const IOSStationCoordinates = Stations20m;
// export const AndroidStationCoordinates = Stations20m;

// For 200m testing (production-like, well-spaced)
export const IOSStationCoordinates = Stations20m;
export const AndroidStationCoordinates = Stations20m;
