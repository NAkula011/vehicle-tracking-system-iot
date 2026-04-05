import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useVehicle } from '@/contexts/VehicleContext';

interface VehicleMapProps {
  showRoute?: boolean;
  className?: string;
  // external route coordinates to render (array of [lat, lng]) - used for OSRM or custom routing
  routeCoordinates?: [number, number][] | null;
  systemLocation?: { lat: number; lng: number } | null;
}

const VehicleMap: React.FC<VehicleMapProps> = ({ showRoute = false, className = '', routeCoordinates = null, systemLocation = null }) => {
  const { data, onlineDevices, selectedDeviceId } = useVehicle();
  const [autoZoomEnabled, setAutoZoomEnabled] = useState(true);
  const [focusMode, setFocusMode] = useState<'fit' | 'vehicle' | 'user'>('fit');
  const [mapZoom, setMapZoom] = useState(15);
  const FOCUS_TARGET_ZOOM = 17;
  const mapElementRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markerRef = useRef<L.Marker | null>(null);
  const systemMarkerRef = useRef<L.CircleMarker | null>(null);
  const routeRef = useRef<L.Polyline | null>(null);
  const lastPanPositionRef = useRef<[number, number] | null>(null);
  const lastSystemPanPositionRef = useRef<[number, number] | null>(null);

  const position = useMemo<[number, number]>(() => [data.latitude, data.longitude], [data.latitude, data.longitude]);

  const getFitPoints = useCallback((): [number, number][] => {
    const points: [number, number][] = [];

    if (routeCoordinates && routeCoordinates.length > 0) {
      points.push(...routeCoordinates);
    }

    if (Number.isFinite(position[0]) && Number.isFinite(position[1])) {
      points.push(position);
    }

    if (systemLocation && Number.isFinite(systemLocation.lat) && Number.isFinite(systemLocation.lng)) {
      points.push([systemLocation.lat, systemLocation.lng]);
    }

    return points;
  }, [routeCoordinates, position, systemLocation]);

  const fitMapToPoints = useCallback(() => {
    if (!mapRef.current) return;
    const points = getFitPoints();
    if (points.length === 0) return;

    if (points.length === 1) {
      mapRef.current.setView(points[0], Math.max(mapRef.current.getZoom(), 15), { animate: true });
      return;
    }

    const bounds = L.latLngBounds(points.map((p) => L.latLng(p[0], p[1])));
    mapRef.current.fitBounds(bounds, { padding: [36, 36], maxZoom: 16, animate: true });
  }, [getFitPoints]);

  const focusTarget = useCallback(
    (target: [number, number]) => {
      if (!mapRef.current) return;
      if (autoZoomEnabled) {
        mapRef.current.flyTo(target, FOCUS_TARGET_ZOOM, { animate: true, duration: 0.7 });
      } else {
        mapRef.current.panTo(target, { animate: true, duration: 0.6 });
      }
    },
    [autoZoomEnabled, FOCUS_TARGET_ZOOM]
  );

  const getVehicleIconSize = (zoom: number) => {
    // Slight dynamic sizing only; avoids abrupt jumps when zoom changes.
    const base = 56;
    const delta = Math.max(-2, Math.min(6, (zoom - 15) * 1.5));
    return Math.round(base + delta);
  };

  const createBikeIcon = (rotation = 0, faded = false, zoom = 15) => {
    const size = getVehicleIconSize(zoom);
    const anchor = Math.round(size / 2);
    return L.divIcon({
      html: `<div class="map-vehicle-icon-wrap ${faded ? 'map-vehicle-icon-wrap--faded' : ''}" style="width:${size}px;height:${size}px;"><img src="/Bike1.png" class="map-vehicle-icon" style="width:${size}px;height:${size}px;transform:rotate(${rotation}deg);" alt="vehicle"/></div>`,
      className: '',
      iconSize: [size, size],
      iconAnchor: [anchor, anchor],
    });
  };

  useEffect(() => {
    if (!mapElementRef.current || mapRef.current) return;

    const map = L.map(mapElementRef.current, {
      zoomControl: true,
      attributionControl: true,
    }).setView(position, 15);
    setMapZoom(map.getZoom());

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a>',
    }).addTo(map);

    const bearing = computeBearingFromHistory(data.routeHistory) ?? 0;
    const marker = L.marker(position, { icon: data.deviceConnected ? createBikeIcon(bearing, false, map.getZoom()) : createBikeIcon(bearing, true, map.getZoom()) }).addTo(map);
    marker.bindPopup(
      `<div style="font-size:12px;line-height:1.5;"><strong>${data.vehicleId}</strong><br/>Speed: ${data.speed} km/h<br/>Lat: ${data.latitude.toFixed(6)}<br/>Lng: ${data.longitude.toFixed(6)}</div>`
    );

    mapRef.current = map;
    markerRef.current = marker;
    lastPanPositionRef.current = position;

    if (systemLocation) {
      systemMarkerRef.current = L.circleMarker([systemLocation.lat, systemLocation.lng], {
        radius: 8,
        color: 'hsl(195, 95%, 50%)',
        weight: 3,
        fillColor: 'hsl(195, 95%, 50%)',
        fillOpacity: 0.9,
      }).addTo(map);
      systemMarkerRef.current.bindPopup('<strong>Your location</strong>');
    }

    const initialRoute = routeCoordinates ?? (showRoute && data.routeHistory.length > 1 ? data.routeHistory : null);
    if (initialRoute) {
      routeRef.current = L.polyline(initialRoute, {
        color: 'hsl(265, 90%, 60%)',
        weight: 3,
        opacity: 0.8,
        dashArray: '10, 5',
      }).addTo(map);
    }

    const handleZoomEnd = () => setMapZoom(map.getZoom());
    map.on('zoomend', handleZoomEnd);

    return () => {
      map.off('zoomend', handleZoomEnd);
      routeRef.current?.remove();
      markerRef.current?.remove();
      systemMarkerRef.current?.remove();
      map.remove();
      routeRef.current = null;
      markerRef.current = null;
      systemMarkerRef.current = null;
      mapRef.current = null;
      lastPanPositionRef.current = null;
      lastSystemPanPositionRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!mapRef.current || !markerRef.current) return;

    markerRef.current.setLatLng(position);
    // update icon depending on live vs last-known and rotate according to recent bearing
    try {
      const bearing = computeBearingFromHistory(data.routeHistory) ?? 0;
      markerRef.current.setIcon(data.deviceConnected ? createBikeIcon(bearing, false, mapZoom) : createBikeIcon(bearing, true, mapZoom));
    } catch (e) {
      // ignore setIcon errors in SSR/test env
    }
    const markerEl = markerRef.current.getElement();
    if (markerEl) {
      markerEl.style.transition = 'transform 620ms linear';
      markerEl.style.willChange = 'transform';
    }
    markerRef.current.setPopupContent(
      `<div style="font-size:12px;line-height:1.5;"><strong>${data.vehicleId}</strong><br/>Speed: ${data.speed} km/h<br/>Lat: ${data.latitude.toFixed(6)}<br/>Lng: ${data.longitude.toFixed(6)}</div>`
    );

    // prefer external routeCoordinates when provided, otherwise use data.routeHistory if showRoute
    const desiredRoute = routeCoordinates ?? (showRoute ? (data.routeHistory.length > 0 ? data.routeHistory : null) : null);

    if (desiredRoute) {
      if (!routeRef.current) {
        routeRef.current = L.polyline(desiredRoute, {
          color: 'hsl(265, 90%, 60%)',
          weight: 3,
          opacity: 0.8,
          dashArray: '10, 5',
        }).addTo(mapRef.current as L.Map);
      } else {
        routeRef.current.setLatLngs(desiredRoute as L.LatLngExpression[]);
      }
    } else if (routeRef.current) {
      routeRef.current.remove();
      routeRef.current = null;
    }
  }, [data.latitude, data.longitude, data.routeHistory, data.speed, data.vehicleId, position, showRoute, routeCoordinates, autoZoomEnabled, fitMapToPoints, mapZoom]);

  useEffect(() => {
    if (!mapRef.current) return;

    if (!systemLocation) {
      systemMarkerRef.current?.remove();
      systemMarkerRef.current = null;
      return;
    }

    const systemPos: [number, number] = [systemLocation.lat, systemLocation.lng];
    if (!systemMarkerRef.current) {
      systemMarkerRef.current = L.circleMarker(systemPos, {
        radius: 8,
        color: 'hsl(195, 95%, 50%)',
        weight: 3,
        fillColor: 'hsl(195, 95%, 50%)',
        fillOpacity: 0.9,
      }).addTo(mapRef.current);
      systemMarkerRef.current.bindPopup('<strong>Your location</strong>');
    } else {
      systemMarkerRef.current.setLatLng(systemPos);
    }
  }, [systemLocation]);

  useEffect(() => {
    if (!autoZoomEnabled) return;
    if (focusMode === 'fit') {
      fitMapToPoints();
    }
  }, [autoZoomEnabled, fitMapToPoints, focusMode]);

  // Keep focus modes locked to max zoom while Auto Zoom is ON.
  useEffect(() => {
    if (!mapRef.current || !autoZoomEnabled || focusMode === 'fit') return;
    const map = mapRef.current;

    const enforceZoomLock = () => {
      if (!mapRef.current) return;
      if (!autoZoomEnabled) return;
      if (Math.abs(map.getZoom() - FOCUS_TARGET_ZOOM) > 0.05) {
        map.setZoom(FOCUS_TARGET_ZOOM, { animate: true });
      }
    };

    map.on('zoomend', enforceZoomLock);
    enforceZoomLock();
    return () => {
      map.off('zoomend', enforceZoomLock);
    };
  }, [autoZoomEnabled, focusMode, FOCUS_TARGET_ZOOM]);

  useEffect(() => {
    if (!mapRef.current) return;

    if (focusMode === 'fit') {
      if (autoZoomEnabled) {
        fitMapToPoints();
      }
      return;
    }

    if (focusMode === 'vehicle') {
      const [lastLat, lastLng] = lastPanPositionRef.current ?? position;
      const movedEnough = Math.abs(position[0] - lastLat) > 0.00001 || Math.abs(position[1] - lastLng) > 0.00001;
      if (movedEnough || !lastPanPositionRef.current) {
        focusTarget(position);
        lastPanPositionRef.current = position;
      }
      return;
    }

    if (focusMode === 'user' && systemLocation) {
      const userPos: [number, number] = [systemLocation.lat, systemLocation.lng];
      const [lastLat, lastLng] = lastSystemPanPositionRef.current ?? userPos;
      const movedEnough = Math.abs(userPos[0] - lastLat) > 0.00001 || Math.abs(userPos[1] - lastLng) > 0.00001;
      if (movedEnough || !lastSystemPanPositionRef.current) {
        focusTarget(userPos);
        lastSystemPanPositionRef.current = userPos;
      }
    }
  }, [focusMode, position, systemLocation, fitMapToPoints, autoZoomEnabled, focusTarget]);

  // Compute bearing (degrees) from last two points in routeHistory
  const computeBearingFromHistory = (history: [number, number][]) => {
    if (!history || history.length < 2) return null;
    const a = history[history.length - 2];
    const b = history[history.length - 1];
    const lat1 = (a[0] * Math.PI) / 180;
    const lat2 = (b[0] * Math.PI) / 180;
    const dLon = ((b[1] - a[1]) * Math.PI) / 180;
    const y = Math.sin(dLon) * Math.cos(lat2);
    const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
    const brng = (Math.atan2(y, x) * 180) / Math.PI;
    return (brng + 360) % 360; // 0-359
  };

  const hasRoute = Boolean(routeCoordinates && routeCoordinates.length > 1);
  const isLive = Boolean(data.deviceConnected);

  return (
    <div className={`relative rounded-2xl overflow-hidden border border-border/70 shadow-sm ${className}`}>
      <div ref={mapElementRef} className="w-full h-full" style={{ minHeight: '300px' }} aria-label="Vehicle location map" />

      <div className="absolute top-2 left-2 right-2 sm:top-3 sm:left-3 sm:right-auto z-[500] flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setAutoZoomEnabled((v) => !v)}
          className={`map-toolbar-btn ${autoZoomEnabled ? 'map-toolbar-btn--active' : ''}`}
        >
          Auto Zoom {autoZoomEnabled ? 'On' : 'Off'}
        </button>
        <button
          type="button"
          onClick={() => {
            setFocusMode('fit');
            lastPanPositionRef.current = null;
            lastSystemPanPositionRef.current = null;
            fitMapToPoints();
          }}
          className="map-toolbar-btn"
        >
          Fit Map
        </button>
        {autoZoomEnabled && focusMode !== 'fit' && (
          <span className="map-chip map-chip--route map-chip--active">Focus Zoom Max ({FOCUS_TARGET_ZOOM})</span>
        )}
      </div>

      <div className="absolute bottom-2 left-2 right-2 sm:bottom-3 sm:left-3 sm:right-auto z-[500]">
        <div className="map-legend-panel">
          <button
            type="button"
            onClick={() => {
              setAutoZoomEnabled(true);
              setFocusMode('vehicle');
              lastPanPositionRef.current = null;
              focusTarget(position);
            }}
            className={`map-chip map-chip--vehicle ${focusMode === 'vehicle' ? 'map-chip--active' : ''}`}
          >
            Vehicle {isLive ? 'Live' : 'Last'}
          </button>
          {systemLocation && (
            <button
              type="button"
              onClick={() => {
                setAutoZoomEnabled(true);
                setFocusMode('user');
                lastSystemPanPositionRef.current = null;
                focusTarget([systemLocation.lat, systemLocation.lng]);
              }}
              className={`map-chip map-chip--system ${focusMode === 'user' ? 'map-chip--active' : ''}`}
            >
              My GPS
            </button>
          )}
          {hasRoute && <span className="map-chip map-chip--route">Route</span>}
          <button
            type="button"
            onClick={() => {
              setFocusMode('fit');
              lastPanPositionRef.current = null;
              lastSystemPanPositionRef.current = null;
              fitMapToPoints();
            }}
            className={`map-chip map-chip--route ${focusMode === 'fit' ? 'map-chip--active' : ''}`}
          >
            Fit
          </button>
        </div>
      </div>

      {((!onlineDevices || onlineDevices.length === 0) && !data.deviceLastSeen) && (
        <div className="absolute inset-0 flex items-center justify-center bg-background/80 backdrop-blur-sm text-center px-4">
          <div className="max-w-sm rounded-xl border border-border bg-card/90 p-4 shadow-lg">
            <p className="text-sm font-semibold text-foreground">No active device</p>
            <p className="mt-1 text-xs text-muted-foreground">
              No devices are currently online and no last location is available.
            </p>
          </div>
        </div>
      )}

      {/* If device is offline but we have a last seen location, show a small badge. */}
      {(!data.deviceConnected && data.deviceLastSeen) && (
        <div className="absolute top-2 right-2 sm:top-3 sm:right-3 bg-card/95 border border-border rounded-md px-2.5 sm:px-3 py-1 text-[10px] sm:text-xs text-muted-foreground shadow-sm">
          Viewing last known location — last seen: {data.deviceLastSeen.toLocaleString()}
        </div>
      )}
    </div>
  );
};

export default VehicleMap;
