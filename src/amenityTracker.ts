/**
 * Amenity Tracking Service using Turf.js
 *
 * This module provides:
 * 1. Point-in-polygon/circle detection using Turf
 * 2. State machine for amenity enter/exit events
 * 3. Debouncing to prevent false triggers from GPS jitter
 * 4. Accuracy gating to ignore low-quality fixes
 * 5. State persistence via MMKV for headless/quit mode support
 *
 * Works in both foreground and headless (background/killed) modes.
 */

import * as turf from '@turf/turf';
import {createMMKV, MMKV} from 'react-native-mmkv';
import {Station, Amenity, getStationById} from './stationData';
import {log, warn, logError} from './logger';

// ============================================
// MMKV STORAGE FOR STATE PERSISTENCE
// ============================================

// Lazy initialization to prevent issues when native modules aren't ready
let _storage: MMKV | null = null;
const STORAGE_KEY_TRACKING_STATE = 'tracking_state';

function getStorage(): MMKV {
  if (!_storage) {
    try {
      // V4 API: use createMMKV() instead of new MMKV()
      _storage = createMMKV({id: 'amenity-tracker-storage'});
    } catch (error) {
      warn('[AmenityTracker] MMKV initialization failed:', error);
      // Return a mock storage that does nothing
      return {
        set: () => {},
        getString: () => undefined,
        remove: () => false,
      } as unknown as MMKV;
    }
  }
  return _storage;
}

// ============================================
// TYPES
// ============================================

export interface AmenityEvent {
  type: 'AMENITY_ENTER' | 'AMENITY_EXIT';
  stationId: string;
  amenityId: string;
  amenityName: string;
  timestamp: string;
  location: {
    latitude: number;
    longitude: number;
    accuracy: number;
  };
}

function logAmenityTransition(event: AmenityEvent): void {
  log(`[AmenityTracker] ${event.type}`, {
    amenityId: event.amenityId,
    amenityName: event.amenityName,
    stationId: event.stationId,
    lat: event.location.latitude,
    lon: event.location.longitude,
    accuracy: event.location.accuracy,
    timestamp: event.timestamp,
  });
}

export interface LocationUpdate {
  latitude: number;
  longitude: number;
  accuracy: number;
  timestamp?: string;
}

interface AmenityState {
  amenityId: string;
  isInside: boolean;
  enteredAt: string | null;
  consecutiveInsideCount: number;
  consecutiveOutsideCount: number;
}

interface StationTrackingState {
  stationId: string;
  isInsideStation: boolean;
  enteredStationAt: string | null;
  amenityStates: Map<string, AmenityState>;
  lastLocation: LocationUpdate | null;
}

// ============================================
// CONFIGURATION
// ============================================

const CONFIG = {
  // Minimum accuracy (meters) to consider a location fix valid for amenity detection
  // Fixes with accuracy worse than this are ignored
  MAX_ACCURACY_METERS: 25,

  // Number of consecutive "inside" readings before firing ENTER event
  // Helps debounce GPS jitter
  ENTER_DEBOUNCE_COUNT: 2,

  // Number of consecutive "outside" readings before firing EXIT event
  EXIT_DEBOUNCE_COUNT: 2,

  // Shrink amenity radius by this amount for entry detection (meters)
  // Helps prevent false entries at boundaries
  ENTRY_BUFFER_METERS: 3,

  // Expand amenity radius by this amount for exit detection (meters)
  // Creates hysteresis to prevent rapid enter/exit at boundaries
  EXIT_BUFFER_METERS: 5,
};

// ============================================
// STATE MANAGEMENT
// ============================================

// Global state - persists across function calls
// State is also persisted to MMKV for headless/quit mode recovery
let trackingStates: Map<string, StationTrackingState> = new Map();

// Event callback - set by the consumer
let eventCallback: ((event: AmenityEvent) => void) | null = null;

// ============================================
// STATE PERSISTENCE (MMKV)
// ============================================

interface PersistedAmenityState {
  amenityId: string;
  isInside: boolean;
  enteredAt: string | null;
  consecutiveInsideCount: number;
  consecutiveOutsideCount: number;
}

interface PersistedTrackingState {
  stationId: string;
  isInsideStation: boolean;
  enteredStationAt: string | null;
  lastLocation: LocationUpdate | null;
  amenityStates: PersistedAmenityState[];
}

/**
 * Save current tracking state to MMKV
 * Called on station enter/exit and amenity state changes
 */
