The agent needs to provide the input to the MCP tool in the following format:
### 2. Resolve Identities
**Description:** Resolve person identities by matching emails, phones, or addresses. Supports single-criterion (one identifier type) or multi-criterion (multiple types in one call) queries. Returns person IDs grouped by individual with quality scores. Email addresses are automatically normalized (Gmail dots and plus-addressing removed).
**Tool Identifier:** `resolve_identities`
#### Input Parameters
| Parameter         | Type   | Required | Default | Constraints                                   | Description                                                   |
| ----------------- | ------ | -------- | ------- | --------------------------------------------- | ------------------------------------------------------------- |
| id_type           | string | No*      | -       | Must be "email", "phone", or "address"       | Type of identifier (single-criterion API)                     |
| id_hash           | string | No*      | -       | Must be "plaintext", "md5", "sha1", "sha256" | Hash type (single-criterion API)                              |
| identifiers       | array  | No*      | -       | Must be non-empty                            | Identifier values (single-criterion API)                      |
| multi_identifiers | array  | No*      | -       | Array of identifier objects                  | Multi-criterion API - query multiple types simultaneously     |
| format            | string | No       | "none"  | "none", "csv", "json", "jsonl"               | Export format - generates presigned S3 URL valid for 1 hour  |
**\*Required:** Either `(id_type, id_hash, identifiers)` OR `multi_identifiers` must be provided
**Parameter Details:**
**id_type:**
- Specifies the type of identifiers being resolved
- Must be one of: `"email"`, `"phone"`, or `"address"`
- All identifiers in the array must be of the same type
**id_hash:**
- Specifies how the identifier values are hashed
- Must be one of: `"plaintext"`, `"md5"`, `"sha1"`, or `"sha256"`
- All identifiers in the array must use the same hash type
**identifiers:**
- Array of string values to resolve (single-criterion API)
- All values must be of the type specified in `id_type`
- All values must use the hash specified in `id_hash`
**multi_identifiers:**
- Array of objects, each specifying `id_type`, `hash_type`, and `values[]`
- Allows querying across different identifier types in one call
- Cannot mix address with email/phone (addresses use geospatial matching)
- Returns Noisy-OR aggregated `overall_quality_score` per person
- Example:
  ```json
  {
    "multi_identifiers": [
      {
        "id_type": "email",
        "hash_type": "plaintext",
        "values": ["alice@example.com", "bob@example.com"]
      },
      {
        "id_type": "phone",
        "hash_type": "plaintext",
        "values": ["+15551234567"]
      }
    ]
  }
  ```
**format:**
- When set to `csv`, `json`, or `jsonl`, generates S3 presigned download URL
- URL expires in 1 hour
- Returns export metadata in response
**Request Schema:**
```typescript
interface ResolveIdentitiesParams {
  // Single-criterion API (backward compatible)
  id_type?: "email" | "phone" | "address";
  id_hash?: "plaintext" | "md5" | "sha1" | "sha256";
  identifiers?: string[];
  // Multi-criterion API
  multi_identifiers?: Array<{
    id_type: "email" | "phone" | "address";
    hash_type: "plaintext" | "md5" | "sha1" | "sha256";
    values: string[];
  }>;
  format?: "none" | "csv" | "json" | "jsonl";
}
