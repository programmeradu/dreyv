"use client";

/**
 * Client hook for the Dreyv Connector Gateway.
 *
 * Wraps:
 *   GET    /api/dreyv-gateway/connections?providers=1   → catalog
 *   GET    /api/dreyv-gateway/connections               → user's connections
 *   POST   /api/dreyv-gateway/connections               → create / upsert
 *   DELETE /api/dreyv-gateway/connections?id=...        → delete
 *
 * Used by the Key Wizard modal and the /app/studio/connections page.
 */

import { useCallback, useEffect, useState } from "react";

export interface ProviderField {
  name: string;
  label: string;
  type: "text" | "password" | "email";
  placeholder?: string;
  helpText?: string;
  required?: boolean;
}

export interface PublicProvider {
  id: string;
  name: string;
  category: string;
  authType: "api_key" | "oauth";
  description: string;
  docsUrl: string;
  secretFields: ProviderField[];
  publicFields: ProviderField[];
  operations: string[];
}

export interface DreyvConnection {
  id: string;
  provider: string;
  label: string | null;
  status: string;
  publicConfig: Record<string, unknown> | null;
  lastUsedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface State {
  providers: PublicProvider[];
  connections: DreyvConnection[];
  loading: boolean;
  error: string | null;
}

export function useDreyvConnections() {
  const [state, setState] = useState<State>({
    providers: [],
    connections: [],
    loading: true,
    error: null,
  });

  const refresh = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const [pRes, cRes] = await Promise.all([
        fetch("/api/dreyv-gateway/connections?providers=1"),
        fetch("/api/dreyv-gateway/connections"),
      ]);
      const pJson = await pRes.json();
      const cJson = cRes.ok ? await cRes.json() : { connections: [] };
      setState({
        providers: pJson.providers ?? [],
        connections: cJson.connections ?? [],
        loading: false,
        error: null,
      });
    } catch (e) {
      setState((s) => ({
        ...s,
        loading: false,
        error: e instanceof Error ? e.message : "Failed to load connections",
      }));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const save = useCallback(
    async (input: {
      provider: string;
      label?: string;
      secrets: Record<string, string>;
      publicConfig?: Record<string, unknown>;
    }) => {
      const res = await fetch("/api/dreyv-gateway/connections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.message || json?.error || "Save failed");
      await refresh();
      return json;
    },
    [refresh]
  );

  const remove = useCallback(
    async (id: string) => {
      const res = await fetch(`/api/dreyv-gateway/connections?id=${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.error || "Delete failed");
      }
      await refresh();
    },
    [refresh]
  );

  return { ...state, refresh, save, remove };
}

export function getProviderById(
  providers: PublicProvider[],
  id: string
): PublicProvider | null {
  return providers.find((p) => p.id === id) ?? null;
}

export function isConnected(
  connections: DreyvConnection[],
  providerId: string
): DreyvConnection | null {
  return connections.find((c) => c.provider === providerId) ?? null;
}
