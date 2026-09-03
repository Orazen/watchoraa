// Voice-first dashboard (v0.4): current status at top, large primary action
// cards, a persistent voice button, and the emergency control always in reach.

import { useEffect, useState } from 'react';
import { PrimaryActionCard, StatusBanner } from '../components/PrimaryActionCard';
import { EmergencyControl, type EmergencyStatus } from '../components/EmergencyControl';
import { PermissionStatusCard } from '../permissions/PermissionStatusCard';
import { VoiceControlButton } from '../voice/VoiceControlButton';
import { MapView } from '../MapView';
import type { PermissionService } from '../permissions/permissionService';

export type DashboardTab = 'tracking' | 'journey' | 'sos' | 'routes' | 'community' | 'settings';

/** Live Location card: continuous GPS watch with map, accuracy ring, and a
 *  screen-reader-friendly accuracy summary. Runs only while Home is open. */
function LiveLocationCard({ onOpenJourney }: { onOpenJourney: () => void }) {
  const [pos, setPos] = useState<{ lat: number; lng: number; accuracy: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!('geolocation' in navigator)) {
      setError('This device does not support location services.');
      return;
    }
    const watchId = navigator.geolocation.watchPosition(
      (p) => {
        setError(null);
        setPos({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: Math.round(p.coords.accuracy) });
      },
      (err) => setError(err.message || 'Location unavailable.'),
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 15_000 },
    );
    return () => navigator.geolocation.clearWatch(watchId);
  }, []);

  const quality =
    pos == null
      ? null
      : pos.accuracy <= 10
        ? { label: 'Excellent', tone: 'ok' }
        : pos.accuracy <= 25
          ? { label: 'Good', tone: 'ok' }
          : pos.accuracy <= 60
            ? { label: 'Fair', tone: 'warn' }
            : { label: 'Poor', tone: 'warn' };

  return (
    <div className="status-card live-location-card" role="region" aria-label="Live location">
      <div className="status-card-head">
        <span className="status-icon" aria-hidden="true">📍</span>
        <div>
          <h3>Live location</h3>
          <p className="status-line" aria-live="polite">
            {error
              ? `Location unavailable: ${error}`
              : pos
                ? `Latitude ${pos.lat.toFixed(5)}, longitude ${pos.lng.toFixed(5)}. Accuracy ${pos.accuracy} metres — ${quality?.label ?? 'unknown'}.`
                : 'Finding your position…'}
          </p>
        </div>
      </div>
      {pos && (
        <MapView userLat={pos.lat} userLng={pos.lng} accuracyMeters={pos.accuracy} height="240px" zoom={17} showCompass={false} />
      )}
      <button className="ghost-btn" style={{ marginTop: 10 }} onClick={onOpenJourney}>
        Start a monitored Safe Journey with this location
      </button>
    </div>
  );
}

export function VoiceFirstDashboard({
  permissionService,
  emergency,
  activeJourney,
  offline,
  onOpenTab,
  onOpenPermissions,
  onEmergency,
  onCancelEmergency,
  onResolveEmergency,
  speak,
}: {
  permissionService: PermissionService;
  emergency: EmergencyStatus;
  activeJourney: { destination: string; status: string } | null;
  offline: boolean;
  onOpenTab: (tab: DashboardTab) => void;
  onOpenPermissions: () => void;
  onEmergency: (payload: { lat?: number; lng?: number; battery?: number }) => void;
  onCancelEmergency: () => void;
  onResolveEmergency: () => void;
  speak: (text: string, priority?: number, dedupeKey?: string) => void;
}) {
  return (
    <div className="voice-dashboard">
      <header className="dashboard-head">
        <div>
          <p className="topbar-kicker">watchora · command centre</p>
          <h2 id="dashboard-title" tabIndex={-1}>
            Home
          </h2>
        </div>
        <div className="control-inline">
          <VoiceControlButton />
        </div>
      </header>

      {offline && (
        <StatusBanner tone="warn">
          You are offline. Local hazard detection, saved information, and OCR remain available. Cloud scene descriptions and remote emergency delivery may be unavailable.
        </StatusBanner>
      )}

      {emergency.state === 'active' && (
        <EmergencyControl status={emergency} onTrigger={onEmergency} onCancel={onCancelEmergency} onResolve={onResolveEmergency} speak={speak} />
      )}

      <section className="status-grid">
        <div className="status-card" role="region" aria-label="Watchora status">
          <div className="status-card-head">
            <span className="status-icon" aria-hidden="true">
              {emergency.state === 'active' ? '🚨' : activeJourney ? '🛡️' : '🟢'}
            </span>
            <div>
              <h3>Status</h3>
              <p className="status-line" aria-live="polite">
                {emergency.state === 'active'
                  ? 'Emergency active.'
                  : activeJourney
                    ? `Safe journey to ${activeJourney.destination} (${activeJourney.status}).`
                    : 'Ready.'}
              </p>
            </div>          </div>
        </div>
        <PermissionStatusCard service={permissionService} onOpen={onOpenPermissions} />
      </section>

      <LiveLocationCard onOpenJourney={() => onOpenTab('journey')} />

      <section className="primary-cards">
        <PrimaryActionCard
          icon="📍"
          title="Assist"
          explanation="Use the camera to understand your surroundings."
          buttonLabel="Start Assist"
          onActivate={() => onOpenTab('tracking')}
          voiceHint="Describe what is ahead"
        />
        <PrimaryActionCard
          icon="🛡️"
          title="Safe Journey"
          explanation="Watchora monitors your trip and asks if you need help."
          buttonLabel={activeJourney ? 'Open active journey' : 'Start Safe Journey'}
          onActivate={() => onOpenTab('journey')}
          voiceHint="Start a safe journey"
          state={activeJourney ? `Active: ${activeJourney.destination}` : 'No active journey'}
          stateTone={activeJourney ? 'ok' : 'neutral'}
        />
        <PrimaryActionCard
          icon="📖"
          title="Read"
          explanation="Point at text and hear it read aloud."
          buttonLabel="Read text"
          onActivate={() => onOpenTab('tracking')}
          voiceHint="Read this"
        />
        <PrimaryActionCard
          icon="🚨"
          title="Emergency"
          explanation="Share your location with trusted contacts."
          buttonLabel="Open emergency"
          onActivate={() => onOpenTab('sos')}
          voiceHint="Emergency"
        />
      </section>

      <section className="secondary-cards">
        <button className="secondary-card" onClick={() => onOpenTab('routes')}>
          🗺️ <strong>Places</strong>
        </button>
        <button className="secondary-card" onClick={() => onOpenTab('sos')}>
          👥 <strong>Contacts</strong>
        </button>
        <button className="secondary-card" onClick={() => onOpenTab('community')}>
          🛡️ <strong>Community</strong>
        </button>
        <button className="secondary-card" onClick={() => onOpenTab('settings')}>
          ⚙️ <strong>Settings</strong>
        </button>
      </section>

      {emergency.state !== 'active' && (
        <section className="emergency-section">
          <EmergencyControl status={emergency} onTrigger={onEmergency} onCancel={onCancelEmergency} onResolve={onResolveEmergency} speak={speak} />
        </section>
      )}
    </div>
  );
}
