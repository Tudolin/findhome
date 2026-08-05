'use client';

import type { InteractionStatus } from '@prisma/client';

export type InteractionPatch = {
  status?: InteractionStatus;
  rating?: number | null;
  pros?: string[];
  cons?: string[];
  notes?: string | null;
};

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? `Request failed (${res.status})`);
  return data as T;
}

/** The active workspace comes from the httpOnly cookie, so no id is needed. */
export const updateInteraction = (propertyId: string, patch: InteractionPatch) =>
  request<{ interaction: unknown }>(`/api/properties/${propertyId}/interaction`, {
    method: 'PUT',
    body: JSON.stringify(patch),
  });

export const clearInteraction = (propertyId: string) =>
  request<{ ok: true }>(`/api/properties/${propertyId}/interaction`, { method: 'DELETE' });

export const postComment = (propertyId: string, body: string) =>
  request<{ comment: { id: string; body: string; createdAt: string; user: { id: string; name: string } } }>(
    `/api/properties/${propertyId}/comments`,
    { method: 'POST', body: JSON.stringify({ body }) },
  );

export const savePreferences = (payload: unknown) =>
  request<{ profile: unknown }>('/api/preferences', { method: 'PUT', body: JSON.stringify(payload) });

export const createParty = (name: string) =>
  request<{ party: { id: string; name: string; inviteCode: string } }>('/api/parties', {
    method: 'POST',
    body: JSON.stringify({ name }),
  });

export const joinParty = (inviteCode: string) =>
  request<{ party: { id: string; name: string } }>('/api/parties/join', {
    method: 'POST',
    body: JSON.stringify({ inviteCode }),
  });

/** Leaving as the last member deletes the party (server-side cascade). */
export const leaveParty = (partyId: string) =>
  request<{ ok: true }>(`/api/parties/${partyId}`, { method: 'DELETE' });

export const switchWorkspace = (workspaceId: string) =>
  request<{ activeWorkspace: string }>('/api/workspace', {
    method: 'POST',
    body: JSON.stringify({ workspaceId }),
  });
