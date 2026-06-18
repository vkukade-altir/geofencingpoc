/**
 * Station and Amenity Data for Geofencing + Turf-based Amenity Tracking
 *
 * SCENARIO:
 * - User drives to EV charging station (100m geofence radius)
 * - Parks vehicle at charging bay
 * - Walks to cafe (20m radius amenity)
 * - Walks to restroom (15m radius amenity)
 * - Returns to vehicle and exits station
 *
 * All amenities are positioned INSIDE the station geofence.
 * The GPX test files are synced with these exact coordinates.
 */

export interface Amenity {
  id: string;
  name: string;
  type: 'circle' | 'polygon';
  latitude: number;
  longitude: number;
  radiusMeters?: number;
  polygon?: [number, number][]; // [longitude, latitude] pairs for Turf (GeoJSON format)
}

export interface Station {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  radiusMeters: number;
  amenities: Amenity[];
}

// ============================================
// TEST STATION: EV Charging Station
// Location: Gachibowli area, Hyderabad
// 100m radius - good for reliable native geofence
// ============================================

const EV_STATION_CENTER_LAT = 17.42;
const EV_STATION_CENTER_LON = 78.338;
const EV_STATION_RADIUS = 100; // meters

// ============================================
// AMENITIES INSIDE THE STATION
// All positioned within 100m of station center
// ============================================

// CAFE: 30m northeast of station center (inside 100m radius)
// 20m radius for the cafe area
const CAFE_LAT = 17.42027;
const CAFE_LON = 78.33825;
const CAFE_RADIUS = 20;

// RESTROOM: 40m south of station center (inside 100m radius)
// 15m radius for restroom building
const RESTROOM_LAT = 17.41965;
const RESTROOM_LON = 78.3381;
const RESTROOM_RADIUS = 15;

// CHARGING BAY A: Polygon area near station center
// Rectangular charging bay area (polygon)
// Approximately 25m x 15m rectangle
const CHARGING_BAY_POLYGON: [number, number][] = [
  [78.33755, 17.42015], // SW corner [lon, lat]
  [78.33785, 17.42015], // SE corner
  [78.33785, 17.42005], // NE corner
  [78.33755, 17.42005], // NW corner
  [78.33755, 17.42015], // Close polygon (back to SW)
];
const CHARGING_BAY_CENTER_LAT = 17.4201;
const CHARGING_BAY_CENTER_LON = 78.3377;

// ============================================
// STATION WITH AMENITIES
// ============================================

export const EVChargingStation: Station = {
  id: 'EV_Station_Test',
  name: 'EV Charging Station - Gachibowli',
  latitude: EV_STATION_CENTER_LAT,
  longitude: EV_STATION_CENTER_LON,
  radiusMeters: EV_STATION_RADIUS,
  amenities: [
    {
      id: 'cafe',
      name: 'Station Cafe',
      type: 'circle',
      latitude: CAFE_LAT,
      longitude: CAFE_LON,
      radiusMeters: CAFE_RADIUS,
    },
    {
      id: 'restroom',
      name: 'Restroom',
      type: 'circle',
      latitude: RESTROOM_LAT,
      longitude: RESTROOM_LON,
      radiusMeters: RESTROOM_RADIUS,
    },
    {
      id: 'charging_bay_a',
      name: 'Charging Bay A',
      type: 'polygon',
      latitude: CHARGING_BAY_CENTER_LAT,
      longitude: CHARGING_BAY_CENTER_LON,
      polygon: CHARGING_BAY_POLYGON,
    },
  ],
};

// ============================================
// STATION COORDINATES FOR GEOFENCING
// Use this for BackgroundGeolocation.addGeofences()
// ============================================

export const TestStationCoordinates = [
  {
    id: EVChargingStation.id,
    latitude: EVChargingStation.latitude,
    longitude: EVChargingStation.longitude,
  },
];

// ============================================
// HELPER: Get station by ID
// ============================================

export function getStationById(stationId: string): Station | undefined {
  if (stationId === EVChargingStation.id) {
    return EVChargingStation;
  }
  return undefined;
}

// ============================================
// HELPER: Get all stations
// ============================================

export function getAllStations(): Station[] {
  return [EVChargingStation];
}

// ============================================
// COORDINATE CALCULATIONS (for reference)
// ============================================
// At latitude 17.42°:
// 1° latitude ≈ 110,574 meters
// 1° longitude ≈ 105,600 meters (cos(17.42°) * 111,320)
//
// Distance calculations:
// CAFE from station center:
//   Δlat = 0.00027 → ~30m north
//   Δlon = 0.00025 → ~26m west
//   Haversine: ~40m (inside 100m station)
//
// RESTROOM from station center:
//   Δlat = -0.00035 → ~39m south
//   Δlon = 0.0001 → ~10m east
//   Haversine: ~40m (inside 100m station)
//
// CHARGING BAY from station center:
//   Δlat = 0.0001 → ~11m north
//   Δlon = -0.0003 → ~32m west
//   Haversine: ~34m (inside 100m station)
// ============================================
