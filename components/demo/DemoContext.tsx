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

// Demo only: lets the ePDP tab reconfigure `CerbosProvider` at runtime, and
// collects its callbacks for the Audit tab. A real app configures the
// provider once and sends decision logs to its audit pipeline.

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
  // Set in `.env` (see `.env.example`).
  ruleId: process.env.EXPO_PUBLIC_CERBOS_HUB_RULE_ID ?? "REPLACE_WITH_YOUR_RULE_ID",
  hubBaseUrl: "https://api.cerbos.cloud",
  engineOptions: { lenientScopeSearch: true },
  logDecisions: true,
  logValidationErrors: true,
  decodeJWTs: false,
};

/**
 * DEMO ONLY: decodes a JWT without verifying its signature. A real app must
 * verify it (for example with `jose` and the issuer's JWKS).
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
