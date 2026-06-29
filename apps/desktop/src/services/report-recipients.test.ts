import { describe, expect, it } from "vitest";

import { runDesktopMigrations } from "../database/migrate";
import { openDesktopDatabase } from "../database/sqlite";
import {
  createReportRecipient,
  listReportRecipients,
  updateReportRecipient
} from "./report-recipients";

function createDatabase() {
  const db = openDesktopDatabase({ databasePath: ":memory:", fileMustExist: false });
  runDesktopMigrations(db);
  db.prepare(
    `
    INSERT INTO companies (id, legal_name, trade_name, created_at, updated_at)
    VALUES ('comp-1', 'Empresa', 'Empresa', datetime('now'), datetime('now'))
  `
  ).run();
  return db;
}

describe("report recipients", () => {
  it("creates a WhatsApp recipient without e-mail", () => {
    const db = createDatabase();

    try {
      const recipient = createReportRecipient(db, {
        companyId: "comp-1",
        whatsappPhone: "(11) 99999-9999",
        sendEmail: false,
        sendWhatsapp: true
      });

      expect(recipient.email).toBeNull();
      expect(recipient.whatsappPhone).toBe("5511999999999");
      expect(recipient.sendEmail).toBe(false);
      expect(recipient.sendWhatsapp).toBe(true);
      expect(listReportRecipients(db, "comp-1")).toHaveLength(1);
    } finally {
      db.close();
    }
  });

  it("updates a recipient to send through both channels", () => {
    const db = createDatabase();

    try {
      const recipient = createReportRecipient(db, {
        companyId: "comp-1",
        email: "dono@example.com"
      });

      const updated = updateReportRecipient(db, recipient.id, {
        whatsappPhone: "5511988887777",
        sendWhatsapp: true
      });

      expect(updated.email).toBe("dono@example.com");
      expect(updated.whatsappPhone).toBe("5511988887777");
      expect(updated.sendEmail).toBe(true);
      expect(updated.sendWhatsapp).toBe(true);
    } finally {
      db.close();
    }
  });

  it("requires a valid contact for the selected channel", () => {
    const db = createDatabase();

    try {
      expect(() =>
        createReportRecipient(db, {
          companyId: "comp-1",
          sendEmail: false,
          sendWhatsapp: true,
          whatsappPhone: "123"
        })
      ).toThrow("WhatsApp invalido");

      expect(() =>
        createReportRecipient(db, {
          companyId: "comp-1",
          sendEmail: false,
          sendWhatsapp: false
        })
      ).toThrow("Selecione pelo menos um canal");
    } finally {
      db.close();
    }
  });
});
