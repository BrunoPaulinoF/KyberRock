import { initializeApp, type FirebaseApp } from "firebase/app";
import {
  getFirestore,
  collection,
  doc,
  setDoc,
  deleteDoc,
  query,
  where,
  getDocs,
  type Firestore,
  type DocumentData
} from "firebase/firestore";
import { getAuth, signInAnonymously, type Auth } from "firebase/auth";

import { firebaseConfig } from "../config/firebase-config.js";
import type { DesktopDatabase } from "../database/sqlite.js";
import type { LocalDesktopIdentity } from "./bootstrap.js";

let app: FirebaseApp | null = null;
let db: Firestore | null = null;
let auth: Auth | null = null;

export interface SyncResult {
  success: boolean;
  synced: number;
  failed: number;
  errors: string[];
}

export function initializeFirebase(): void {
  if (!app) {
    app = initializeApp(firebaseConfig);
    db = getFirestore(app);
    auth = getAuth(app);
  }
}

export async function authenticateDevice(): Promise<string> {
  initializeFirebase();

  if (!auth) {
    throw new Error("Firebase Auth not initialized");
  }

  const userCredential = await signInAnonymously(auth);
  return userCredential.user.uid;
}

export async function syncOperationToFirebase(
  database: DesktopDatabase,
  operationId: string,
  identity: LocalDesktopIdentity
): Promise<boolean> {
  initializeFirebase();

  if (!db) {
    throw new Error("Firestore not initialized");
  }

  const operation = database
    .prepare(
      `SELECT
        o.id, o.company_id, o.unit_id, o.device_id, o.status, o.operation_type,
        o.entry_weight_kg, o.exit_weight_kg, o.net_weight_kg,
        o.unit_price_cents, o.product_total_cents, o.freight_total_cents, o.total_cents,
        o.cancel_reason, o.created_at, o.updated_at,
        c.trade_name AS customer_name, v.plate, d.name AS driver_name,
        p.description AS product_description, pt.name AS payment_term_name
       FROM weighing_operations o
       LEFT JOIN customers c ON c.id = o.customer_id
       LEFT JOIN vehicles v ON v.id = o.vehicle_id
       LEFT JOIN drivers d ON d.id = o.driver_id
       LEFT JOIN products p ON p.id = o.product_id
       LEFT JOIN payment_terms pt ON pt.id = o.payment_term_id
       WHERE o.id = ?`
    )
    .get(operationId) as DocumentData | undefined;

  if (!operation) {
    throw new Error(`Operation ${operationId} not found`);
  }

  const operationRef = doc(db, "weighing_operations", operationId);

  await setDoc(
    operationRef,
    {
      ...operation,
      synced_at: new Date().toISOString(),
      synced_by: identity.deviceId
    },
    { merge: true }
  );

  return true;
}

export async function syncLoadingRequestToFirebase(
  database: DesktopDatabase,
  requestId: string,
  identity: LocalDesktopIdentity
): Promise<boolean> {
  initializeFirebase();

  if (!db) {
    throw new Error("Firestore not initialized");
  }

  const request = database
    .prepare("SELECT * FROM loading_requests WHERE id = ?")
    .get(requestId) as DocumentData | undefined;

  if (!request) {
    throw new Error(`Loading request ${requestId} not found`);
  }

  const requestRef = doc(db, "loading_requests", requestId);

  await setDoc(
    requestRef,
    {
      ...request,
      synced_at: new Date().toISOString(),
      synced_by: identity.deviceId
    },
    { merge: true }
  );

  return true;
}

export async function syncCustomerToFirebase(
  database: DesktopDatabase,
  customerId: string
): Promise<boolean> {
  initializeFirebase();

  if (!db) {
    throw new Error("Firestore not initialized");
  }

  const customer = database
    .prepare("SELECT * FROM customers WHERE id = ?")
    .get(customerId) as DocumentData | undefined;

  if (!customer) {
    throw new Error(`Customer ${customerId} not found`);
  }

  const customerRef = doc(db, "customers", customerId);
  await setDoc(customerRef, customer, { merge: true });

  return true;
}

export async function syncProductToFirebase(
  database: DesktopDatabase,
  productId: string
): Promise<boolean> {
  initializeFirebase();

  if (!db) {
    throw new Error("Firestore not initialized");
  }

  const product = database
    .prepare("SELECT * FROM products WHERE id = ?")
    .get(productId) as DocumentData | undefined;

  if (!product) {
    throw new Error(`Product ${productId} not found`);
  }

  const productRef = doc(db, "products", productId);
  await setDoc(productRef, product, { merge: true });

  return true;
}

export async function deleteOperationFromFirebase(operationId: string): Promise<boolean> {
  initializeFirebase();

  if (!db) {
    throw new Error("Firestore not initialized");
  }

  const operationRef = doc(db, "weighing_operations", operationId);
  await deleteDoc(operationRef);

  return true;
}

export async function getFirebaseSyncStatus(companyId: string): Promise<{
  totalOperations: number;
  lastSync: string | null;
}> {
  initializeFirebase();

  if (!db) {
    throw new Error("Firestore not initialized");
  }

  const operationsQuery = query(
    collection(db, "weighing_operations"),
    where("company_id", "==", companyId)
  );

  const snapshot = await getDocs(operationsQuery);

  let lastSync: string | null = null;
  snapshot.docs.forEach((doc) => {
    const data = doc.data();
    if (data.synced_at && (!lastSync || data.synced_at > lastSync)) {
      lastSync = data.synced_at;
    }
  });

  return {
    totalOperations: snapshot.size,
    lastSync
  };
}

export function isFirebaseInitialized(): boolean {
  return app !== null;
}

export function getFirebaseApp(): FirebaseApp {
  if (!app) {
    throw new Error("Firebase not initialized");
  }
  return app;
}

export function getFirestoreInstance(): Firestore {
  if (!db) {
    throw new Error("Firestore not initialized");
  }
  return db;
}