function persistState(): void {
  try {
    const statesToPersist: PersistedTrackingState[] = [];

    for (const [stationId, state] of trackingStates) {
      const amenityStatesArray: PersistedTrackingState['amenityStates'] = [];
      for (const [, amenityState] of state.amenityStates) {
        amenityStatesArray.push({
          amenityId: amenityState.amenityId,
          isInside: amenityState.isInside,
          enteredAt: amenityState.enteredAt,
          consecutiveInsideCount: amenityState.consecutiveInsideCount,
          consecutiveOutsideCount: amenityState.consecutiveOutsideCount,
        });
      }

      statesToPersist.push({
        stationId: state.stationId,
        isInsideStation: state.isInsideStation,
        enteredStationAt: state.enteredStationAt,
        lastLocation: state.lastLocation,
        amenityStates: amenityStatesArray,
      });
    }

    getStorage().set(STORAGE_KEY_TRACKING_STATE, JSON.stringify(statesToPersist));
  } catch (error) {
    logError('[AmenityTracker] Failed to persist state:', error);
  }
}

function buildAmenityStateFromPersisted(
  amenityId: string,
  persistedAmenity: PersistedAmenityState | undefined,
): AmenityState {
  const isInside = persistedAmenity?.isInside ?? false;
  return {
    amenityId,
    isInside,
    enteredAt: persistedAmenity?.enteredAt ?? null,
    consecutiveInsideCount:
      persistedAmenity?.consecutiveInsideCount ??
      (isInside ? CONFIG.ENTER_DEBOUNCE_COUNT : 0),
    consecutiveOutsideCount:
      persistedAmenity?.consecutiveOutsideCount ??
      (isInside ? 0 : CONFIG.EXIT_DEBOUNCE_COUNT),
  };
}

/**
 * Restore tracking state from MMKV.
 * Each Android headless task runs in a fresh JS context, so this is called
 * at the start of every headless event — debounce counters must be persisted.
 */
export function restoreState(): boolean {
  try {
    const stored = getStorage().getString(STORAGE_KEY_TRACKING_STATE);
    if (!stored) {
      log('[AmenityTracker] No persisted state found');
      return false;
    }

    const persistedStates: PersistedTrackingState[] = JSON.parse(stored);
    if (!persistedStates || persistedStates.length === 0) {
      return false;
    }

    trackingStates.clear();

    for (const persisted of persistedStates) {
      const station = getStationById(persisted.stationId);
      if (!station) {
        log('[AmenityTracker] Skipping unknown station:', persisted.stationId);
        continue;
      }

      const amenityStates = new Map<string, AmenityState>();
      for (const amenity of station.amenities) {
        const persistedAmenity = persisted.amenityStates.find(
          a => a.amenityId === amenity.id,
        );
        amenityStates.set(
          amenity.id,
          buildAmenityStateFromPersisted(amenity.id, persistedAmenity),
        );
      }

      trackingStates.set(persisted.stationId, {
        stationId: persisted.stationId,
        isInsideStation: persisted.isInsideStation,
        enteredStationAt: persisted.enteredStationAt,
        amenityStates,
        lastLocation: persisted.lastLocation,
      });
    }

    return trackingStates.size > 0;
  } catch (error) {
    logError('[AmenityTracker] Failed to restore state:', error);
    return false;
  }
}

/**
 * Clear persisted state
 */
export function clearPersistedState(): void {
  try {
    getStorage().remove(STORAGE_KEY_TRACKING_STATE);
    log('[AmenityTracker] Persisted state cleared');
  } catch (error) {
    logError('[AmenityTracker] Failed to clear persisted state:', error);
  }
}

/**
 * Get the current station ID being tracked (for headless mode)
 */
export function getCurrentStationId(): string | null {
  for (const [stationId, state] of trackingStates) {
    if (state.isInsideStation) {
      return stationId;
    }
  }
  return null;
}

// ============================================
// PUBLIC API
// ============================================

/**
 * Set the callback for amenity events
 */
export function setAmenityEventCallback(
  callback: (event: AmenityEvent) => void,
): void {
  eventCallback = callback;
}

/**
 * Clear the event callback
 */
export function clearAmenityEventCallback(): void {
  eventCallback = null;
}

/**
 * Called when user ENTERS a station geofence
 * Initializes amenity tracking for that station
 */
export function onStationEnter(stationId: string): void {
  const station = getStationById(stationId);
  if (!station) {
    log('[AmenityTracker] Unknown station:', stationId);
    return;
  }

  log('[AmenityTracker] STATION_ENTER', {stationId});

  // Initialize tracking state for this station
  const amenityStates = new Map<string, AmenityState>();
  for (const amenity of station.amenities) {
    amenityStates.set(amenity.id, {
      amenityId: amenity.id,
      isInside: false,
      enteredAt: null,
      consecutiveInsideCount: 0,
      consecutiveOutsideCount: 0,
    });
  }

  trackingStates.set(stationId, {
    stationId,
    isInsideStation: true,
    enteredStationAt: new Date().toISOString(),
    amenityStates,
    lastLocation: null,
  });

  // Persist state for headless mode recovery
  persistState();
}

