import { useEffect, useRef, useState } from 'react';

export interface MapViewProps {
  userLat: number | null;
  userLng: number | null;
  trail?: Array<{ lat: number; lng: number; recordedAt: string }>;
  styleUrl?: string;
  zoom?: number;
  height?: string;
  showCompass?: boolean;
  showScale?: boolean;
  /** GPS accuracy radius in meters — renders a translucent ring around the user. */
  accuracyMeters?: number | null;
}

export function MapView({
  userLat,
  userLng,
  trail = [],
  styleUrl = 'https://tiles.openfreemap.org/styles/fiord',
  zoom = 16,
  height = '300px',
  showCompass = true,
  showScale = true,
  accuracyMeters = null,
}: MapViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const markerRef = useRef<any>(null);
  const mlRef = useRef<{ Marker: any } | null>(null);
  const [mapError, setMapError] = useState<string | null>(null);
  const [mapLoaded, setMapLoaded] = useState(false);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    import('maplibre-gl').then(({ Map, Marker, NavigationControl, ScaleControl }) => {
      mlRef.current = { Marker };
      try {
        const map = new Map({
          container: containerRef.current!,
          style: styleUrl,
          center: userLat !== null && userLng !== null ? [userLng, userLat] : [0, 0],
          zoom: userLat !== null && userLng !== null ? zoom : 2,
          pitch: 0,
          bearing: 0,
        });

        mapRef.current = map;

        if (showCompass) map.addControl(new NavigationControl({ visualizePitch: false }), 'top-right');
        if (showScale) map.addControl(new ScaleControl({ unit: 'metric' }), 'bottom-right');

        map.on('load', () => {
          if (!map.getSource('accuracy')) {
            map.addSource('accuracy', {
              type: 'geojson',
              data: { type: 'FeatureCollection', features: [] },
            });
            map.addLayer({
              id: 'accuracy-ring',
              type: 'fill',
              source: 'accuracy',
              paint: {
                'fill-color': '#6d28d9',
                'fill-opacity': 0.15,
              },
            });
            map.addLayer({
              id: 'accuracy-ring-line',
              type: 'line',
              source: 'accuracy',
              paint: {
                'line-color': '#6d28d9',
                'line-width': 1.5,
                'line-opacity': 0.4,
              },
            });
          }
          if (!map.getSource('trail')) {
            map.addSource('trail', {
              type: 'geojson',
              data: { type: 'FeatureCollection', features: [] },
            });
            map.addLayer({
              id: 'trail-line',
              type: 'line',
              source: 'trail',
              layout: { 'line-cap': 'round', 'line-join': 'round' },
              paint: {
                // MapLibre's style spec does not resolve CSS custom properties,
                // so pass the token's literal value (matches --accent-lavender).
                'line-color': '#f0d7ff',
                'line-width': 3,
                'line-opacity': 0.7,
              },
            });
          }
          setMapLoaded(true);
        });

        map.on('error', (e: any) => {
          if (e.error?.message && !e.error.message.includes('404')) {
            setMapError(e.error.message);
          }
        });

        if (userLat !== null && userLng !== null) {
          placeMarker(map, userLng, userLat);
        }

        const updateTrail = () => {
          if (!mapRef.current || !mapRef.current.getSource('trail')) return;
          const geojson = trailToGeoJSON(trail);
          (mapRef.current.getSource('trail') as any).setData(geojson);
        };
        updateTrail();
      } catch (err) {
        setMapError(err instanceof Error ? err.message : 'Failed to initialize map');
      }
    }).catch((err) => {
      setMapError(err instanceof Error ? err.message : 'Failed to load MapLibre');
    });

    return () => {
      if (markerRef.current) {
        markerRef.current.remove();
        markerRef.current = null;
      }
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!mapRef.current || userLat === null || userLng === null) return;
    const map = mapRef.current;
    if (markerRef.current) {
      markerRef.current.setLngLat([userLng, userLat]);
    } else {
      placeMarker(map, userLng, userLat);
    }
    if (!mapLoaded && map.getZoom() < 14) {
      map.easeTo({ center: [userLng, userLat], zoom: Math.max(map.getZoom(), 16) });
    }
    setMapLoaded(true);
  }, [userLat, userLng, mapLoaded]);

  useEffect(() => {
    if (!mapRef.current || !mapRef.current.getSource('trail')) return;
    const geojson = trailToGeoJSON(trail);
    (mapRef.current.getSource('trail') as any).setData(geojson);
  }, [trail]);

  // Accuracy ring: a filled circle approximating the GPS accuracy radius.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.getSource('accuracy')) return;
    if (userLat === null || userLng === null || !accuracyMeters || accuracyMeters <= 0) {
      (map.getSource('accuracy') as any).setData({ type: 'FeatureCollection', features: [] });
      return;
    }
    const points: Array<[number, number]> = [];
    for (let a = 0; a < 360; a += 10) {
      const rad = (a * Math.PI) / 180;
      // Approximate meters→degrees at this latitude (fine for a visual ring).
      const dLat = (accuracyMeters / 110_540) * Math.sin(rad);
      const dLng = (accuracyMeters / (111_320 * Math.cos((userLat * Math.PI) / 180))) * Math.cos(rad);
      points.push([userLng + dLng, userLat + dLat]);
    }
    points.push(points[0]);
    (map.getSource('accuracy') as any).setData({
      type: 'FeatureCollection',
      features: [{ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [points] } }],
    });
  }, [userLat, userLng, accuracyMeters, mapLoaded]);

  function placeMarker(map: any, lng: number, lat: number) {
    const M = mlRef.current?.Marker;
    if (!M) return;
    const el = document.createElement('div');
    el.className = 'mapview-marker';
    el.innerHTML = `
      <div class="marker-core" aria-hidden="true"></div>
      <div class="marker-pulse" aria-hidden="true"></div>
    `;
    el.style.cssText = `
      width: 28px; height: 28px;
      position: relative;
      transform: translate(-50%, -50%);
    `;

    markerRef.current = new M({ element: el, anchor: 'center' })
      .setLngLat([lng, lat])
      .addTo(map);
  }

  if (mapError) {
    return (
      <div className="panel" style={{ height, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <p className="muted-note" style={{ textAlign: 'center' }}>
          Map unavailable: {mapError}
        </p>
      </div>
    );
  }

  return (
    <div className="panel" style={{ height, overflow: 'hidden', position: 'relative' }}>
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
      <div className="sr-only" aria-live="polite" aria-atomic="true">
        {userLat !== null && userLng !== null
          ? `Live location marker at latitude ${userLat.toFixed(5)}, longitude ${userLng.toFixed(5)}`
          : 'Map loading — no live location yet'}
      </div>
    </div>
  );
}

function trailToGeoJSON(trail: Array<{ lat: number; lng: number; recordedAt: string }>) {
  if (trail.length < 2) {
    return { type: 'FeatureCollection', features: [] };
  }
  return {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        geometry: {
          type: 'LineString',
          coordinates: trail.map((p) => [p.lng, p.lat]),
        },
        properties: {},
      },
    ],
  };
}
