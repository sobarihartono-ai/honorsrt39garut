# Security Specification — Sistem Administrasi Honor & Transpor SRT 39 Garut

## 1. Data Invariants
1. Every document under `/users/{userId}/...` belongs strictly to `{userId}` and requires `request.auth != null && request.auth.uid == userId && request.auth.token.email_verified == true`.
2. Every subcollection document (`transactions`, `employees`, `settings`) requires the parent `/users/{userId}` document to exist and have matching `ownerId == request.auth.uid`.
3. All document IDs (`userId`, `txId`, `empId`, `settingId`) must satisfy `^[a-zA-Z0-9_\-]+$` and length `<= 128`.
4. All strings have explicit `.size()` upper bounds, all numbers have explicit bounds, and `createdAt` / `ownerId` / `uid` are immutable after creation.
5. `createdAt` on create and `updatedAt` on create/update must equal `request.time`.

## 2. Dirty Dozen Attack Payloads (All Must Fail with PERMISSION_DENIED)
1. Unauthenticated read or write on `/users/{userId}/transactions/{txId}`.
2. Unverified email user (`email_verified: false`) attempting create/update/delete.
3. Cross-tenant read/list/write: User B (`uidB`) trying to read or list `/users/{uidA}/transactions`.
4. Identity spoofing on create: User A creating a transaction with `ownerId: "uidB"`.
5. Shadow/ghost field injection: Adding `{ isAdmin: true }` or `{ extraField: "hack" }` on create or update.
6. ID poisoning: Creating a transaction with a 300-character ID or invalid characters (`../admin`).
7. String exhaustion: Setting `nama` or `customRangka` to a 10,000-character string.
8. Invalid numeric range: Setting `tarif: -50000` or `jamlat: 0` or `pajakRate: 5`.
9. Invalid category enum: Setting `category: "arbitrary"` outside `["ekskul", "gurutamu", "lainnya"]`.
10. Client-forged timestamp: Setting `updatedAt` to a past timestamp instead of `request.time`.
11. Mutating immutable fields: Attempting to change `ownerId` or `createdAt` on update.
12. Orphan subcollection write: Creating `/users/{uidA}/transactions/tx-1` when `/users/{uidA}` does not exist.
