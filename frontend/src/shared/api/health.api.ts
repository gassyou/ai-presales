/**
 * Health API
 */

import { http } from "./http-client.ts";
import { Endpoints } from "./endpoints.ts";

export interface HealthInfo {
  status: "ok" | "fail";
  name: string;
  version: string;
  timestamp: string;
  checks: {
    db: "ok" | "fail" | "skipped";
    llm: "ok" | "fail";
    providers: readonly string[];
  };
}

export const fetchHealth = (): Promise<HealthInfo> => http.get<HealthInfo>(Endpoints.health);