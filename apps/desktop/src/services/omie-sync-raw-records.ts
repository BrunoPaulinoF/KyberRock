import { randomUUID } from "node:crypto";
import type { DesktopDatabase } from "../database/sqlite.js";

export function saveOmieRawRecord(
  database: DesktopDatabase,
  companyId: string,
  entityType: string,
  omieId: string | number | undefined,
  payload: unknown
): void {
  const id = randomUUID();
  database
    .prepare(
      `INSERT INTO omie_raw_records (id, company_id, entity_type, omie_id, payload_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      companyId,
      entityType,
      omieId != null ? String(omieId) : null,
      JSON.stringify(payload),
      new Date().toISOString()
    );
}
