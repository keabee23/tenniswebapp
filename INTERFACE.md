# Interface Contract — Serve Sync v2

**Rule:** Read this before starting work. If you change an API shape, update this file FIRST, then implement.

---

## API Routes (Bacon owns, Kara consumes)

### POST /api/upload

**Request:** `multipart/form-data`
- `file` — video file (video/mp4, video/quicktime, video/webm; max 100MB)

**Response 200:**
```json
{ "clipId": "string", "blobUrl": "string", "duration": 1.23 }
```

**Response 400 / 500:**
```json
{ "error": "string" }
```

---

### POST /api/detect

**Request:** `application/json`
```json
{ "clipId": "string", "blobUrl": "string", "serveMark": 2.5 }
```
`serveMark` may be `null` — detection will use video midpoint as center.

**Response 200:**
```json
{ "jobId": "string" }
```

**Response 400 / 500:**
```json
{ "error": "string" }
```

---

### GET /api/status/[jobId]

**Response 200 (while running):**
```json
{ "status": "processing" }
```

**Response 200 (done):**
```json
{
  "status": "done",
  "contactTime": 2.483,
  "confidence": 0.87,
  "thumbnailUrl": "https://..."
}
```

**Response 200 (failed):**
```json
{ "status": "failed", "error": "string" }
```

**Response 404:**
```json
{ "error": "Job not found" }
```

---

## Shared Types

Both agents import from `@/types/index.ts`.
Any change to that file must be announced in the changelog below.

---

## Notes for Kara

*(Bacon writes here when Kara needs to adjust something)*

---

## Notes for Bacon

*(Kara writes here when she needs a new endpoint or field)*

---

## Changelog

- **[init]** Initial contract established from spec.