/**
 * Called when user EXITS a station geofence
 * Cleans up amenity tracking and fires any pending EXIT events
 */
export function onStationExit(stationId: string): void {
  log('[AmenityTracker] STATION_EXIT', {stationId});

  const state = trackingStates.get(stationId);
  if (state) {
    // Fire EXIT events for any amenities user was inside
    for (const [amenityId, amenityState] of state.amenityStates) {
      if (amenityState.isInside) {
        const station = getStationById(stationId);
        const amenity = station?.amenities.find(a => a.id === amenityId);
        if (amenity) {
          const event: AmenityEvent = {
            type: 'AMENITY_EXIT',
            stationId,
            amenityId,
            amenityName: amenity.name,
            timestamp: new Date().toISOString(),
            location: state.lastLocation || {
              latitude: 0,
              longitude: 0,
              accuracy: 0,
            },
          };
          emitEvent(event);
          logAmenityTransition(event);
        }
      }
    }
  }

  // Clean up
  trackingStates.delete(stationId);

  // Clear persisted state since we're no longer tracking
  clearPersistedState();
}

/**
 * Process a location update
 * Call this on every onLocation event when inside a station
 */
export function processLocation(location: LocationUpdate): AmenityEvent[] {
  const events: AmenityEvent[] = [];

  // Check accuracy gate
  if (location.accuracy > CONFIG.MAX_ACCURACY_METERS) {
    return events;
  }

  // Process for each station we're tracking
  for (const [stationId, state] of trackingStates) {
    if (!state.isInsideStation) {
      continue;
    }

    state.lastLocation = location;
    const station = getStationById(stationId);
    if (!station) {
      continue;
    }

    // Check each amenity
    for (const amenity of station.amenities) {
      const amenityState = state.amenityStates.get(amenity.id);
      if (!amenityState) {
        continue;
      }

      const isCurrentlyInside = isInsideAmenity(
        location,
        amenity,
        amenityState.isInside,
      );

      if (isCurrentlyInside) {
        amenityState.consecutiveInsideCount++;
        amenityState.consecutiveOutsideCount = 0;

        if (
          !amenityState.isInside &&
          amenityState.consecutiveInsideCount >= CONFIG.ENTER_DEBOUNCE_COUNT
        ) {
          amenityState.isInside = true;
          amenityState.enteredAt = new Date().toISOString();

          const event: AmenityEvent = {
            type: 'AMENITY_ENTER',
            stationId,
            amenityId: amenity.id,
            amenityName: amenity.name,
            timestamp: amenityState.enteredAt,
            location: {
              latitude: location.latitude,
              longitude: location.longitude,
              accuracy: location.accuracy,
            },
          };
          events.push(event);
          emitEvent(event);
          logAmenityTransition(event);
        }
      } else {
        amenityState.consecutiveInsideCount = 0;

        if (amenityState.isInside) {
          amenityState.consecutiveOutsideCount++;
        } else {
          amenityState.consecutiveOutsideCount = 0;
        }

        if (
          amenityState.isInside &&
          amenityState.consecutiveOutsideCount >= CONFIG.EXIT_DEBOUNCE_COUNT
        ) {
          amenityState.isInside = false;
          const enteredAt = amenityState.enteredAt;
          amenityState.enteredAt = null;

          const event: AmenityEvent = {
            type: 'AMENITY_EXIT',
            stationId,
            amenityId: amenity.id,
            amenityName: amenity.name,
            timestamp: new Date().toISOString(),
            location: {
              latitude: location.latitude,
              longitude: location.longitude,
              accuracy: location.accuracy,
            },
          };
          events.push(event);
          emitEvent(event);
          logAmenityTransition(event);
        }
      }
    }

    // Persist debounce counters + lastLocation for the next headless JS context
    persistState();
  }

  return events;
}

/**
 * Check if currently tracking any station
 */
export function isTrackingActive(): boolean {
  return trackingStates.size > 0;
}

/**
 * Get current tracking state (for debugging/UI)
 */
export function getTrackingState(): Map<string, StationTrackingState> {
  return trackingStates;
}

/**
 * Reset all tracking state
 */
export function resetTracking(): void {
  trackingStates.clear();
}

// ============================================
// TURF-BASED GEOMETRY CHECKS
// ============================================

