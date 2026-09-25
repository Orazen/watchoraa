import { useState } from 'react';
import { MapPin, MapPinCheck, MapPinPlus, Trash2 } from 'lucide-react';
import { api, ApiError, type SavedPlace } from '../api';
import { getCurrentPosition, describeRelativePosition, type Coordinates } from '../geo';
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
}: {
  places: SavedPlace[] | null;
  onCreated: (place: SavedPlace) => void;
  onDeleted: (id: string) => void;
  announce: (message: string, tone?: Tone) => void;
}) {
  const [label, setLabel] = useState('');
  const [address, setAddress] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [currentPosition, setCurrentPosition] = useState<Coordinates | null>(null);
  const [locating, setLocating] = useState(false);
  const [newPlaceCoords, setNewPlaceCoords] = useState<Coordinates | null>(null);

  async function addPlace() {
    if (!label.trim()) {
      announce('Enter a name for this place.', 'warning');
      return;
    }
    setSaving(true);
    try {
      const { place } = await api.createPlace({
        label: label.trim(),
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
      announce('Place saved.', 'online');
    } catch (error) {
      announce(error instanceof ApiError ? error.message : 'Could not save this place.', 'error');
    } finally {
      setSaving(false);
    }
  }

  async function useCurrentLocationForNewPlace() {
    setLocating(true);
    try {
      const coords = await getCurrentPosition();
      setNewPlaceCoords(coords);
      announce('Current location captured for this place.', 'online');
    } catch (error) {
      announce(error instanceof Error ? error.message : 'Could not get your location.', 'error');
    } finally {
      setLocating(false);
    }
  }

  async function locateMe() {
    setLocating(true);
    try {
      const coords = await getCurrentPosition();
      setCurrentPosition(coords);
      announce('Location updated. Distances below are relative to where you are now.', 'online');
    } catch (error) {
      announce(error instanceof Error ? error.message : 'Could not get your location.', 'error');
    } finally {
      setLocating(false);
    }
  }

  async function removePlace(id: string) {
    try {
      await api.deletePlace(id);
      onDeleted(id);
    } catch (error) {
      announce(error instanceof ApiError ? error.message : 'Could not delete this place.', 'error');
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col">
      <section>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-display text-2xl font-semibold tracking-tight text-foreground">Saved places</h2>
          <Button variant="outline" size="sm" onClick={locateMe} disabled={locating}>
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
                        <p className="mt-1 text-xs text-muted-foreground/80">No location saved for this place.</p>
                      ) : null}
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="shrink-0 self-center text-destructive hover:bg-destructive/10 hover:text-destructive active:bg-destructive/15 active:text-destructive"
                      onClick={() => removePlace(place.id)}
                      aria-label="Remove"
                    >
                      <Trash2 aria-hidden="true" className="size-4 shrink-0" />
                      Delete
                    </Button>
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
