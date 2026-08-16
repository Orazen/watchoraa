// Voice-first dashboard (v0.4): current status at top, large primary action
// cards, a persistent voice button, and the emergency control always in reach.

import { PrimaryActionCard, StatusBanner } from '../components/PrimaryActionCard';
import { EmergencyControl, type EmergencyStatus } from '../components/EmergencyControl';
import { PermissionStatusCard } from '../permissions/PermissionStatusCard';
import { VoiceControlButton } from '../voice/VoiceControlButton';
import type { PermissionService } from '../permissions/permissionService';

export type DashboardTab = 'tracking' | 'journey' | 'sos' | 'routes' | 'community' | 'settings';

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