/**
 * Check if a location is inside an amenity using Turf.js
 * Applies entry/exit buffers for hysteresis
 */
function isInsideAmenity(
  location: LocationUpdate,
  amenity: Amenity,
  wasInside: boolean,
): boolean {
  const point = turf.point([location.longitude, location.latitude]);

  if (amenity.type === 'circle') {
    // Apply hysteresis buffer
    const buffer = wasInside
      ? CONFIG.EXIT_BUFFER_METERS
      : -CONFIG.ENTRY_BUFFER_METERS;
    const effectiveRadius = (amenity.radiusMeters || 20) + buffer;

    // Create circle polygon
    const circle = turf.circle(
      [amenity.longitude, amenity.latitude],
      effectiveRadius / 1000, // Turf uses kilometers
      {steps: 32, units: 'kilometers'},
    );

    return turf.booleanPointInPolygon(point, circle);
  } else if (amenity.type === 'polygon' && amenity.polygon) {
    // For polygons, we buffer the polygon itself
    const polygon = turf.polygon([amenity.polygon]);

    // Apply buffer (positive for exit, negative for entry)
    const buffer = wasInside
      ? CONFIG.EXIT_BUFFER_METERS
      : -CONFIG.ENTRY_BUFFER_METERS;

    let effectivePolygon;
    if (buffer !== 0) {
      try {
        effectivePolygon = turf.buffer(polygon, buffer / 1000, {
          units: 'kilometers',
        });
      } catch {
        // Buffer can fail for small polygons with negative buffer
        effectivePolygon = polygon;
      }
    } else {
      effectivePolygon = polygon;
    }

    if (!effectivePolygon) {
      return turf.booleanPointInPolygon(point, polygon);
    }

    return turf.booleanPointInPolygon(point, effectivePolygon);
  }

  return false;
}

/**
 * Calculate distance from point to amenity center (for debugging)
 */
export function distanceToAmenity(
  location: LocationUpdate,
  amenity: Amenity,
): number {
  const from = turf.point([location.longitude, location.latitude]);
  const to = turf.point([amenity.longitude, amenity.latitude]);
  return turf.distance(from, to, {units: 'meters'});
}

// ============================================
// INTERNAL HELPERS
// ============================================

function emitEvent(event: AmenityEvent): void {
  if (eventCallback) {
    try {
      eventCallback(event);
    } catch (error) {
      logError('[AmenityTracker] Error in event callback:', error);
    }
  }
}

// ============================================
// HEADLESS MODE SUPPORT
// ============================================

/**
 * Initialize amenity tracker in headless mode
 * Restores state from MMKV if available
 * Call this at the start of headless task
 */
export function initHeadlessMode(): boolean {
  // Each headless task is a fresh JS context — always reload from MMKV once per task
  const restored = restoreState();
  if (restored) {
    return true;
  }

  log('[AmenityTracker:Headless] No state to restore');
  return false;
}

/**
 * Process a geofence event in headless mode
 * This is called from the headless task when app is killed
 */
export function processGeofenceEventHeadless(
  action: 'ENTER' | 'EXIT',
  stationId: string,
  location: LocationUpdate,
): void {
  if (action === 'ENTER') {
    onStationEnter(stationId);
    // Process the initial location
    processLocation(location);
  } else {
    onStationExit(stationId);
  }
}

/**
 * Process a location update in headless mode
 * Will auto-restore state if not already tracking
 */
export function processLocationHeadless(
  location: LocationUpdate,
): AmenityEvent[] {
  if (!isTrackingActive()) {
    return [];
  }

  return processLocation(location);
}

/**
 * Process a heartbeat in headless mode
 * Gets current position and processes it
 */
export function processHeartbeatHeadless(
  location: LocationUpdate,
): AmenityEvent[] {
  if (!isTrackingActive()) {
    return [];
  }

  return processLocation(location);
}

// ============================================
// DEBUG HELPERS
// ============================================

/**
 * Get debug info about current state
 */
export function getDebugInfo(): string {
  const lines: string[] = [];
  lines.push(`[AmenityTracker] Tracking ${trackingStates.size} station(s)`);

  for (const [stationId, state] of trackingStates) {
    lines.push(`  Station: ${stationId}`);
    lines.push(`    Inside station: ${state.isInsideStation}`);
    lines.push(`    Entered at: ${state.enteredStationAt}`);
    for (const [amenityId, amenityState] of state.amenityStates) {
      lines.push(
        `    Amenity ${amenityId}: inside=${amenityState.isInside}, inCount=${amenityState.consecutiveInsideCount}, outCount=${amenityState.consecutiveOutsideCount}`,
      );
    }
  }

  return lines.join('\n');
}
