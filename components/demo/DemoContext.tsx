import { base64Decode } from "@bufbuild/protobuf/wire";
import type { ValidationError } from "@cerbos/core";
import React, {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";

import {
  CerbosProvider,
  type DecodedJWTPayload,
  type EngineOptions,
  type JWTToDecode,
  type SerializedDecisionLogEntry,
} from "@/components/CerbosContext";

// Demo-only plumbing: lets the "ePDP" tab reconfigure the provider at runtime
// and collects the callbacks the provider emits so the "Audit" tab can show
// them. A real app would configure `CerbosProvider` once and send decision
// logs to its audit pipeline instead.

export interface DemoConfig {
  ruleId: string;
  hubBaseUrl: string;
  engineOptions: EngineOptions;
  logDecisions: boolean;
  logValidationErrors: boolean;
  decodeJWTs: boolean;
}

export interface DecisionLogItem {
  at: string;
  entry: SerializedDecisionLogEntry;
}

export interface EventLogItem {
  at: string;
  type: "validationErrors" | "updateError" | "jwtDecoded";
  payload: unknown;
}

interface DemoContextType {
  config: DemoConfig;
  applyConfig: (config: DemoConfig) => void;
  decisionLog: DecisionLogItem[];
  clearDecisionLog: () => void;
  eventLog: EventLogItem[];
  clearEventLog: () => void;
}

const MAX_LOG_ITEMS = 200;

const DemoContext = createContext<DemoContextType | undefined>(undefined);

export const defaultDemoConfig: DemoConfig = {
  // Create a rule in the "Embedded PDP rules" tab of your deployment in
  // Cerbos Hub, and set EXPO_PUBLIC_CERBOS_HUB_RULE_ID in a `.env` file (see
  // `.env.example`) or replace the fallback value.
  ruleId: process.env.EXPO_PUBLIC_CERBOS_HUB_RULE_ID ?? "REPLACE_WITH_YOUR_RULE_ID",
  hubBaseUrl: "https://api.cerbos.cloud",
  engineOptions: { lenientScopeSearch: true },
  logDecisions: true,
  logValidationErrors: true,
  decodeJWTs: false,
};

/**
 * DEMO ONLY: decodes a JWT payload without verifying its signature, so that
 * requests with `auxData.jwt` can be tried out. A real app must verify the
 * token (for example with `jose` against the issuer's JWKS) before trusting
 * its claims.
 */
export function decodeJWTPayloadUnverified(jwt: JWTToDecode): DecodedJWTPayload {
  const parts = jwt.token.split(".");
  if (parts.length < 2) {
    throw new Error("Invalid JWT");
  }
  const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  const json = new TextDecoder().decode(base64Decode(padded));
  return JSON.parse(json) as DecodedJWTPayload;
}

export function DemoProvider({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState<DemoConfig>(defaultDemoConfig);
  const [decisionLog, setDecisionLog] = useState<DecisionLogItem[]>([]);
  const [eventLog, setEventLog] = useState<EventLogItem[]>([]);

  const addEvent = useCallback(
    (type: EventLogItem["type"], payload: unknown) => {
      setEventLog((current) =>
        [{ at: new Date().toISOString(), type, payload }, ...current].slice(
          0,
          MAX_LOG_ITEMS
        )
      );
    },
    []
  );

  const onDecision = useCallback((entry: SerializedDecisionLogEntry) => {
    setDecisionLog((current) =>
      [{ at: new Date().toISOString(), entry }, ...current].slice(
        0,
        MAX_LOG_ITEMS
      )
    );
  }, []);

  const onValidationError = useCallback(
    (validationErrors: ValidationError[]) => {
      addEvent("validationErrors", validationErrors);
    },
    [addEvent]
  );

  const onUpdateError = useCallback(
    (message: string) => {
      addEvent("updateError", message);
    },
    [addEvent]
  );

  const decodeJWTPayload = useCallback(
    (jwt: JWTToDecode) => {
      const payload = decodeJWTPayloadUnverified(jwt);
      addEvent("jwtDecoded", { keySetId: jwt.keySetId, payload });
      return payload;
    },
    [addEvent]
  );

  const applyConfig = useCallback((next: DemoConfig) => {
    setConfig(next);
  }, []);

  const value = useMemo<DemoContextType>(
    () => ({
      config,
      applyConfig,
      decisionLog,
      clearDecisionLog: () => setDecisionLog([]),
      eventLog,
      clearEventLog: () => setEventLog([]),
    }),
    [config, applyConfig, decisionLog, eventLog]
  );

  return (
    <DemoContext.Provider value={value}>
      <CerbosProvider
        ruleId={config.ruleId}
        hub={{ baseUrl: config.hubBaseUrl }}
        engineOptions={config.engineOptions}
        refreshIntervalSeconds={300}
        onDecision={config.logDecisions ? onDecision : undefined}
        onValidationError={
          config.logValidationErrors ? onValidationError : undefined
        }
        onUpdateError={onUpdateError}
        decodeJWTPayload={config.decodeJWTs ? decodeJWTPayload : undefined}
      >
        {children}
      </CerbosProvider>
    </DemoContext.Provider>
  );
}

export function useDemo(): DemoContextType {
  const context = useContext(DemoContext);
  if (context === undefined) {
    throw new Error("useDemo must be used within a DemoProvider");
  }
  return context;
}
