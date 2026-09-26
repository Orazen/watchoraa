import { useState } from 'react';
import { MapPin, MapPinCheck, MapPinPlus, Trash2 } from 'lucide-react';
import { api, ApiError, type SavedPlace } from '../api';
import {
  describePlaceAsSpoken,
  distanceMeters,
  getCurrentPosition,
  describeRelativePosition,
  type Coordinates,
} from '../geo';
import type { SpeechPriority } from '../speechPriority';
import type { Tone } from './shared';
import {
  Alert,
  AlertDescription,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Field,
  Input,
  Textarea,
} from '../components/ui';

export function PlacesTab({
  places,
  onCreated,
  onDeleted,
  announce,
  speak,
}: {
  places: SavedPlace[] | null;
  onCreated: (place: SavedPlace) => void;
  onDeleted: (id: string) => void;
  announce: (message: string, tone?: Tone) => void;
  /** Optional so no call site breaks until App.tsx wires the real function. */
  speak?: (text: string, priority?: SpeechPriority, dedupeKey?: string) => void;
}) {
  const [label, setLabel] = useState('');
  const [address, setAddress] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [currentPosition, setCurrentPosition] = useState<Coordinates | null>(null);
  const [locating, setLocating] = useState(false);
  const [newPlaceCoords, setNewPlaceCoords] = useState<Coordinates | null>(null);
  // Deleting a saved place is immediate and irreversible (no soft delete, no
  // undo anywhere in the app), so the first press arms a spoken confirm.
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  async function addPlace() {
    const placeLabel = label.trim();
    if (!placeLabel) {
      announce('Enter a name for this place.', 'warning');
      speak?.('Enter a name for this place.', 5, 'place-name-required');
      return;
    }
    setSaving(true);
    try {
      const { place } = await api.createPlace({
        label: placeLabel,
        address: address.trim() || undefined,
        notes: notes.trim() || undefined,
        latitude: newPlaceCoords?.latitude,
        longitude: newPlaceCoords?.longitude,
      });
      onCreated(place);
      setLabel('');
      setAddress('');
      setNotes('');
      setNewPlaceCoords(null);
      // Name the place back: a blind user needs to know what was saved, not
      // just that "something" was.
      speak?.(`${placeLabel} saved.`, 5, 'place-saved');
      announce('Place saved.', 'online');
    } catch (error) {
      announce(error instanceof ApiError ? error.message : 'Could not save this place.', 'error');
      speak?.(`Could not save ${placeLabel}.`, 5, 'place-save-failed');
    } finally {
      setSaving(false);
    }
  }

  async function useCurrentLocationForNewPlace() {
    setLocating(true);
    try {
      const coords = await getCurrentPosition();
      setNewPlaceCoords(coords);
      speak?.('Current location captured for this place.', 5, 'place-loc-captured');
      announce('Current location captured for this place.', 'online');
    } catch (error) {
      announce(error instanceof Error ? error.message : 'Could not get your location.', 'error');
      speak?.('Could not get your location.', 5, 'place-loc-failed');
    } finally {
      setLocating(false);
    }
  }

  /**
   * The relative-distance badges on the place cards are visual text; a blind
   * user never reads them, so after a location fix the nearest saved place is
   * spoken by name, distance, and clock direction ("Home, 340 m away, at
   * about 9 o'clock."). That summary is the entire point of the "Use my
   * location" button on this screen.
   */
  function nearestSpokenPlace(from: Coordinates): string | null {
    if (!places?.length) return null;
    let best: { name: string; to: Coordinates; meters: number } | null = null;
    for (const place of places) {
      if (place.latitude == null || place.longitude == null) continue;
      const to = { latitude: place.latitude, longitude: place.longitude };
      const meters = distanceMeters(from, to);
      if (!best || meters < best.meters) best = { name: place.label, to, meters };
    }
    return best ? describePlaceAsSpoken(from, best.to, best.name) : null;
  }

  async function locateMe() {
    setLocating(true);
    try {
      const coords = await getCurrentPosition();
      setCurrentPosition(coords);
      speak?.('Location updated.', 5, 'place-locate-me');
      announce('Location updated. Distances below are relative to where you are now.', 'online');
      const nearest = nearestSpokenPlace(coords);
      if (nearest) speak?.(nearest, 4, 'places-nearest');
    } catch (error) {
      announce(error instanceof Error ? error.message : 'Could not get your location.', 'error');
      speak?.('Could not get your location.', 5, 'locate-me-failed');
    } finally {
      setLocating(false);
    }
  }

  /** First press arms the confirm; second press deletes. Nothing fires silently. */
  function requestRemovePlace(place: SavedPlace) {
    if (confirmDeleteId !== place.id) {
      setConfirmDeleteId(place.id);
      speak?.(`Remove ${place.label}? Press Confirm remove to delete it.`, 3, `confirm-delete-${place.id}`);
      return;
    }
    setConfirmDeleteId(null);
    void removePlace(place);
  }

  function keepPlace(place: SavedPlace) {
    setConfirmDeleteId(null);
    speak?.(`${place.label} kept.`, 5, `keep-place-${place.id}`);
  }

  async function removePlace(place: SavedPlace) {
    setDeletingId(place.id);
    try {
      await api.deletePlace(place.id);
      onDeleted(place.id);
      announce(`Removed ${place.label} from your saved places.`, 'online');
      speak?.(`Removed ${place.label} from your saved places.`, 3, `removed-place-${place.id}`);
    } catch (error) {
      announce(error instanceof ApiError ? error.message : 'Could not delete this place.', 'error');
      speak?.(`Could not remove ${place.label}.`, 3, 'remove-place-failed');
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col">
      <section>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-display text-2xl font-semibold tracking-tight text-foreground">Saved places</h2>
          <Button variant="outline" size="md" onClick={locateMe} disabled={locating}>
            {locating
              ? 'Locating…'
              : currentPosition
                ? <>
                    <MapPin aria-hidden="true" className="size-4 shrink-0" />
                    Update my location
                  </>
                : <>
                    <MapPin aria-hidden="true" className="size-4 shrink-0" />
                    Use my location
                  </>}
          </Button>
        </div>
        <div className="mt-4 flex flex-col gap-3">
          {places === null ? (
            <Alert politeness="polite" role="status" aria-live="polite">
              <AlertDescription>Loading…</AlertDescription>
            </Alert>
          ) : places.length === 0 ? (
            <Alert politeness="polite" role="status" aria-live="polite">
              <AlertDescription>No saved places yet. Add one below.</AlertDescription>
            </Alert>
          ) : (
            places.map((place) => {
              const hasCoords = place.latitude != null && place.longitude != null;
              const relative =
                currentPosition && hasCoords
                  ? describeRelativePosition(currentPosition, { latitude: place.latitude!, longitude: place.longitude! })
                  : null;
              return (
                <Card key={place.id} className="p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <CardTitle className="text-lg">{place.label}</CardTitle>
                      <CardDescription className="mt-1">
                        {place.address || place.notes || 'No details added'}
                      </CardDescription>
                      {relative ? (
                        <Badge tone="info" className="mt-2 max-w-full">
                          {relative}
                        </Badge>
                      ) : null}
                      {!hasCoords ? (
                        <p className="mt-1 text-sm text-muted-foreground">No location saved for this place.</p>
                      ) : null}
                    </div>
                    {confirmDeleteId === place.id ? (
                      <div className="flex shrink-0 flex-col items-stretch gap-2 self-center">
                        <Button
                          variant="destructive"
                          size="md"
                          disabled={deletingId === place.id}
                          className="text-destructive-foreground hover:text-destructive-foreground"
                          onClick={() => requestRemovePlace(place)}
                          aria-label={`Confirm remove ${place.label}`}
                        >
                          <Trash2 aria-hidden="true" className="size-4 shrink-0" />
                          Confirm remove
                        </Button>
                        <Button
                          variant="outline"
                          size="md"
                          onClick={() => keepPlace(place)}
                          aria-label={`Keep ${place.label}`}
                        >
                          Keep
                        </Button>
                      </div>
                    ) : (
                      <Button
                        variant="ghost"
                        size="md"
                        className="shrink-0 self-center text-destructive hover:bg-destructive/10 hover:text-destructive active:bg-destructive/15 active:text-destructive"
                        onClick={() => requestRemovePlace(place)}
                        aria-label={`Remove ${place.label}`}
                      >
                        <Trash2 aria-hidden="true" className="size-4 shrink-0" />
                        Remove
                      </Button>
                    )}
                  </div>
                </Card>
              );
            })
          )}
        </div>
      </section>

      <section className="mt-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2.5">
              <MapPinPlus aria-hidden="true" className="size-5 shrink-0 text-primary" />
              Add a place
            </CardTitle>
            <CardDescription>Pin a spot so you can find your way back to it later.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <Field label="Name" htmlFor="places-name">
              <Input
                id="places-name"
                aria-label="Name"
                value={label}
                onChange={(event) => setLabel(event.target.value)}
                placeholder="e.g. Pharmacy"
              />
            </Field>
            <Field label="Address (optional)" htmlFor="places-address">
              <Input
                id="places-address"
                aria-label="Address (optional)"
                value={address}
                onChange={(event) => setAddress(event.target.value)}
                placeholder="Street address"
              />
            </Field>
            <Field label="Notes (optional)" htmlFor="places-notes">
              <Textarea
                id="places-notes"
                aria-label="Notes (optional)"
                rows={3}
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                placeholder="Anything worth remembering"
              />
            </Field>
            <Button variant="secondary" onClick={useCurrentLocationForNewPlace} disabled={locating}>
              {newPlaceCoords
                ? <>
                    <MapPinCheck aria-hidden="true" className="size-5 shrink-0" />
                    Location captured
                  </>
                : locating
                  ? 'Locating…'
                  : <>
                      <MapPin aria-hidden="true" className="size-5 shrink-0" />
                      Save my current location with this place
                    </>}
            </Button>
            <Button size="lg" onClick={addPlace} disabled={saving}>
              {saving
                ? 'Saving…'
                : <>
                    <MapPinPlus aria-hidden="true" className="size-5 shrink-0" />
                    Save place
                  </>}
            </Button>
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
