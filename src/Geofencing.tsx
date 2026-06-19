import React, {useEffect, useMemo, useRef, useState} from 'react';
import {
  Dimensions,
  FlatList,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import MapView, {Circle, Marker, Polygon} from 'react-native-maps';
import BackgroundGeolocation, {
  GeofenceEvent,
  Location,
} from 'react-native-background-geolocation';
import haversine from 'haversine';
import {isWithinRange} from './helpers';
import {log, warn, logError} from './logger';
import {State} from './react-native-background-geolocation';
import {findOverlappingPairs} from './mapOverlap';
import {
  EVChargingStation,
  getAllStations,
  Station,
  Amenity,
} from './stationData';
import {
  onStationEnter,
  onStationExit,
  processLocation,
  setAmenityEventCallback,
  clearAmenityEventCallback,
  AmenityEvent,
  isTrackingActive,
  getDebugInfo,
  distanceToAmenity,
  restoreState,
  getCurrentStationId,
} from './amenityTracker';

// ============================================
// BACKGROUND GEOLOCATION CONFIG PROFILES
// ============================================

// stopTimeout is in MINUTES (1 = device marked stationary after 1 min without movement)
// Battery-efficient config (outside stations)
const CONFIG_BATTERY_EFFICIENT = {
  distanceFilter: 10,
  stopTimeout: 1,
  heartbeatInterval: 60,
  preventSuspend: true,
};

// Aggressive tracking config (inside stations for amenity detection)
const CONFIG_STATION_TRACKING = {
  distanceFilter: 2,
  stopTimeout: 1, // 1 minute — for stationary + heartbeat testing
  heartbeatInterval: 15,
  preventSuspend: true, // iOS: keep app awake for heartbeats while stationary at amenities
};

const GEOFENCE_RADIUS_METERS = 100;

const STATION_PIN_COLORS = ['red', 'green', 'purple'] as const;

const STATION_FENCE_RING = [
  {stroke: 'rgba(220, 38, 38, 0.95)', fill: 'rgba(220, 38, 38, 0.14)'},
  {stroke: 'rgba(22, 163, 74, 0.95)', fill: 'rgba(22, 163, 74, 0.14)'},
  {stroke: 'rgba(126, 34, 206, 0.95)', fill: 'rgba(126, 34, 206, 0.14)'},
] as const;

const AMENITY_COLORS = {
  cafe: {stroke: 'rgba(251, 146, 60, 0.95)', fill: 'rgba(251, 146, 60, 0.25)'},
  restroom: {
    stroke: 'rgba(168, 85, 247, 0.95)',
    fill: 'rgba(168, 85, 247, 0.25)',
  },
  charging_bay_a: {
    stroke: 'rgba(56, 189, 248, 0.95)',
    fill: 'rgba(56, 189, 248, 0.25)',
  },
  default: {
    stroke: 'rgba(156, 163, 175, 0.95)',
    fill: 'rgba(156, 163, 175, 0.25)',
  },
} as const;

const WINDOW_H = Dimensions.get('window').height;
const HISTORY_PANEL_H = Math.min(200, Math.round(WINDOW_H * 0.22));
const MAP_MIN_HEIGHT = Math.max(220, Math.round(WINDOW_H * 0.34));

function computeInitialRegion(
  stations: {latitude: number; longitude: number}[],
): {
  latitude: number;
  longitude: number;
  latitudeDelta: number;
  longitudeDelta: number;
} {
  if (stations.length === 0) {
    return {
      latitude: 17.42,
      longitude: 78.338,
      latitudeDelta: 0.02,
      longitudeDelta: 0.02,
    };
  }
  const first = stations[0];
  const last = stations[stations.length - 1];
  const midLat = (first.latitude + last.latitude) / 2;
  const midLon = (first.longitude + last.longitude) / 2;
  const latSpan = Math.abs(last.latitude - first.latitude) * 2.2;
  const lonSpan = Math.max(
    Math.abs(last.longitude - first.longitude) * 2.2,
    0.002,
  );
  return {
    latitude: midLat,
    longitude: midLon,
    latitudeDelta: Math.max(latSpan, 0.006),
    longitudeDelta: lonSpan,
  };
}

// Event log item type
interface EventLogItem {
  id: string;
  type: 'station' | 'amenity';
  action: 'entry' | 'exit';
  identifier: string;
  name: string;
  lat: number;
  lon: number;
  distance: number;
  accuracy?: number;
  timestamp: Date;
}

export const Geofencing = () => {
  const mapRef = useRef<MapView>(null);
  const trackThrottleRef = useRef(0);
  const geofencesReadyRef = useRef(false);
  const registerGeofencesRef = useRef<(() => Promise<void>) | null>(null);
  const [trackMap, setTrackMap] = useState(false);

  const [enabled, setEnabled] = useState(false);
  const [location, setLocation] = React.useState<Location | null>(null);
  const [geofenceEvent, setGeofenceEvent] =
    React.useState<GeofenceEvent | null>(null);

  // Combined event log for stations and amenities
  const [eventLog, setEventLog] = useState<EventLogItem[]>([]);

  // Current station being tracked (for amenity display)
  const [currentStationId, setCurrentStationId] = useState<string | null>(null);

  // Get stations from new data structure
  const stations = useMemo(() => getAllStations(), []);
  const stationCoordinates = useMemo(
    () =>
      stations.map(s => ({
        id: s.id,
        latitude: s.latitude,
        longitude: s.longitude,
      })),
    [stations],
  );

  const stationsForOverlap = useMemo(
    () =>
      stationCoordinates.map(s => ({
        id: s.id,
        latitude: s.latitude,
        longitude: s.longitude,
        radiusMeters: GEOFENCE_RADIUS_METERS,
      })),
    [stationCoordinates],
  );

  const defaultMapRegion = useMemo(
    () => computeInitialRegion(stationCoordinates),
    [stationCoordinates],
  );

  const overlapPairs = useMemo(
    () => findOverlappingPairs(stationsForOverlap),
    [stationsForOverlap],
  );

  // Current station data for amenity display
  const currentStation = useMemo(() => {
    if (!currentStationId) return null;
    return stations.find(s => s.id === currentStationId) || null;
  }, [currentStationId, stations]);

  const fenceDistanceLine = useMemo(() => {
    if (
      location?.coords?.latitude == null ||
      location?.coords?.longitude == null
    ) {
      return null;
    }
    const lat = location.coords.latitude;
    const lon = location.coords.longitude;

    // Show distance to stations
    const stationDistances = stationCoordinates.map(s => {
      const d = haversine(
        {latitude: s.latitude, longitude: s.longitude},
        {latitude: lat, longitude: lon},
        {unit: 'meter'},
      );
      const inside = d <= GEOFENCE_RADIUS_METERS;
      return `${s.id}: ${d.toFixed(0)}m (${inside ? 'inside' : 'outside'})`;
    });

    return stationDistances.join(' · ');
  }, [location, stationCoordinates]);

  // Amenity distance line when inside a station
  const amenityDistanceLine = useMemo(() => {
    if (
      !currentStation ||
      location?.coords?.latitude == null ||
      location?.coords?.longitude == null
    ) {
      return null;
    }

    const locUpdate = {
      latitude: location.coords.latitude,
      longitude: location.coords.longitude,
      accuracy: location.coords.accuracy || 10,
    };

    return currentStation.amenities
      .map(a => {
        const d = distanceToAmenity(locUpdate, a);
        const inside =
          a.type === 'circle' ? d <= (a.radiusMeters || 20) : false; // Polygon check would need Turf
        return `${a.name}: ${d.toFixed(0)}m`;
      })
      .join(' · ');
  }, [location, currentStation]);

  const geofences = useMemo(
    () =>
      stationCoordinates.map(coord => {
        const station = stations.find(s => s.id === coord.id);
        return {
          identifier: coord.id,
          radius: station?.radiusMeters || GEOFENCE_RADIUS_METERS,
          latitude: coord.latitude,
          longitude: coord.longitude,
          notifyOnEntry: true,
          notifyOnExit: true,
        };
      }),
    [stationCoordinates, stations],
  );

  const clearMarkers = () => {
    setLocation(null);
    setGeofenceEvent(null);
    setEventLog([]);
    setCurrentStationId(null);
  };

  // Handle station geofence events
  const handleGeofenceEvent = (event: GeofenceEvent) => {
    const loc: Location = event.location;
    const marker = geofences.find(m => m.identifier === event.identifier);

    if (!marker) {
      log('Error: Geofence not found');
      return;
    }

    const haversinDistance = haversine(
      {latitude: marker.latitude, longitude: marker.longitude},
      {latitude: loc.coords.latitude, longitude: loc.coords.longitude},
      {unit: 'meter'},
    );

    const isGeofencingCorrect = isWithinRange(
      haversinDistance,
      marker.radius,
      50,
    );

    log('geofenceEvent', event);
    log('isGeofencingCorrect', isGeofencingCorrect);

    const isEntry = event.action === 'ENTER';
    const logItem: EventLogItem = {
      id: `station-${Date.now()}-${event.identifier}`,
      type: 'station',
      action: isEntry ? 'entry' : 'exit',
      identifier: event.identifier,
      name: event.identifier,
      lat: loc.coords.latitude,
      lon: loc.coords.longitude,
      distance: haversinDistance,
      accuracy: loc.coords.accuracy,
      timestamp: new Date(),
    };

    setEventLog(prev => [...prev, logItem]);

    if (isEntry) {
      log('✅✅ Station ENTER:', event.identifier);
      setCurrentStationId(event.identifier);
      onStationEnter(event.identifier);

      // Switch to aggressive tracking config for amenity detection
      log('[Config] Switching to station tracking mode');
      BackgroundGeolocation.setConfig(CONFIG_STATION_TRACKING);
    } else {
      log('❌❌ Station EXIT:', event.identifier);
      onStationExit(event.identifier);
      setCurrentStationId(null);

      // Switch back to battery-efficient config
      log('[Config] Switching to battery-efficient mode');
      BackgroundGeolocation.setConfig(CONFIG_BATTERY_EFFICIENT);
    }

    log('Coordinates - lat,long', loc.coords.latitude, loc.coords.longitude);
    log('haversine distance to station center', haversinDistance);
  };

  useEffect(() => {
    if (!geofenceEvent) {
      return;
    }
    handleGeofenceEvent(geofenceEvent);
  }, [geofenceEvent]);

  const subscriptions: any[] = [];

  const subscribe = (subscription: any) => {
    subscriptions.push(subscription);
  };

  const unsubscribe = () => {
    subscriptions.forEach((subscription: any) => subscription.remove());
    subscriptions.splice(0, subscriptions.length);
  };

  useEffect(() => {
    // Set up amenity event callback
    setAmenityEventCallback((event: AmenityEvent) => {
      const logItem: EventLogItem = {
        id: `amenity-${Date.now()}-${event.amenityId}`,
        type: 'amenity',
        action: event.type === 'AMENITY_ENTER' ? 'entry' : 'exit',
        identifier: event.amenityId,
        name: event.amenityName,
        lat: event.location.latitude,
        lon: event.location.longitude,
        distance: 0,
        accuracy: event.location.accuracy,
        timestamp: new Date(event.timestamp),
      };

      setEventLog(prev => [...prev, logItem]);
      log('[UI] Amenity event:', event.type, event.amenityName);
    });

    // Try to restore amenity tracking state (in case app was killed while inside station)
    const wasRestored = restoreState();
    if (wasRestored && isTrackingActive()) {
      log('[Init] Restored amenity tracking state from persistence');
      // We're inside a station, set the UI state and switch to aggressive config
      // Note: We'd need to get the station ID from the restored state
      // For now, the tracking will work, UI update will happen on next geofence event
    }

    (async () => {
      BackgroundGeolocation.getState().then((state: State) => {
        log('Latest enable state', state.enabled);
        setEnabled(state.enabled);
      });

      log('subscribing to events');
      subscribe(BackgroundGeolocation.onEnabledChange(setEnabled));
      subscribe(
        BackgroundGeolocation.onLocation(
          locationData => {
            log(
              'Location:',
              locationData.coords.latitude,
              locationData.coords.longitude,
              locationData.coords.accuracy,
            );
            setLocation(locationData);

            // Process location for amenity tracking if inside a station
            if (isTrackingActive()) {
              processLocation({
                latitude: locationData.coords.latitude,
                longitude: locationData.coords.longitude,
                accuracy: locationData.coords.accuracy || 10,
                timestamp: String(locationData.timestamp),
              });
            }
          },
          error => {
            warn('[onLocation] ERROR:', error);
          },
        ),
      );
      subscribe(
        BackgroundGeolocation.onMotionChange(event => {
          log('[onMotionChange]', event.isMoving);
        }),
      );
      subscribe(
        BackgroundGeolocation.onGeofence(event => {
          log('geofence event', event);
          setGeofenceEvent(event);
        }),
      );
      subscribe(
        BackgroundGeolocation.onActivityChange(event => {
          // log('[onActivityChange]', event);
        }),
      );
      subscribe(
        BackgroundGeolocation.onProviderChange(event => {
          // log('[onProviderChange]', event);
        }),
      );

      // Heartbeat subscription - fires periodically when stationary
      // Critical for amenity detection when user is not moving
      subscribe(
        BackgroundGeolocation.onHeartbeat(async event => {
          const insideStation = isTrackingActive();
          const stationId = getCurrentStationId();
          const eventLat = event?.location?.coords?.latitude;
          const eventLon = event?.location?.coords?.longitude;
          log('[onHeartbeat] HEARTBEAT RECEIVED', {
            timestamp: new Date().toISOString(),
            insideStation,
            stationId,
            eventLat,
            eventLon,
          });

          // Only get position if we're inside a station
          if (insideStation) {
            try {
              const pos = await BackgroundGeolocation.getCurrentPosition({
                samples: 1,
                persist: true,
                timeout: 30,
                extras: {event: 'heartbeat'},
              });

              log(
                '[onHeartbeat] Got position:',
                pos.coords.latitude,
                pos.coords.longitude,
                pos.coords.accuracy,
              );

              setLocation(pos);

              // Process for amenity tracking
              processLocation({
                latitude: pos.coords.latitude,
                longitude: pos.coords.longitude,
                accuracy: pos.coords.accuracy || 10,
                timestamp: String(pos.timestamp),
              });
            } catch (error) {
              warn('[onHeartbeat] Failed to get position:', error);
            }
          } else {
            log(
              '[onHeartbeat] ❤️ Heartbeat received but not inside a station — amenity check skipped',
            );
          }
        }),
      );

      log('Making BackgroundGeolocation ready with config');

      const state: State = await BackgroundGeolocation.ready({
        reset: false,
        logger: {
          debug: true,
          logLevel: BackgroundGeolocation.LogLevel.Verbose,
        },
        geolocation: {
          desiredAccuracy: BackgroundGeolocation.DesiredAccuracy.High,
          distanceFilter: CONFIG_BATTERY_EFFICIENT.distanceFilter,
          stopTimeout: CONFIG_BATTERY_EFFICIENT.stopTimeout,
          locationAuthorizationRequest: 'Always',
          geofenceProximityRadius: 1000,
          geofenceInitialTriggerEntry: true,
        },
        app: {
          stopOnTerminate: false,
          startOnBoot: true,
          enableHeadless: true,
          heartbeatInterval: CONFIG_BATTERY_EFFICIENT.heartbeatInterval,
          preventSuspend: false,
          backgroundPermissionRationale: {
            title:
              "Allow {applicationName} to access this device's location even when closed or not in use.",
            message:
              'We require your location even when app is closed or not in use to track your visits to EV charging stations and amenities.',
            positiveAction: 'Change to "{backgroundPermissionOptionLabel}"',
            negativeAction: 'Cancel',
          },
        },
        http: {
          autoSync: true,
        },
        persistence: {
          maxDaysToPersist: 14,
        },
      });
      const registerGeofences = async () => {
        if (geofencesReadyRef.current) {
          return;
        }
        log('[Geofences] Registering station geofences:', geofences.length);
        await BackgroundGeolocation.addGeofences(geofences);
        geofencesReadyRef.current = true;
        log(
          '[Geofences] Registration complete (initialTriggerEntry=true — ENTER fires if already inside)',
        );
      };
      registerGeofencesRef.current = registerGeofences;

      // Await geofence registration before tracking can miss station 1
      try {
        await registerGeofences();
      } catch (error) {
        logError('[Geofences] Registration failed:', error);
      }

      if (wasRestored && isTrackingActive()) {
        await BackgroundGeolocation.setConfig(CONFIG_STATION_TRACKING);
      }

      setEnabled(state.enabled);
      log('state.enabled value:', state.enabled);

      return () => {
        geofencesReadyRef.current = false;
        registerGeofencesRef.current = null;
        unsubscribe();
        clearMarkers();
        clearAmenityEventCallback();
      };
    })();
  }, []);

  useEffect(() => {
    if (!enabled) {
      clearMarkers();
    }
  }, [enabled]);

  useEffect(() => {
    if (
      !trackMap ||
      location?.coords?.latitude == null ||
      location?.coords?.longitude == null
    ) {
      return;
    }
    const now = Date.now();
    if (now - trackThrottleRef.current < 900) {
      return;
    }
    trackThrottleRef.current = now;
    const {latitude, longitude} = location.coords;
    mapRef.current?.animateToRegion(
      {
        latitude,
        longitude,
        latitudeDelta: 0.004,
        longitudeDelta: 0.004,
      },
      350,
    );
  }, [location, trackMap]);

  const onEnableSwitchToggle = async (value: boolean) => {
    if (value) {
      try {
        if (!geofencesReadyRef.current && registerGeofencesRef.current) {
          await registerGeofencesRef.current();
        }
        await BackgroundGeolocation.start();
        setEnabled(true);
      } catch (error) {
        logError('[Geofencing] Failed to start tracking:', error);
        setEnabled(false);
      }
    } else {
      await BackgroundGeolocation.stop();
      setEnabled(false);
    }
  };

  function fitMapToAllStations() {
    const coords = stationCoordinates.map(s => ({
      latitude: s.latitude,
      longitude: s.longitude,
    }));
    if (
      location?.coords?.latitude != null &&
      location?.coords?.longitude != null
    ) {
      coords.push({
        latitude: location.coords.latitude,
        longitude: location.coords.longitude,
      });
    }
    mapRef.current?.fitToCoordinates(coords, {
      edgePadding: {top: 72, right: 16, bottom: 100, left: 16},
      animated: true,
    });
  }

  async function fitMapToCurrentLocation() {
    let lat = location?.coords?.latitude;
    let lon = location?.coords?.longitude;
    if (lat == null || lon == null) {
      try {
        const loc = await BackgroundGeolocation.getCurrentPosition({
          samples: 1,
          persist: false,
          timeout: 30,
        });
        if (loc?.coords?.latitude != null && loc?.coords?.longitude != null) {
          lat = loc.coords.latitude;
          lon = loc.coords.longitude;
          setLocation(loc);
        }
      } catch {
        return;
      }
    }
    if (lat != null && lon != null) {
      mapRef.current?.animateToRegion(
        {
          latitude: lat,
          longitude: lon,
          latitudeDelta: 0.006,
          longitudeDelta: 0.006,
        },
        400,
      );
    }
  }

  function fitMapToStation() {
    if (!currentStation) return;
    mapRef.current?.animateToRegion(
      {
        latitude: currentStation.latitude,
        longitude: currentStation.longitude,
        latitudeDelta: 0.003,
        longitudeDelta: 0.003,
      },
      400,
    );
  }

  const lastEventLabel = useMemo(() => {
    if (eventLog.length === 0) return null;
    const last = eventLog[eventLog.length - 1];
    const actionStr = last.action === 'entry' ? 'ENTER' : 'EXIT';
    const typeIcon = last.type === 'station' ? '📍' : '🏪';
    return `${typeIcon} ${actionStr} · ${last.name}`;
  }, [eventLog]);

  // Get amenity color
  const getAmenityColor = (amenityId: string) => {
    return (
      AMENITY_COLORS[amenityId as keyof typeof AMENITY_COLORS] ||
      AMENITY_COLORS.default
    );
  };

  return (
    <View style={styles.root}>
      <View style={styles.bodyTop}>
        <Text style={styles.title}>Station + Amenity Tracker</Text>
        <Text style={styles.subtitle}>
          {GEOFENCE_RADIUS_METERS}m station geofence · Turf.js amenity detection
        </Text>

        <View style={styles.statusRow}>
          <View
            style={[
              styles.statusPill,
              enabled ? styles.statusOn : styles.statusOff,
            ]}>
            <Text style={styles.statusPillText}>
              {enabled ? 'Tracking ON' : 'Tracking OFF'}
            </Text>
          </View>
          {currentStationId && (
            <View style={[styles.statusPill, styles.statusStation]}>
              <Text style={styles.statusPillText}>
                📍 Inside: {currentStationId}
              </Text>
            </View>
          )}
          {lastEventLabel && (
            <Text style={styles.lastEvent}>{lastEventLabel}</Text>
          )}
        </View>

        <View style={styles.enableCard}>
          <Text style={styles.enableLabel}>Enable tracking</Text>
          <Switch value={enabled} onValueChange={onEnableSwitchToggle} />
        </View>

        <View style={styles.metaBox}>
          <Text style={styles.metaTitle}>Live position</Text>
          <Text style={styles.metaText}>
            {location?.coords?.latitude != null &&
            location?.coords?.longitude != null
              ? `${location.coords.latitude.toFixed(
                  6,
                )}, ${location.coords.longitude.toFixed(6)}${
                  location.coords.accuracy != null
                    ? `  ·  ±${location.coords.accuracy.toFixed(0)}m`
                    : ''
                }`
              : 'Waiting for location…'}
          </Text>
          {fenceDistanceLine != null && (
            <Text style={styles.metaFenceDist}>{fenceDistanceLine}</Text>
          )}
          {amenityDistanceLine != null && (
            <Text style={styles.metaAmenityDist}>
              Amenities: {amenityDistanceLine}
            </Text>
          )}
        </View>

        <View style={[styles.historyPanel, {height: HISTORY_PANEL_H}]}>
          <Text style={styles.sectionTitle}>Activity log</Text>
          <FlatList
            data={[...eventLog].reverse()}
            style={styles.logBox}
            contentContainerStyle={styles.logBoxContent}
            showsVerticalScrollIndicator
            ListEmptyComponent={
              <Text style={styles.logEmpty}>
                No events yet. Enable tracking and enter a station zone.
              </Text>
            }
            keyExtractor={item => item.id}
            renderItem={({item}) => (
              <View style={styles.logRow}>
                <View style={styles.logHeader}>
                  <Text
                    style={[
                      styles.logAction,
                      item.action === 'entry'
                        ? styles.logEntry
                        : styles.logExit,
                    ]}>
                    {item.action === 'entry' ? 'ENTER' : 'EXIT'}
                  </Text>
                  <Text
                    style={[
                      styles.logType,
                      item.type === 'station'
                        ? styles.logTypeStation
                        : styles.logTypeAmenity,
                    ]}>
                    {item.type === 'station' ? '📍 Station' : '🏪 Amenity'}
                  </Text>
                </View>
                <Text style={styles.logName}>{item.name}</Text>
                <Text style={styles.logDetail}>
                  {item.lat.toFixed(5)}, {item.lon.toFixed(5)}
                  {item.accuracy ? ` · ±${item.accuracy.toFixed(0)}m` : ''}
                  {item.type === 'station'
                    ? ` · ${item.distance.toFixed(1)}m from center`
                    : ''}
                </Text>
                <Text style={styles.logTime}>
                  {item.timestamp.toLocaleTimeString()}
                </Text>
              </View>
            )}
          />
        </View>
      </View>

      <View style={[styles.mapWrap, {minHeight: MAP_MIN_HEIGHT}]}>
        <MapView
          ref={mapRef}
          style={styles.map}
          mapType="standard"
          loadingEnabled
          showsBuildings={Platform.OS === 'ios'}
          initialRegion={defaultMapRegion}
          showsUserLocation>
          {/* Station geofence circles */}
          {stations.map((station, index) => {
            const ring = STATION_FENCE_RING[index % STATION_FENCE_RING.length];
            return (
              <Circle
                key={`${station.id}-ring`}
                center={{
                  latitude: station.latitude,
                  longitude: station.longitude,
                }}
                radius={station.radiusMeters}
                strokeWidth={2}
                strokeColor={ring.stroke}
                fillColor={ring.fill}
              />
            );
          })}

          {/* Station markers */}
          {stations.map((station, index) => (
            <Marker
              key={station.id}
              coordinate={{
                latitude: station.latitude,
                longitude: station.longitude,
              }}
              title={station.name}
              description={`${station.radiusMeters}m geofence · ${station.amenities.length} amenities`}
              pinColor={STATION_PIN_COLORS[index % STATION_PIN_COLORS.length]}
            />
          ))}

          {/* Amenity circles and polygons (always visible) */}
          {stations.map(station =>
            station.amenities.map(amenity => {
              const color = getAmenityColor(amenity.id);

              if (amenity.type === 'circle') {
                return (
                  <Circle
                    key={`${station.id}-${amenity.id}`}
                    center={{
                      latitude: amenity.latitude,
                      longitude: amenity.longitude,
                    }}
                    radius={amenity.radiusMeters || 20}
                    strokeWidth={2}
                    strokeColor={color.stroke}
                    fillColor={color.fill}
                  />
                );
              } else if (amenity.type === 'polygon' && amenity.polygon) {
                return (
                  <Polygon
                    key={`${station.id}-${amenity.id}`}
                    coordinates={amenity.polygon.map(([lon, lat]) => ({
                      latitude: lat,
                      longitude: lon,
                    }))}
                    strokeWidth={2}
                    strokeColor={color.stroke}
                    fillColor={color.fill}
                  />
                );
              }
              return null;
            }),
          )}

          {/* Amenity markers */}
          {stations.map(station =>
            station.amenities.map(amenity => (
              <Marker
                key={`marker-${station.id}-${amenity.id}`}
                coordinate={{
                  latitude: amenity.latitude,
                  longitude: amenity.longitude,
                }}
                title={amenity.name}
                description={
                  amenity.type === 'circle'
                    ? `${amenity.radiusMeters}m radius`
                    : 'Polygon area'
                }
                pinColor="orange"
                opacity={0.9}
              />
            )),
          )}
        </MapView>
        <View style={styles.mapOverlay} pointerEvents="box-none">
          <Pressable
            style={[styles.mapChip, trackMap && styles.mapChipActive]}
            onPress={() => setTrackMap(v => !v)}>
            <Text style={styles.mapChipText}>Track me</Text>
          </Pressable>
          <Pressable style={styles.mapChip} onPress={fitMapToAllStations}>
            <Text style={styles.mapChipText}>All zones</Text>
          </Pressable>
          <Pressable
            style={styles.mapChip}
            onPress={() => void fitMapToCurrentLocation()}>
            <Text style={styles.mapChipText}>My location</Text>
          </Pressable>
          {currentStation && (
            <Pressable
              style={[styles.mapChip, styles.mapChipStation]}
              onPress={fitMapToStation}>
              <Text style={styles.mapChipText}>Station view</Text>
            </Pressable>
          )}
        </View>
      </View>

      <View style={styles.bodyBottom}>
        {currentStation && (
          <View style={styles.amenityBox}>
            <Text style={styles.amenityTitle}>
              Amenities at {currentStation.name}
            </Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={styles.amenityScroll}>
              {currentStation.amenities.map(amenity => {
                const color = getAmenityColor(amenity.id);
                return (
                  <View
                    key={amenity.id}
                    style={[
                      styles.amenityChip,
                      {borderColor: color.stroke, backgroundColor: color.fill},
                    ]}>
                    <Text style={styles.amenityChipText}>{amenity.name}</Text>
                    <Text style={styles.amenityChipSub}>
                      {amenity.type === 'circle'
                        ? `${amenity.radiusMeters}m`
                        : 'polygon'}
                    </Text>
                  </View>
                );
              })}
            </ScrollView>
          </View>
        )}

        <View
          style={[
            styles.overlapBox,
            overlapPairs.length > 0
              ? styles.overlapBoxWarn
              : styles.overlapBoxOk,
          ]}>
          <Text style={styles.overlapTitle}>Fence overlap check</Text>
          {overlapPairs.length === 0 ? (
            <Text style={styles.overlapOk}>
              No overlapping station geofences.
            </Text>
          ) : (
            <>
              <Text style={styles.overlapWarn}>Overlapping pairs:</Text>
              {overlapPairs.map(p => (
                <Text key={`${p.idA}-${p.idB}`} style={styles.overlapLine}>
                  {p.idA} ↔ {p.idB}: {p.distanceM.toFixed(0)}m between centers
                </Text>
              ))}
            </>
          )}
        </View>

        <View style={styles.refBox}>
          <Text style={styles.refTitle}>Configured zones</Text>
          <ScrollView
            nestedScrollEnabled
            style={styles.refScroll}
            showsVerticalScrollIndicator>
            {stations.map(s => (
              <View key={s.id}>
                <Text style={styles.refLine}>
                  📍 {s.id}: {s.latitude.toFixed(6)}, {s.longitude.toFixed(6)} ·{' '}
                  {s.radiusMeters}m
                </Text>
                {s.amenities.map(a => (
                  <Text key={a.id} style={styles.refLineAmenity}>
                    {'    '}🏪 {a.name}: {a.latitude.toFixed(6)},{' '}
                    {a.longitude.toFixed(6)}
                    {a.type === 'circle'
                      ? ` · ${a.radiusMeters}m`
                      : ' · polygon'}
                  </Text>
                ))}
              </View>
            ))}
          </ScrollView>
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  root: {
    flex: 1,
    minHeight: 0,
  },
  bodyTop: {
    flexShrink: 0,
  },
  bodyBottom: {
    flexShrink: 0,
    paddingBottom: 8,
  },
  title: {
    color: '#e2e8f0',
    fontSize: 22,
    fontWeight: '700',
    marginBottom: 4,
  },
  subtitle: {
    color: '#94a3b8',
    fontSize: 13,
    marginBottom: 10,
    lineHeight: 18,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 10,
  },
  statusPill: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 16,
  },
  statusOn: {
    backgroundColor: 'rgba(22, 163, 74, 0.35)',
    borderWidth: 1,
    borderColor: '#22c55e',
  },
  statusOff: {
    backgroundColor: 'rgba(127, 29, 29, 0.5)',
    borderWidth: 1,
    borderColor: '#f87171',
  },
  statusStation: {
    backgroundColor: 'rgba(59, 130, 246, 0.35)',
    borderWidth: 1,
    borderColor: '#3b82f6',
  },
  statusPillText: {
    color: '#f8fafc',
    fontSize: 11,
    fontWeight: '700',
  },
  lastEvent: {
    color: '#a5b4fc',
    fontSize: 11,
    fontWeight: '600',
  },
  enableCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#1e293b',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 10,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#334155',
  },
  enableLabel: {
    color: '#e2e8f0',
    fontSize: 15,
    fontWeight: '600',
  },
  metaBox: {
    marginBottom: 10,
    padding: 10,
    borderRadius: 10,
    backgroundColor: '#1e293b',
    borderLeftWidth: 4,
    borderLeftColor: '#38bdf8',
  },
  metaTitle: {
    color: '#7dd3fc',
    fontSize: 10,
    fontWeight: '700',
    marginBottom: 4,
    letterSpacing: 0.6,
  },
  metaText: {
    color: '#e2e8f0',
    fontSize: 13,
  },
  metaFenceDist: {
    color: '#a5b4fc',
    fontSize: 10,
    marginTop: 6,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    lineHeight: 14,
  },
  metaAmenityDist: {
    color: '#fbbf24',
    fontSize: 10,
    marginTop: 4,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    lineHeight: 14,
  },
  sectionTitle: {
    color: '#e2e8f0',
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 6,
  },
  historyPanel: {
    marginBottom: 10,
    flexShrink: 0,
  },
  logBox: {
    flex: 1,
    backgroundColor: '#111827',
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingTop: 8,
    borderWidth: 1,
    borderColor: '#1f2937',
    borderLeftWidth: 4,
    borderLeftColor: '#22c55e',
  },
  logBoxContent: {
    paddingBottom: 8,
    flexGrow: 1,
  },
  logEmpty: {
    color: '#64748b',
    fontSize: 12,
    fontStyle: 'italic',
    paddingVertical: 10,
    lineHeight: 18,
  },
  logRow: {
    marginBottom: 8,
    paddingBottom: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#334155',
  },
  logHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 2,
  },
  logAction: {
    fontSize: 11,
    fontWeight: '800',
  },
  logEntry: {
    color: '#4ade80',
  },
  logExit: {
    color: '#fb923c',
  },
  logType: {
    fontSize: 10,
    fontWeight: '600',
  },
  logTypeStation: {
    color: '#60a5fa',
  },
  logTypeAmenity: {
    color: '#fbbf24',
  },
  logName: {
    color: '#f1f5f9',
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 2,
  },
  logDetail: {
    color: '#94a3b8',
    fontSize: 10,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    lineHeight: 14,
  },
  logTime: {
    color: '#64748b',
    fontSize: 9,
    marginTop: 2,
  },
  map: {
    ...StyleSheet.absoluteFillObject,
  },
  mapWrap: {
    flex: 1,
    minHeight: 0,
    borderRadius: 12,
    marginBottom: 8,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#334155',
  },
  mapOverlay: {
    position: 'absolute',
    left: 8,
    right: 8,
    bottom: 10,
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
    gap: 6,
  },
  mapChip: {
    backgroundColor: 'rgba(15, 23, 42, 0.92)',
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#475569',
  },
  mapChipText: {
    color: '#f1f5f9',
    fontSize: 11,
    fontWeight: '700',
  },
  mapChipActive: {
    borderColor: '#22c55e',
    backgroundColor: 'rgba(20, 83, 45, 0.95)',
  },
  mapChipStation: {
    borderColor: '#3b82f6',
    backgroundColor: 'rgba(30, 58, 138, 0.95)',
  },
  amenityBox: {
    marginBottom: 8,
    padding: 8,
    borderRadius: 10,
    backgroundColor: '#1e293b',
    borderWidth: 1,
    borderColor: '#fbbf24',
  },
  amenityTitle: {
    color: '#fbbf24',
    fontSize: 11,
    fontWeight: '700',
    marginBottom: 6,
  },
  amenityScroll: {
    flexDirection: 'row',
  },
  amenityChip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    marginRight: 8,
  },
  amenityChipText: {
    color: '#f8fafc',
    fontSize: 11,
    fontWeight: '600',
  },
  amenityChipSub: {
    color: '#cbd5e1',
    fontSize: 9,
    marginTop: 2,
  },
  overlapBox: {
    marginBottom: 8,
    padding: 8,
    borderRadius: 10,
    borderWidth: 1,
  },
  overlapBoxOk: {
    backgroundColor: 'rgba(20, 83, 45, 0.35)',
    borderColor: '#22c55e',
  },
  overlapBoxWarn: {
    backgroundColor: 'rgba(127, 29, 29, 0.45)',
    borderColor: '#f87171',
  },
  overlapTitle: {
    color: '#f8fafc',
    fontSize: 11,
    fontWeight: '700',
    marginBottom: 4,
  },
  overlapOk: {
    color: '#bbf7d0',
    fontSize: 11,
    lineHeight: 16,
  },
  overlapWarn: {
    color: '#fecaca',
    fontSize: 11,
    marginBottom: 4,
    fontWeight: '600',
  },
  overlapLine: {
    color: '#fecaca',
    fontSize: 10,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    marginBottom: 2,
    lineHeight: 14,
  },
  refBox: {
    padding: 8,
    borderRadius: 10,
    backgroundColor: '#0c4a6e',
    borderWidth: 1,
    borderColor: '#0369a1',
  },
  refTitle: {
    color: '#e0f2fe',
    fontSize: 11,
    fontWeight: '700',
    marginBottom: 6,
  },
  refLine: {
    color: '#f0f9ff',
    fontSize: 10,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    marginBottom: 3,
    lineHeight: 14,
  },
  refLineAmenity: {
    color: '#bae6fd',
    fontSize: 9,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    marginBottom: 2,
    lineHeight: 13,
  },
  refScroll: {
    maxHeight: 100,
  },
});
