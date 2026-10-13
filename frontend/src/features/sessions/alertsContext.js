import { createContext, useContext } from "react";

export const SessionAlertsContext = createContext({ alerts: [], acknowledge: async () => {}, urgentKeys: new Set(), ownerSummaries: [], acknowledgeSummary: async () => {} });
export const useSessionAlerts = () => useContext(SessionAlertsContext);
