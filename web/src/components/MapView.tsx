import { useEffect, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';

/** 国土地理院タイル。出典表記は必ず表示する */
export const GSI_LAYERS = {
  std: { label: '標準地図', url: 'https://cyberjapandata.gsi.go.jp/xyz/std/{z}/{x}/{y}.png' },
  pale: { label: '淡色地図', url: 'https://cyberjapandata.gsi.go.jp/xyz/pale/{z}/{x}/{y}.png' },
  photo: {
    label: '写真',
    url: 'https://cyberjapandata.gsi.go.jp/xyz/seamlessphoto/{z}/{x}/{y}.jpg',
  },
  slope: { label: '傾斜量図', url: 'https://cyberjapandata.gsi.go.jp/xyz/slopemap/{z}/{x}/{y}.png' },
} as const;

export type GsiLayerKey = keyof typeof GSI_LAYERS;

const GSI_ATTRIBUTION =
  '<a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank" rel="noreferrer">国土地理院</a>';

const styleFor = (key: GsiLayerKey): maplibregl.StyleSpecification => ({
  version: 8,
  sources: {
    gsi: {
      type: 'raster',
      tiles: [GSI_LAYERS[key].url],
      tileSize: 256,
      maxzoom: 18,
      attribution: GSI_ATTRIBUTION,
    },
  },
  layers: [{ id: 'gsi', type: 'raster', source: 'gsi' }],
});

export interface MapMarker {
  id: string;
  lat: number;
  lng: number;
  className: string;
  title?: string;
  popupHtml?: string;
  onClick?: () => void;
  /** 山マスタの座標補正用。ドラッグで位置を直せるようにする */
  draggable?: boolean;
  onDragEnd?: (lngLat: { lng: number; lat: number }) => void;
}

const LAYER_PREF_KEY = 'yamalog.default_map_layer';

export const getDefaultLayer = (): GsiLayerKey => {
  const stored = localStorage.getItem(LAYER_PREF_KEY);
  return stored && stored in GSI_LAYERS ? (stored as GsiLayerKey) : 'pale';
};

export const setDefaultLayer = (key: GsiLayerKey) => localStorage.setItem(LAYER_PREF_KEY, key);

interface Props {
  markers: MapMarker[];
  /** 撮影地点を時系列に結ぶ線 [lng, lat][] */
  line?: [number, number][];
  center?: [number, number];
  zoom?: number;
  fitToMarkers?: boolean;
  tall?: boolean;
  defaultLayer?: GsiLayerKey;
  onMapClick?: (lngLat: { lng: number; lat: number }) => void;
}

export function MapView({
  markers,
  line,
  center = [138.2, 37.0],
  zoom = 4.4,
  fitToMarkers = false,
  tall = false,
  defaultLayer,
  onMapClick,
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markerRefs = useRef<maplibregl.Marker[]>([]);
  const clickRef = useRef(onMapClick);
  const [layer, setLayer] = useState<GsiLayerKey>(defaultLayer ?? getDefaultLayer());

  clickRef.current = onMapClick;

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: styleFor(defaultLayer ?? getDefaultLayer()),
      center,
      zoom,
      attributionControl: { compact: false },
    });
    // ズームボタンは29px角でタップ対象として小さい。スマホではピンチ操作に任せる
    if (window.matchMedia('(min-width: 735px)').matches) {
      map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    }
    map.on('click', (e) => clickRef.current?.({ lng: e.lngLat.lng, lat: e.lngLat.lat }));
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
    };
    // マップ生成は一度だけ。以降の更新は個別の effect で行う
  }, []);

  useEffect(() => {
    mapRef.current?.setStyle(styleFor(layer));
  }, [layer]);

  // マーカーの張り替え
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    markerRefs.current.forEach((m) => m.remove());
    markerRefs.current = markers.map((m) => {
      const el = document.createElement('div');
      el.className = m.className;
      if (m.title) el.title = m.title;
      if (m.onClick) el.addEventListener('click', (ev) => {
        ev.stopPropagation();
        m.onClick?.();
      });
      const marker = new maplibregl.Marker({ element: el, draggable: m.draggable ?? false }).setLngLat([
        m.lng,
        m.lat,
      ]);
      if (m.onDragEnd) {
        marker.on('dragend', () => {
          const { lng, lat } = marker.getLngLat();
          m.onDragEnd?.({ lng, lat });
        });
      }
      if (m.popupHtml) marker.setPopup(new maplibregl.Popup({ offset: 12 }).setHTML(m.popupHtml));
      marker.addTo(map);
      return marker;
    });
  }, [markers, layer]);

  // 軌跡ライン（スタイル差し替え後も引き直す）
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const draw = () => {
      if (map.getLayer('track')) map.removeLayer('track');
      if (map.getSource('track')) map.removeSource('track');
      if (!line || line.length < 2) return;
      map.addSource('track', {
        type: 'geojson',
        data: { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: line } },
      });
      map.addLayer({
        id: 'track',
        type: 'line',
        source: 'track',
        paint: { 'line-color': '#0066cc', 'line-width': 2 },
      });
    };
    if (map.isStyleLoaded()) draw();
    map.on('styledata', draw);
    return () => {
      map.off('styledata', draw);
    };
  }, [line, layer]);

  // マーカー全体が入る範囲へ寄せる
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !fitToMarkers || markers.length === 0) return;
    const bounds = new maplibregl.LngLatBounds();
    markers.forEach((m) => bounds.extend([m.lng, m.lat]));
    map.fitBounds(bounds, { padding: 64, maxZoom: 14, duration: 0 });
  }, [markers, fitToMarkers]);

  return (
    <div>
      <div className="map-layer-switch">
        {(Object.keys(GSI_LAYERS) as GsiLayerKey[]).map((key) => (
          <button
            key={key}
            type="button"
            className={key === layer ? 'active' : ''}
            onClick={() => setLayer(key)}
          >
            {GSI_LAYERS[key].label}
          </button>
        ))}
      </div>
      <div ref={containerRef} className={tall ? 'map tall' : 'map'} />
      <p className="t-fine muted" style={{ marginTop: 'var(--space-xs)' }}>
        地図・写真タイル: 国土地理院
      </p>
    </div>
  );
}
