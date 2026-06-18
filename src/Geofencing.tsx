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
import MapView, {Circle, Marker} from 'react-native-maps';
import BackgroundGeolocation, {
  GeofenceEvent,
  Location,
} from 'react-native-background-geolocation';
import haversine from 'haversine';
import {isWithinRange} from './helpers';
import {AndroidStationCoordinates, IOSStationCoordinates} from './constants';
// import BackgroundFetch from 'react-native-background-fetch';
import {State} from './react-native-background-geolocation';
import {findOverlappingPairs} from './mapOverlap';

const GEOFENCE_RADIUS_METERS = 100;

const STATION_PIN_COLORS = ['red', 'green', 'purple'] as const;

const STATION_FENCE_RING = [
  {stroke: 'rgba(220, 38, 38, 0.95)', fill: 'rgba(220, 38, 38, 0.14)'},
  {stroke: 'rgba(22, 163, 74, 0.95)', fill: 'rgba(22, 163, 74, 0.14)'},
  {stroke: 'rgba(126, 34, 206, 0.95)', fill: 'rgba(126, 34, 206, 0.14)'},
] as const;

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

export const Geofencing = () => {
  const mapRef = useRef<MapView>(null);
  const trackThrottleRef = useRef(0);
  const [trackMap, setTrackMap] = useState(false);

  const [enabled, setEnabled] = useState(false);
  const [location, setLocation] = React.useState<Location | null>(null);
  const [geofenceEvent, setGeofenceEvent] =
    React.useState<GeofenceEvent | null>(null);

  const [pings, setPings] = useState<
    {
      stationId: string;
      action: 'entry' | 'exit';
      lat: number;
      long: number;
      haversineDistance: number;
    }[]
  >([]);

  const stationCoordinates =
    Platform.OS === 'ios' ? IOSStationCoordinates : AndroidStationCoordinates;

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

  const fenceDistanceLine = useMemo(() => {
    if (
      location?.coords?.latitude == null ||
      location?.coords?.longitude == null
    ) {
      return null;
    }
    const lat = location.coords.latitude;
    const lon = location.coords.longitude;
    return stationCoordinates
      .map(s => {
        const d = haversine(
          {latitude: s.latitude, longitude: s.longitude},
          {latitude: lat, longitude: lon},
          {unit: 'meter'},
        );
        const inside = d <= GEOFENCE_RADIUS_METERS;
        return `${s.id}: ${d.toFixed(0)} m (${inside ? 'inside' : 'outside'})`;
      })
      .join(' · ');
  }, [location, stationCoordinates]);

  const geofences = stationCoordinates.map(eachCordinate => {
    return {
      identifier: eachCordinate.id,
      radius: GEOFENCE_RADIUS_METERS,
      latitude: eachCordinate.latitude,
      longitude: eachCordinate.longitude,
      notifyOnEntry: true,
      notifyOnExit: true,
    };
  });

  /// Clear all markers when plugin is toggled off.
  const clearMarkers = () => {
    setLocation(null);
    setGeofenceEvent(null);
    setPings([]);
  };

  const onGeofence = () => {
    if (!geofenceEvent) {
      return;
    }
    const location: Location = geofenceEvent.location;
    const marker = geofences.find((m: any) => {
      return m.identifier === geofenceEvent.identifier;
    });

    if (!marker) {
      console.log('Error: Geofence not found');
      return;
    }

    const haversinDistance = haversine(
      {
        latitude: marker.latitude,
        longitude: marker.longitude,
      },
      {
        latitude: location.coords.latitude,
        longitude: location.coords.longitude,
      },
      {unit: 'meter'},
    );

    const isGeofencingCorrect = isWithinRange(
      haversinDistance,
      GEOFENCE_RADIUS_METERS,
      50,
    );

    console.log('geofenceEvent', geofenceEvent);
    console.log('isGeofencingCorrect', isGeofencingCorrect);

    if (geofenceEvent.action === 'ENTER') {
      console.log('✅✅ Geofence Enter', marker.identifier);
      setPings(prevPings => [
        ...prevPings,
        {
          stationId: marker.identifier,
          action: 'entry',
          lat: location.coords.latitude,
          long: location.coords.longitude,
          haversineDistance: haversinDistance,
        },
      ]);
    } else if (geofenceEvent.action === 'EXIT') {
      console.log('❌❌ Geofence Exit', marker.identifier);
      setPings(prevPings => [
        ...prevPings,
        {
          stationId: marker.identifier,
          action: 'exit',
          lat: location.coords.latitude,
          long: location.coords.longitude,
          haversineDistance: haversinDistance,
        },
      ]);
    }
    console.log(
      'Cordinates - lat,long',
      location.coords.latitude,
      location.coords.longitude,
    );
    console.log('haversine distance should be close to 50 m', haversinDistance);
    //for entry and exit make the api call for geofence
  };

  useEffect(() => {
    if (!geofenceEvent) {
      return;
    }
    onGeofence();
  }, [geofenceEvent]);

  /// Collection of BackgroundGeolocation event-subscriptions.
  const subscriptions: any[] = [];

  /// [Helper] Add a BackgroundGeolocation event subscription to collection
  const subscribe = (subscription: any) => {
    subscriptions.push(subscription);
  };

  /// [Helper] Iterate BackgroundGeolocation subscriptions and .remove() each.
  const unsubscribe = () => {
    subscriptions.forEach((subscription: any) => subscription.remove());
    subscriptions.splice(0, subscriptions.length);
  };

  const initBackgroundFetch = async () => {
    // BackgroundFetch.configure(
    //   {
    //     minimumFetchInterval: 15,
    //     enableHeadless: true,
    //     stopOnTerminate: false,
    //   },
    //   async taskId => {
    //     console.log('[BackgroundFetch]', taskId);
    //     const locationData = await BackgroundGeolocation.getCurrentPosition({
    //       extras: {
    //         event: 'background-fetch',
    //       },
    //       maximumAge: 10000,
    //       persist: true,
    //       timeout: 30,
    //       samples: 2,
    //     });
    //     console.log('BACKGROUND FETCH: [getCurrentPosition]', locationData);
    //     BackgroundFetch.finish(taskId);
    //   },
    //   async taskId => {
    //     console.log('[BackgroundFetch] TIMEOUT:', taskId);
    //     BackgroundFetch.finish(taskId);
    //   },
    // );
  };

  useEffect(() => {
    (async () => {
      //get latest enabled value and set it
      BackgroundGeolocation.getState().then((state: State) => {
        console.log('Latest enable state', state.enabled);
        setEnabled(state.enabled);
      });

      //Subscribe to events.
      console.log('subscribing to events');
      subscribe(BackgroundGeolocation.onEnabledChange(setEnabled));
      subscribe(
        BackgroundGeolocation.onLocation(
          locationData => {
            console.log(
              'Lattitude, Longitude',
              locationData.coords.latitude,
              locationData.coords.longitude,
            );
            setLocation(locationData);
          },
          error => {
            console.warn('[onLocation] ERROR: ', error);
          },
        ),
      );
      subscribe(
        BackgroundGeolocation.onMotionChange(event => {
          // console.log('[onMotionChange]', event);
        }),
      );
      subscribe(
        BackgroundGeolocation.onGeofence(event => {
          console.log('event', event);
          setGeofenceEvent(event);
        }),
      );
      subscribe(
        BackgroundGeolocation.onActivityChange(event => {
          // console.log('[onActivityChange]', event);
        }),
      );
      subscribe(
        BackgroundGeolocation.onProviderChange(event => {
          // console.log('[onProviderChange]', event);
        }),
      );
      /// 2. ready the plugin.
      console.log('Making BackgroundGeolocation ready with config');

      // initBackgroundFetch();

      const state: State = await BackgroundGeolocation.ready({
        reset: false,
        logger: {
          debug: true, // <-- enable this hear sounds for background-geolocation life-cycle.
          logLevel: BackgroundGeolocation.LogLevel.Verbose,
        },
        geolocation: {
          desiredAccuracy: BackgroundGeolocation.DesiredAccuracy.High,
          distanceFilter: 5, // Lower = more frequent location updates
          stopTimeout: 1, // Faster transition to stationary
          locationAuthorizationRequest: 'Always',
          geofenceProximityRadius: 1000, // Keep all geofences active within 1km
          geofenceInitialTriggerEntry: false, // Don't fire ENTER if already inside on registration
        },
        app: {
          stopOnTerminate: false, // <-- Allow the background-service to continue tracking when user closes the app.
          startOnBoot: true, // <-- Auto start tracking when device is powered-up.,
          enableHeadless: true,
          backgroundPermissionRationale: {
            title:
              "Allow {applicationName} to access this device's location even when closed or not in use.",
            message:
              'We require your location even when app is closed or not in use to recommend you offers based on places you visit.',
            positiveAction: 'Change to "{backgroundPermissionOptionLabel}"',
            negativeAction: 'Cancel',
          },
        },
        http: {
          autoSync: true, // <-- [Default: true] Set true to sync each location to server as it arrives.
          //url: 'http://yourserver.com/locations',
        },
        persistence: {
          maxDaysToPersist: 14,
        },
      });
      setEnabled(state.enabled);
      console.log('state.enabled value: ', state.enabled);
      console.log(
        'Ready Success : Now adding geofence for all stations with 50 m radius',
      );
      BackgroundGeolocation.addGeofences(geofences)
        .then(() => {
          console.log('Success: Geofence created for station1');
        })
        .catch(error => {
          console.log('Error: Error while creating geofences');
        });

      return () => {
        // Remove BackgroundGeolocation event-subscribers when the View is removed or refreshed
        // during development live-reload.  Without this, event-listeners will accumulate with
        // each refresh during live-reload.
        unsubscribe();
        clearMarkers();
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
        latitudeDelta: 0.008,
        longitudeDelta: 0.008,
      },
      350,
    );
  }, [location, trackMap]);

  const onEnableSwitchToggle = async (value: boolean) => {
    setEnabled(value);
    if (value) {
      // Use start() for full location tracking - more responsive geofence events
      // Note: startGeofences() is lower power but iOS delays EXIT events significantly
      BackgroundGeolocation.start();
    } else {
      BackgroundGeolocation.stop();
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
          latitudeDelta: 0.025,
          longitudeDelta: 0.025,
        },
        400,
      );
    }
  }

  const lastEventLabel =
    geofenceEvent != null
      ? `${geofenceEvent.action} · ${geofenceEvent.identifier}`
      : null;

  return (
    <View style={styles.root}>
      <View style={styles.bodyTop}>
        <Text style={styles.title}>Geofence demo</Text>
        <Text style={styles.subtitle}>
          Hyderabad · {GEOFENCE_RADIUS_METERS} m Apple MapKit preview (iOS)
        </Text>

        <View style={styles.statusRow}>
          <View
            style={[
              styles.statusPill,
              enabled ? styles.statusOn : styles.statusOff,
            ]}>
            <Text style={styles.statusPillText}>
              {enabled ? 'Monitoring ON' : 'Monitoring OFF'}
            </Text>
          </View>
          {lastEventLabel ? (
            <Text style={styles.lastEvent}>{lastEventLabel}</Text>
          ) : null}
        </View>

        <View style={styles.enableCard}>
          <Text style={styles.enableLabel}>Enable geofencing</Text>
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
                    ? `  ·  ±${location.coords.accuracy.toFixed(0)} m`
                    : ''
                }`
              : 'Waiting for location…'}
          </Text>
          {fenceDistanceLine != null ? (
            <Text style={styles.metaFenceDist}>{fenceDistanceLine}</Text>
          ) : null}
        </View>

        <View style={[styles.historyPanel, {height: HISTORY_PANEL_H}]}>
          <Text style={styles.sectionTitle}>Geofence activity</Text>
          <FlatList
            data={[...pings].reverse()}
            style={styles.logBox}
            contentContainerStyle={styles.logBoxContent}
            showsVerticalScrollIndicator
            ListEmptyComponent={
              <Text style={styles.logEmpty}>
                No enter/exit events yet. Toggle monitoring and move between
                zones.
              </Text>
            }
            keyExtractor={(item, index) =>
              `${index}-${item.stationId}-${item.action}-${item.lat}`
            }
            renderItem={({item}) => (
              <View style={styles.logRow}>
                <Text
                  style={[
                    styles.logAction,
                    item.action === 'entry' ? styles.logEntry : styles.logExit,
                  ]}>
                  {item.action === 'entry' ? 'ENTER' : 'EXIT'}
                </Text>
                <Text style={styles.logDetail}>
                  {item.stationId} · {item.haversineDistance.toFixed(1)} m ·{' '}
                  {item.lat.toFixed(5)}, {item.long.toFixed(5)}
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
          {stationCoordinates.map((station, index) => {
            const ring = STATION_FENCE_RING[index % STATION_FENCE_RING.length];
            return (
              <Circle
                key={`${station.id}-ring`}
                center={{
                  latitude: station.latitude,
                  longitude: station.longitude,
                }}
                radius={GEOFENCE_RADIUS_METERS}
                strokeWidth={2}
                strokeColor={ring.stroke}
                fillColor={ring.fill}
              />
            );
          })}
          {stationCoordinates.map((station, index) => (
            <Marker
              key={station.id}
              coordinate={{
                latitude: station.latitude,
                longitude: station.longitude,
              }}
              title={station.id}
              description={`${GEOFENCE_RADIUS_METERS} m geofence`}
              pinColor={STATION_PIN_COLORS[index % STATION_PIN_COLORS.length]}
            />
          ))}
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
        </View>
      </View>

      <View style={styles.bodyBottom}>
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
              No overlapping pairs at current radii — clean signals for demos.
            </Text>
          ) : (
            <>
              <Text style={styles.overlapWarn}>Overlapping pairs:</Text>
              {overlapPairs.map(p => (
                <Text key={`${p.idA}-${p.idB}`} style={styles.overlapLine}>
                  {p.idA} ↔ {p.idB}: {p.distanceM.toFixed(0)} m between centers
                  · radii sum {p.sumRadiiM} m
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
            {stationCoordinates.map(s => (
              <Text key={s.id} style={styles.refLine}>
                {s.id}: {s.latitude.toFixed(6)}, {s.longitude.toFixed(6)} ·{' '}
                {GEOFENCE_RADIUS_METERS} m
              </Text>
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
    fontSize: 24,
    fontWeight: '700',
    marginBottom: 6,
  },
  subtitle: {
    color: '#94a3b8',
    fontSize: 14,
    marginBottom: 12,
    lineHeight: 20,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 12,
  },
  statusPill: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
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
  statusPillText: {
    color: '#f8fafc',
    fontSize: 12,
    fontWeight: '700',
  },
  lastEvent: {
    color: '#a5b4fc',
    fontSize: 12,
    fontWeight: '600',
  },
  enableCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#1e293b',
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 10,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#334155',
  },
  enableLabel: {
    color: '#e2e8f0',
    fontSize: 16,
    fontWeight: '600',
  },
  metaBox: {
    marginBottom: 12,
    padding: 12,
    borderRadius: 10,
    backgroundColor: '#1e293b',
    borderLeftWidth: 4,
    borderLeftColor: '#38bdf8',
  },
  metaTitle: {
    color: '#7dd3fc',
    fontSize: 11,
    fontWeight: '700',
    marginBottom: 6,
    letterSpacing: 0.6,
  },
  metaText: {
    color: '#e2e8f0',
    fontSize: 14,
  },
  metaFenceDist: {
    color: '#a5b4fc',
    fontSize: 11,
    marginTop: 8,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    lineHeight: 16,
  },
  sectionTitle: {
    color: '#e2e8f0',
    fontSize: 15,
    fontWeight: '600',
    marginBottom: 8,
  },
  historyPanel: {
    marginBottom: 12,
    flexShrink: 0,
  },
  logBox: {
    flex: 1,
    backgroundColor: '#111827',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingTop: 10,
    borderWidth: 1,
    borderColor: '#1f2937',
    borderLeftWidth: 4,
    borderLeftColor: '#22c55e',
  },
  logBoxContent: {
    paddingBottom: 10,
    flexGrow: 1,
  },
  logEmpty: {
    color: '#64748b',
    fontSize: 13,
    fontStyle: 'italic',
    paddingVertical: 12,
    lineHeight: 20,
  },
  logRow: {
    marginBottom: 10,
    paddingBottom: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#334155',
  },
  logAction: {
    fontSize: 12,
    fontWeight: '800',
    marginBottom: 4,
  },
  logEntry: {
    color: '#4ade80',
  },
  logExit: {
    color: '#fb923c',
  },
  logDetail: {
    color: '#cbd5e1',
    fontSize: 11,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    lineHeight: 16,
  },
  map: {
    ...StyleSheet.absoluteFillObject,
  },
  mapWrap: {
    flex: 1,
    minHeight: 0,
    borderRadius: 12,
    marginBottom: 10,
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
    gap: 8,
  },
  mapChip: {
    backgroundColor: 'rgba(15, 23, 42, 0.92)',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#475569',
  },
  mapChipText: {
    color: '#f1f5f9',
    fontSize: 12,
    fontWeight: '700',
  },
  mapChipActive: {
    borderColor: '#22c55e',
    backgroundColor: 'rgba(20, 83, 45, 0.95)',
  },
  overlapBox: {
    marginBottom: 10,
    padding: 10,
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
    fontSize: 12,
    fontWeight: '700',
    marginBottom: 6,
  },
  overlapOk: {
    color: '#bbf7d0',
    fontSize: 12,
    lineHeight: 18,
  },
  overlapWarn: {
    color: '#fecaca',
    fontSize: 12,
    marginBottom: 6,
    fontWeight: '600',
  },
  overlapLine: {
    color: '#fecaca',
    fontSize: 11,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    marginBottom: 4,
    lineHeight: 16,
  },
  refBox: {
    padding: 10,
    borderRadius: 10,
    backgroundColor: '#0c4a6e',
    borderWidth: 1,
    borderColor: '#0369a1',
  },
  refTitle: {
    color: '#e0f2fe',
    fontSize: 12,
    fontWeight: '700',
    marginBottom: 8,
  },
  refLine: {
    color: '#f0f9ff',
    fontSize: 11,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    marginBottom: 4,
    lineHeight: 16,
  },
  refScroll: {
    maxHeight: 100,
  },
});
