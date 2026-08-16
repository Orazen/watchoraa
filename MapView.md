# MapView Component

A reusable MapLibre GL JS component for interactive maps with location tracking and breadcrumb trails, built for Watchora's Safe Journey and Caregiver features.

## Overview

The MapView component provides:
- Interactive map display using MapLibre GL JS
- Location marker with custom pulsing animation
- Breadcrumb trail visualization
- Access to OpenFreeMap vector tiles (free, MIT licensed)
- Responsive design matching Wispr Flow theme
- Screen reader accessibility

## Usage

### Basic Usage
```tsx
<MapView 
  userLat={latitude} 
  userLng={longitude} 
  trail={locationTrail}
/>
```

### Customization
```tsx
<MapView
  userLat={39.9042}
  userLng={116.4074}
  trail={trailData}
  styleUrl="https://tiles.openfreemap.org/styles/fiord"
  zoom={12}
  height="400px"
  showCompass={true}
  showScale={true}
/>
```

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `userLat` | `number | null` | `null` | Latitude for map center and marker |
| `userLng` | `number | null` | `null` | Longitude for map center and marker |
| `trail` | `Array<{ lat: number; lng: number; recordedAt: string }>` | `[]` | Location trail points for route visualization |
| `styleUrl` | `string` | `'https://tiles.openfreemap.org/styles/fiord'` | MapLibre style URL |
| `zoom` | `number` | `16` | Initial zoom level |
| `height` | `string` | `'300px'` | CSS height for map container |
| `showCompass` | `boolean` | `true` | Display zoom/rotate compass control |
| `showScale` | `boolean` | `true` | Display scale bar |

## Styling

The component uses the Wispr Flow design system:
- Lavender accent color (`--accent-lavender`) for trail and marker
- Cream canvas (`#ffffeb`) and dark chambers (`#1a1a1a`) theme
- EB Garamond display type for labels
- Figtree UI for controls
- 2px ink borders for UI elements

## Accessibility

- Map includes ARIA live region announcements for location changes
- Custom marker includes descriptive text for screen readers
- Keyboard navigation support
- High contrast styling for visibility

## Integration

### Safe Journey Tab
Used to display the user's own live position and deviation from route while on a safe journey.

### Caregiver Tab
Used to display the blind user's live position and breadcrumb trail when caregiver has consent to view location.

## Technical Details

- **License**: MIT (OpenFreeMap), Apache-2.0 (MapLibre GL JS)
- **Performance**: Dynamic imports to reduce initial bundle size
- **Error Handling**: Graceful degradation with error messages
- **Mobile**: Optimized for touch interaction on mobile devices
- **Caching**: Service worker handles offline ML asset caching

## Example Component

```tsx
export function SafeJourneyMap({ journey }: { journey: SafeJourney | null }) {
  const [location, setLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [trail, setTrail] = useState<Array<{ lat: number; lng: number; recordedAt: string }>>([]);
  
  useEffect(() => {
    if (journey?.lastLat && journey?.lastLng) {
      setLocation({ lat: journey.lastLat, lng: journey.lastLng });
    }
  }, [journey]);
  
  return (
    <MapView
      userLat={location?.lat ?? null}
      userLng={location?.lng ?? null}
      trail={trail}
      height="400px"
      styleUrl="https://tiles.openfreemap.org/styles/fiord"
      showCompass={true}
      showScale={true}
    />
  );
}
```

## Design Considerations

1. **Privacy by Default**: Map only loads when location is explicitly shared
2. **Consent-Respecting**: Gated behind caregiver consent flags
3. **Performance**: Minimizes data usage with trail capping (2-hour window)
4. **Visual Clarity**: High-contrast colors and clear visual hierarchy
5. **Accessibility**: Full screen reader and keyboard support
