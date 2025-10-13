# MCP Tools Specification

## Overview

The Watt MCP Server provides a Model Context Protocol (MCP) interface for accessing customer data and semantic cluster analytics. The server enables identity resolution, person profile retrieval, demographic search, and cluster analysis through a standardized set of tools.

**Server Information:**

- **Name:** Watt MCP
- **Version:** 0.1.0
- **Protocol:** Model Context Protocol (MCP)
- **Transport:** StreamableHTTPServerTransport
- **Data Source:** ClickHouse database (ingress schema)

**Authentication:**

The server supports two authentication methods:

1. **API Keys (Machine-to-Machine)**
   - **Method:** Basic Authentication
   - **Header Format:** `Authorization: Basic <base64(tokenId:tokenSecret)>`
   - **Setup:**
     1. Create a Machine for a customer in the Clerk web UI (e.g., "Exact Match")
     2. Within the Machine, create a new token
     3. Record both the Token ID (username) and Token Secret (password)
     4. Encode credentials: `base64(tokenId:tokenSecret)`
     5. Set header: `Authorization: Basic <encoded_credentials>`

2. **OAuth (Default)**
   - **Method:** Bearer Token
   - **Header:** `Authorization: Bearer <token>`
   - **Note:** System falls back to OAuth if Basic auth is not provided or verification fails

**Authentication Flow:**
- If `Authorization` header contains `Basic` scheme → attempts M2M token verification
- If M2M verification fails or no Basic auth provided → falls back to OAuth
- All tools require valid authentication to be present in the user session

---

## Tools

### 1. Resolve Identities

**Description:** Convert emails, phones, and other identifiers into detailed person profiles

**Tool Identifier:** `resolve_identities`

#### Input Parameters

| Parameter   | Type   | Required | Default | Constraints                                   | Description                                         |
| ----------- | ------ | -------- | ------- | --------------------------------------------- | --------------------------------------------------- |
| id_type     | string | Yes      | -       | Must be "email", "phone", or "address"       | Type of identifier being resolved                  |
| id_hash     | string | Yes      | -       | Must be "plaintext", "md5", "sha1", "sha256" | Hash type of the identifiers                       |
| identifiers | array  | Yes      | -       | Must be non-empty                            | Array of identifier values (all of the same type)  |

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
- Array of string values to resolve
- All values must be of the type specified in `id_type`
- All values must use the hash specified in `id_hash`
- Examples:
  ```json
  {
    "id_type": "email",
    "id_hash": "plaintext",
    "identifiers": ["user@example.com", "alice@example.com"]
  }
  ```
  ```json
  {
    "id_type": "phone",
    "id_hash": "md5",
    "identifiers": ["5d41402abc4b2a76b9719d911017c592", "098f6bcd4621d373cade4e832627b4f6"]
  }
  ```

**Request Schema:**

```typescript
interface ResolveIdentitiesParams {
  id_type: "email" | "phone" | "address";
  id_hash: "plaintext" | "md5" | "sha1" | "sha256";
  identifiers: string[];
}
```

#### Output Format

**Success Response:**

```typescript
{
  identities: Array<ResolvedIdentity>,
  stats: {
    requested: number,
    resolved: number,
    rate: number
  }
}
```

**Response Fields:**

| Field                  | Type   | Description                                                    |
| --------------------- | ------ | -------------------------------------------------------------- |
| identities            | array  | Array of resolved identity records                            |
| identities[].person_id | number/null | Person ID if resolved, null if not found              |
| identities[].id_type  | string | Type of identifier (email, phone, address)                    |
| identities[].id_hash  | string | Hash type used (plaintext, md5, sha1, sha256)                |
| identities[].id_value | string | The identifier value                                          |
| identities[].quality_score | number/null | Quality score of the identity (0-1)                 |
| identities[].last_modified | string/null | Last modification timestamp                         |
| stats.requested       | number | Number of identifiers provided in the request                 |
| stats.resolved        | number | Number of identifiers successfully resolved                   |
| stats.rate           | number | Resolution rate (resolved/requested, 0-1 decimal)             |

**Example Response:**

```json
{
  "identities": [
    {
      "person_id": 123456,
      "id_type": "email",
      "id_hash": "plaintext",
      "id_value": "john.doe@example.com",
      "quality_score": 0.95,
      "last_modified": "2024-01-15T10:30:00Z"
    }
  ],
  "stats": {
    "requested": 2,
    "resolved": 1,
    "rate": 0.5
  }
}
```

#### Error Handling

**Error Response Format:**

```json
{
  "content": [
    {
      "type": "text",
      "text": "Identity resolution failed: <error message>"
    }
  ],
  "isError": true
}
```

**Common Errors:**

- Empty identifiers array
- Invalid identifier format
- Database connection failure
- Query execution timeout

#### Implementation Details

**Data Source:**

- ClickHouse database
- Table: `egress.identity_person_deterministic` (for identifier resolution)

**Query Pattern:**

1. Single query to `egress.identity_person_deterministic` table
2. Filters by `id_type`, `id_hash`, and `id_value IN` array of identifiers
3. Returns identity records directly with quality scores
4. Results ordered by `quality_score DESC` to return highest quality matches first

**Performance Notes:**

- Single query execution (simplified from previous two-query approach)
- Uses IN operator for efficient batch lookups
- Returns quality scores for each resolved identity
- No hard limit on number of identifiers, but large batches may timeout
- Parameterized queries prevent SQL injection

#### Usage Examples

**Example 1: Simple email resolution**

```json
{
  "id_type": "email",
  "id_hash": "plaintext",
  "identifiers": ["alice@example.com", "bob@example.com"]
}
```

**Example 2: Phone number resolution**

```json
{
  "id_type": "phone",
  "id_hash": "plaintext",
  "identifiers": ["+15551234567", "+442071234567"]
}
```

**Example 3: Using MD5 hashed emails**

```json
{
  "id_type": "email",
  "id_hash": "md5",
  "identifiers": [
    "5d41402abc4b2a76b9719d911017c592",
    "098f6bcd4621d373cade4e832627b4f6"
  ]
}
```

**Example 4: Using SHA256 hashed phone numbers**

```json
{
  "id_type": "phone",
  "id_hash": "sha256",
  "identifiers": [
    "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    "a665a45920422f9d417e4867efdc4fb8a04a1f3fff1fa07e998e86f7f7a27ae3"
  ]
}
```

**Example 5: Address resolution**

```json
{
  "id_type": "address",
  "id_hash": "plaintext",
  "identifiers": ["123 Main St, San Francisco, CA 94105"]
}
```

---

### 2. Get Person

**Description:** Retrieve detailed person profiles by person IDs

**Tool Identifier:** `get_person`

#### Input Parameters

| Parameter  | Type  | Required | Default | Constraints                                                                                                                                                                                                                                                          | Description                       |
| ---------- | ----- | -------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| person_ids | array | Yes      | -       | Max 1000 IDs                                                                                                                                                                                                                                                         | Array of person IDs to retrieve   |
| domains    | array | Yes      | -       | Must be subset of: `["address", "affinity", "content", "demographic", "email", "employment", "financial", "household", "id", "intent_category", "intent_topic", "interest", "lifestyle", "maid", "name", "phone", "political", "purchase"]` (22 available domains) | Domains to include in the response |

**Parameter Details:**

**person_ids:**

- Array of string person IDs
- Maximum of 1000 person IDs per request
- IDs should be the internal person_id values from the database
- Empty array returns empty result
- Example:
  ```json
  ["person_abc123", "person_def456", "person_ghi789"]
  ```

**domains:**

- Controls which data domains (tables) are included in the response
- **Required parameter** - must specify at least one domain
- Available domains (each maps to a `person_<domain>` table):
  - `address` - Physical addresses
  - `affinity` - Brand and category affinities
  - `content` - Content consumption patterns
  - `demographic` - Age, gender, education, ethnicity, etc.
  - `email` - Email addresses
  - `employment` - Job and career information
  - `financial` - Financial status and credit
  - `household` - Household composition
  - `id` - Identity information
  - `intent_category` - Intent categories
  - `intent_topic` - Intent topics
  - `interest` - Interests and hobbies
  - `lifestyle` - Lifestyle choices
  - `maid` - Mobile advertising IDs
  - `name` - Person names
  - `phone` - Phone numbers
  - `political` - Political data
  - `purchase` - Purchase history
- Example:
  ```json
  ["name", "email", "demographic"]
  ```

**Request Schema (Zod):**

```typescript
{
  person_ids: z.array(z.string())
    .max(1000, "Maximum 1000 person IDs allowed"),
  domains: z.array(z.enum(availableDomains))
}
```

#### Output Format

**Success Response:**

```typescript
Array<PersonRecord>;
```

**Response Fields:**

Each person record contains fields from the joined tables including:

| Field        | Type    | Description                                                            |
| ------------ | ------- | ---------------------------------------------------------------------- |
| person_id    | string  | Unique person identifier                                               |
| json_content | string  | Raw JSON content from various tables                                   |
| first_name   | string  | Person's first name (from person_name table)                           |
| last_name    | string  | Person's last name (from person_name table)                            |
| middle_name  | string  | Person's middle name (optional)                                        |
| ...          | various | Additional fields from demographic, lifestyle, phone, and email tables |

**Example Response:**

```json
[
  {
    "person_id": "person_abc123",
    "first_name": "Jane",
    "last_name": "Smith",
    "json_content": "{...}",
    "email": "jane.smith@example.com",
    "phone": "+15551234567"
  },
  {
    "person_id": "person_def456",
    "first_name": "Michael",
    "last_name": "Johnson",
    "json_content": "{...}"
  }
]
```

#### Error Handling

**Error Response Format:**

```json
{
  "content": [
    {
      "type": "text",
      "text": "Failed to retrieve person profiles: <error message>"
    }
  ],
  "isError": true
}
```

**Common Errors:**

- Empty person_ids array (returns empty array, not an error)
- More than 1000 person IDs provided: "Maximum 1000 person IDs allowed per request"
- Database connection failure
- Query execution timeout
- Invalid person_id format

#### Implementation Details

**Data Source:**

- ClickHouse database
- Tables: `ingress.person_<domain>` for each specified domain

**Query Pattern:**

- Single query with LEFT JOIN across all specified domain tables
- Base table: First domain in the list
- Joins on `person_id` field
- Returns all fields from all joined tables

**Performance Notes:**

- Maximum 1000 person IDs per request (enforced)
- Efficient for batch lookups when you already have person IDs
- Returns only matching records (no entries for non-existent IDs)

#### Usage Examples

**Example 1: Basic person lookup**

```json
{
  "person_ids": ["person_123", "person_456"],
  "domains": ["name", "email"]
}
```

**Example 2: Full profile with all domains**

```json
{
  "person_ids": ["person_789"],
  "domains": ["name", "email", "phone", "demographic", "lifestyle", "affinity"]
}
```

**Example 3: Batch lookup (contacts only)**

```json
{
  "person_ids": ["p1", "p2", "p3", "p4", "p5"],
  "domains": ["email", "phone"]
}
```

---

### 3. Find Persons

**Description:** Find persons based on boolean cluster criteria using semantic cluster IDs. Supports boolean expressions with AND, OR, and NOT operators with parentheses for grouping. Returns audience size and sample of 10 person IDs. Examples: '1000000001 AND 1000000002', '(1000000001 OR 1000000002) AND NOT 1000000003'

**Tool Identifier:** `find_persons`

#### Input Parameters

| Parameter  | Type   | Required | Default | Constraints | Description                                                                                                                                  |
| ---------- | ------ | -------- | ------- | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| expression | string | Yes      | -       | -           | Boolean expression with cluster IDs and AND/OR/NOT operators. Use parentheses for grouping. Standalone NOT is not supported - use "X AND NOT Y" |

**Parameter Details:**

**expression:**

- Boolean expression string combining cluster IDs with logical operators
- Supports operators: AND, OR, NOT (case-sensitive)
- Use parentheses for grouping: `(1000000001 OR 1000000002)`
- NOT must be part of an AND expression - standalone NOT is not supported
  - Valid: `1000000001 AND NOT 1000000002`
  - Valid: `(1000000001 OR 1000000002) AND NOT 1000000003`
  - Invalid: `NOT 1000000001`
- Cluster IDs must be positive integers
- Examples:
  - Simple: `"1000000001"`
  - AND: `"1000000001 AND 1000000002"`
  - OR: `"1000000001 OR 1000000002"`
  - Complex: `"(1000000001 OR 1000000002) AND NOT 1000000003"`
  - Multiple exclusions: `"1000000001 AND NOT 1000000002 AND NOT 1000000003"`
- Ungrouped expressions are evaluated left-to-right with no AND/OR operator precedence

**Request Schema (Zod):**

```typescript
{
  expression: z.string()
    .describe("Boolean expression with cluster IDs and AND/OR/NOT operators. Use parentheses for grouping. Examples: '1000000001', '1000000001 AND 1000000002', '(1000000001 OR 1000000002) AND NOT 1000000003'")
}
```

#### Output Format

**Success Response:**

```typescript
{
  total: number,
  sample: string[]
}
```

**Response Fields:**

| Field  | Type   | Description                                                      |
| ------ | ------ | ---------------------------------------------------------------- |
| total  | number | Total number of persons matching the boolean cluster expression  |
| sample | array  | Array of up to 10 sample person IDs from the matching audience   |

**Example Response:**

```json
{
  "total": 45678,
  "sample": [
    "123456",
    "234567",
    "345678",
    "456789",
    "567890",
    "678901",
    "789012",
    "890123",
    "901234",
    "012345"
  ]
}
```

#### Error Handling

**Error Response Format:**

```json
{
  "content": [
    {
      "type": "text",
      "text": "Person search failed: <error message>"
    }
  ],
  "isError": true
}
```

**Common Errors:**

- Invalid cluster ID: "Invalid cluster ID: <value>"
- Standalone NOT expression: "Standalone NOT expressions are not supported - use \"X AND NOT Y\" instead"
- Pure NOT expression: "Pure NOT expressions are not supported - must have at least one positive criterion"
- Unexpected token: "Unexpected token: <token>"
- Missing closing parenthesis: "Missing closing parenthesis"
- Database connection failure
- Query execution timeout

#### Implementation Details

**Data Source:**

- ClickHouse database
- Table: `egress.cluster_membership` - Maps cluster IDs to person ID bitmaps

**Query Pattern:**

1. Parse boolean expression into an abstract syntax tree (AST)
2. Build ClickHouse bitmap query using:
   - `bitmapAnd` for AND operations
   - `bitmapOr` for OR operations
   - `bitmapAndnot` for AND NOT operations
3. First query: Calculate `bitmapCardinality` to get total audience size
4. Second query: Use `bitmapToArray` with `bitmapSubsetLimit` to extract 10 sample person IDs
5. If total is 0, skip sample query and return empty result

**Performance Notes:**

- Uses ClickHouse's efficient bitmap operations for set algebra
- NOT operations use `bitmapAndnot` to subtract specific clusters without computing full universe
- Avoids expensive `groupBitmapOr` table scans for negation
- Queries execute in milliseconds for most cluster combinations
- Expression parser handles nested parentheses and operator precedence
- All cluster lookups use indexed `cluster_id` column

#### Usage Examples

**Example 1: Single cluster lookup**

```json
{
  "expression": "1000000001"
}
```

**Example 2: Find people in two clusters (intersection)**

```json
{
  "expression": "1000000001 AND 1000000002"
}
```

**Example 3: Find people in either cluster (union)**

```json
{
  "expression": "1000000001 OR 1000000002"
}
```

**Example 4: Complex boolean expression with exclusion**

```json
{
  "expression": "(1000000001 OR 1000000002) AND NOT 1000000003"
}
```

**Example 5: Multiple exclusions**

```json
{
  "expression": "1000000001 AND NOT 1000000002 AND NOT 1000000003"
}
```

---

### 4. Get Cluster

**Description:** Retrieve analytics for a semantic cluster including top predictors, discriminators, and exemplars

**Tool Identifier:** `get_cluster`

#### Input Parameters

| Parameter       | Type   | Required | Default | Constraints                            | Description                                          |
| --------------- | ------ | -------- | ------- | -------------------------------------- | ---------------------------------------------------- |
| cluster_id      | string | Yes      | -       | -                                      | Unique identifier of the cluster to retrieve         |
| cluster_name    | enum   | Yes      | -       | Must be valid cluster name (see below) | Name of the semantic cluster to retrieve             |
| domain          | enum   | Yes      | -       | Must be valid domain (see below)       | Domain category of the cluster                       |
| analytics_depth | number | No       | 10      | Min: 5, Max: 50                        | Number of top items to return for each analytics category |

**Parameter Details:**

**cluster_id:**

- Unique string identifier for the cluster
- Used as a fallback identifier in the query (OR condition with cluster_name)
- Example: `"cluster_gender_male"`

**cluster_name:**

- Must be one of 346 valid cluster names (see "Valid Cluster Names" section below)
- Examples: `"gender"`, `"education"`, `"marital_status"`, `"household_income_range"`, `"golf_affinity"`, `"is_dog_owner"`
- Case-sensitive exact match required

**domain:**

- Must be one of the following valid domains:
  - `"purchase"` - Purchase behavior and transaction data
  - `"demographic"` - Age, gender, education, ethnicity, marital status
  - `"intent_topic"` - Consumer intent and topic interests
  - `"interest"` - Hobbies, activities, and interests
  - `"financial"` - Financial status, credit, investments
  - `"geographic"` - Location-based attributes
  - `"engagement"` - Interaction and engagement metrics
  - `"firmographic"` - Business/company attributes
  - `"affinity"` - Brand and category affinities
  - `"content"` - Content consumption patterns
  - `"employment"` - Job and career information
  - `"household"` - Household composition and attributes
  - `"lifestyle"` - Lifestyle choices and behaviors
  - `"political"` - Political affiliations and contributions

**analytics_depth:**

- Controls how many top items are returned for each category
- Default: 10
- Range: 5 to 50
- Applied to: predictors, discriminators, cooccurring, segments, and exemplars

**Request Schema (Zod):**

```typescript
{
  cluster_id: z.string(),
  cluster_name: z.enum(clusterNames), // 346 valid values
  domain: z.enum(clusterDomains),     // 14 valid values
  analytics_depth: z.number().min(5).max(50).default(10)
}
```

#### Output Format

**Success Response:**

```typescript
{
  cluster: {
    cluster_id: string,
    cluster_name: string,
    value: string,
    domain: string,
    description?: string,
    member_count?: number,
    top_predictors: Array<{
      cluster_id: string,
      lift: number,
      rank: number
    }>,
    top_discriminators: Array<{
      cluster_id: string,
      cohens_d: number,
      rank: number
    }>,
    top_cooccurring: Array<{
      cluster_id: string,
      prevalence: number,
      rank: number
    }>,
    top_segments: Array<{
      segment_id: string,
      cohens_d: number,
      rank: number
    }>,
    top_exemplars: Array<{
      person_id: string,
      distance: number,
      rank: number
    }>
  }
}
```

**Response Fields:**

| Field                                   | Type   | Description                                                              |
| --------------------------------------- | ------ | ------------------------------------------------------------------------ |
| cluster.cluster_id                      | string | Unique identifier for the cluster                                        |
| cluster.cluster_name                    | string | Human-readable name of the cluster                                       |
| cluster.value                           | string | The specific value or category within the cluster                        |
| cluster.domain                          | string | Domain category (purchase, demographic, etc.)                            |
| cluster.description                     | string | Optional description of the cluster                                      |
| cluster.member_count                    | number | Optional count of members in this cluster                                |
| cluster.top_predictors                  | array  | Clusters that predict membership in this cluster (sorted by lift)        |
| cluster.top_predictors[].cluster_id     | string | ID of the predictor cluster                                              |
| cluster.top_predictors[].lift           | number | Lift score indicating prediction strength                                |
| cluster.top_predictors[].rank           | number | Rank order of this predictor                                             |
| cluster.top_discriminators              | array  | Clusters that distinguish this cluster from others (sorted by Cohen's d) |
| cluster.top_discriminators[].cluster_id | string | ID of the discriminating cluster                                         |
| cluster.top_discriminators[].cohens_d   | number | Cohen's d effect size                                                    |
| cluster.top_discriminators[].rank       | number | Rank order of this discriminator                                         |
| cluster.top_cooccurring                 | array  | Clusters that commonly appear with this cluster (sorted by prevalence)   |
| cluster.top_cooccurring[].cluster_id    | string | ID of the co-occurring cluster                                           |
| cluster.top_cooccurring[].prevalence    | number | Prevalence score                                                         |
| cluster.top_cooccurring[].rank          | number | Rank order of this co-occurrence                                         |
| cluster.top_segments                    | array  | Segments strongly associated with this cluster                           |
| cluster.top_segments[].segment_id       | string | ID of the segment                                                        |
| cluster.top_segments[].cohens_d         | number | Cohen's d effect size                                                    |
| cluster.top_segments[].rank             | number | Rank order of this segment                                               |
| cluster.top_exemplars                   | array  | Representative persons (exemplars) for this cluster                      |
| cluster.top_exemplars[].person_id       | string | ID of the exemplar person                                                |
| cluster.top_exemplars[].distance        | number | Distance metric from cluster centroid                                    |
| cluster.top_exemplars[].rank            | number | Rank order of this exemplar                                              |

**Example Response:**

```json
{
  "cluster": {
    "cluster_id": "cluster_gender_male",
    "cluster_name": "gender",
    "value": "Male",
    "domain": "demographic",
    "top_predictors": [
      {
        "cluster_id": "cluster_sports_affinity_high",
        "lift": 2.3,
        "rank": 1
      },
      {
        "cluster_id": "cluster_auto_affinity_high",
        "lift": 1.8,
        "rank": 2
      }
    ],
    "top_discriminators": [
      {
        "cluster_id": "cluster_fashion_interest_low",
        "cohens_d": 0.82,
        "rank": 1
      }
    ],
    "top_cooccurring": [
      {
        "cluster_id": "cluster_technology_affinity",
        "prevalence": 0.67,
        "rank": 1
      }
    ],
    "top_segments": [
      {
        "segment_id": "segment_tech_enthusiasts",
        "cohens_d": 0.75,
        "rank": 1
      }
    ],
    "top_exemplars": [
      {
        "person_id": "person_xyz123",
        "distance": 0.12,
        "rank": 1
      }
    ]
  }
}
```

#### Error Handling

**Error Response Format:**

```json
{
  "content": [
    {
      "type": "text",
      "text": "Cluster analytics failed: <error message>"
    }
  ],
  "isError": true
}
```

**Common Errors:**

- Invalid cluster_name: Must be one of the 346 valid cluster names
- Invalid domain: Must be one of the 14 valid domains
- Analytics depth out of range: "Analytics depth must be between 5 and 50"
- Cluster not found: "Cluster not found: {cluster_name} in domain {domain}"
- Failed to parse cluster analytics: JSON parsing error for cluster_topk field
- Database connection failure
- Query execution timeout

#### Implementation Details

**Data Source:**

- ClickHouse database
- Table: `ingress.cluster`

**⚠️ Known Issue:**

The query contains a typo in the column name: uses `cluser_name` instead of `cluster_name` in the WHERE clause. If you experience issues with cluster lookups, this typo may be the cause.

**Query Pattern:**

1. Query cluster table with exact cluster_name match and LIKE pattern for domain
2. Parse the `cluster_topk` JSON field containing analytics arrays
3. Sort each array by rank and limit to `analytics_depth`
4. Returns up to 1000 records (LIMIT 1000 in query)

**Performance Notes:**

- Single cluster lookup per request
- JSON parsing required for analytics data
- Each analytics category (predictors, discriminators, etc.) limited by analytics_depth parameter
- Domain uses LIKE operator with pattern `{domain}%` for flexible matching

**Analytics Metrics Explained:**

- **Predictors (lift)**: Clusters that strongly predict membership in this cluster. Higher lift = stronger prediction.
- **Discriminators (Cohen's d)**: Clusters that distinguish members from non-members. Higher Cohen's d = stronger differentiation.
- **Co-occurring (prevalence)**: Clusters that frequently appear together with this cluster. Higher prevalence = more common co-occurrence.
- **Segments (Cohen's d)**: Pre-defined segments strongly associated with this cluster.
- **Exemplars (distance)**: Representative individuals who typify this cluster. Lower distance = more representative.

#### Usage Examples

**Example 1: Get basic demographics cluster**

```json
{
  "cluster_id": "cluster_gender",
  "cluster_name": "gender",
  "domain": "demographic"
}
```

**Example 2: Deep dive into golf affinity**

```json
{
  "cluster_id": "cluster_golf_affinity",
  "cluster_name": "golf_affinity",
  "domain": "affinity",
  "analytics_depth": 50
}
```

**Example 3: Household income analysis**

```json
{
  "cluster_id": "cluster_income",
  "cluster_name": "household_income_range",
  "domain": "financial",
  "analytics_depth": 25
}
```

**Example 4: Pet ownership cluster**

```json
{
  "cluster_id": "cluster_dog_owner",
  "cluster_name": "is_dog_owner",
  "domain": "lifestyle",
  "analytics_depth": 15
}
```

---

## Valid Cluster Names

The `cluster_name` parameter in `get_cluster` must be one of the following 346 values:

### Affinity Clusters

- african_american_affinity
- american_history_affinity
- apparel_affinity
- asian_affinity
- auto_affinity
- auto_racing_affinity
- aviation_affinity
- bargain_hunter_affinity
- baseball_affinity
- basketball_affinity
- beauty_affinity
- birds_affinity
- boating_sailing_affinity
- business_affinity
- camping_hiking_climbing_affinity
- cat_affinity
- catalog_affinity
- collectibles_affinity
- college_affinity
- computers_affinity
- continuity_program_affinity
- cooking_affinity
- crafts_affinity
- credit_repair_affinity
- crochet_affinity
- culture_arts_affinity
- diet_affinity
- do_it_yourself_affinity
- dog_affinity
- donor_affinity
- education_seekers_affinity
- ego_affinity
- electronics_affinity
- equestrian_affinity
- family_affinity
- fishing_affinity
- fitness_affinity
- football_affinity
- gambling_affinity
- games_affinity
- gardening_affinity
- golf_affinity
- gourmet_affinity
- grandparents_affinity
- health_affinity
- high_tech_affinity
- history_affinity
- hockey_affinity
- home_decorating_affinity
- home_office_affinity
- humor_affinity
- hunting_affinity
- inspirational_affinity
- insurance_affinity
- kids_apparel_affinity
- knit_affinity
- mens_apparel_affinity
- mens_fashion_affinity
- money_making_affinity
- motorcycles_affinity
- needlepoint_affinity
- ocean_affinity
- outdoors_affinity
- personal_finance_affinity
- pets_affinity
- photography_affinity
- quilt_affinity
- rural_affinity
- science_affinity
- sewing_affinity
- snow_skiing_affinity
- soccer_affinity
- sweepstakes_affinity
- teen_affinity
- tennis_affinity
- tobacco_affinity
- travel_affinity
- travel_cruise_affinity
- travel_rv_affinity
- travel_us_affinity
- trucks_affinity
- tv_movies_affinity
- wildlife_affinity
- womens_apparel_affinity
- womens_fashion_affinity
- womens_home_living_affinity
- young_child_affinity

### Purchase Behavior Clusters

- apparel_accessory_affinity
- apparel_purchases_avg_spend
- apparel_purchases_total_items
- apparel_purchases_total_orders
- apparel_purchases_total_spend
- audio_equipment_purchases_num_companies
- automotive_purchases_num_companies
- aviation_purchases_num_companies
- bargain_seeker_purchases_num_companies
- beauty_product_purchases_num_companies
- boating_sailing_purchases_num_companies
- business_purchases_num_companies
- camping_hiking_purchases_num_companies
- catalog_avg_spend
- catalog_total_items
- catalog_total_orders
- catalog_total_spend
- childrens_apparel_purchases_num_companies
- collectibles_purchases_num_companies
- computer_purchases_num_companies
- continuity_purchases_avg_spend
- continuity_purchases_num_companies
- continuity_purchases_total_orders
- continuity_purchases_total_spend
- craft_purchases_num_companies
- culture_arts_purchases_num_companies
- diy_purchases_num_companies
- electronics_purchases_num_companies
- equestrian_purchases_num_companies
- family_purchases_avg_spend
- family_purchases_total_items
- family_purchases_total_orders
- family_purchases_total_spend
- fiction_purchases_num_companies
- fishing_purchases_num_companies
- fitness_purchases_num_companies
- games_purchases_num_companies
- general_merchandise_purchases_num_companies
- gift_purchases_num_companies
- gourmet_purchases_num_companies
- health_purchases_num_companies
- health_purchases_total_items
- health_purchases_total_orders
- health_purchases_total_spend
- history_purchases_num_companies
- holiday_purchases_num_companies
- home_decorating_purchases_num_companies
- home_goods_purchases_avg_spend
- home_goods_purchases_total_items
- home_goods_purchases_total_orders
- home_goods_purchases_total_spend
- humor_purchases_num_companies
- hunting_purchases_num_companies
- inspiration_purchases_num_companies
- mens_apparel_purchases_num_companies
- mens_fashion_purchases_num_companies
- money_making_purchases_num_companies
- motorcycle_purchases_num_companies
- music_purchases_num_companies
- outdoors_purchases_avg_spend
- outdoors_purchases_num_companies
- outdoors_purchases_total_items
- outdoors_purchases_total_orders
- outdoors_purchases_total_spend
- personal_finance_purchases_num_companies
- pets_purchases_num_companies
- photography_purchases_num_companies
- publisher_total_spend
- purchased_auto_parts
- purchased_books
- purchased_childrens_products
- purchased_clothing
- purchased_cosmetics
- purchased_gifts
- purchased_health_beauty_products
- purchased_home_furnishing
- purchased_home_improvement
- purchased_jewelry
- purchased_musical_instruments
- purchased_plus_size_clothing
- rural_purchases_num_companies
- science_purchases_num_companies
- sports_purchases_num_companies
- travel_purchases_num_companies
- tv_movies_purchases_num_companies
- wildlife_environment_purchases_num_companies
- womens_apparel_purchases_num_companies
- womens_fashion_purchases_avg_spend
- womens_fashion_purchases_num_companies
- womens_fashion_purchases_total_orders
- womens_fashion_purchases_total_spend
- womens_related_purchases_num_companies

### Demographic Clusters

- education
- ethnic_group
- gender
- generation
- marital_status
- occupation_category
- religion
- residence_duration

### Household Clusters

- has_child_aged_0_3_in_household
- has_child_aged_10_12_in_household
- has_child_aged_13_18_in_household
- has_child_aged_4_6_in_household
- has_child_aged_7_9_in_household
- has_children_in_household
- has_home_business
- has_luxury_lifestyle
- has_veteran_in_household
- household_income_range
- household_net_worth_range
- number_adults_in_household
- number_children_in_household
- number_generations_in_household
- number_persons_in_household
- number_vehicles_in_household

### Financial Clusters

- credit_offered_to_household
- credit_rating_range
- has_investments
- individual_income_range
- owns_amex_card
- owns_bank_credit_card
- owns_credit_card
- owns_investments
- owns_premium_amex_card
- owns_premium_credit_card
- owns_stocks_and_bonds
- owns_swimming_pool

### Lifestyle Clusters

- is_cat_owner
- is_charitable_donor
- is_dog_owner
- is_health_conscious
- is_home_owner
- is_international_traveler
- is_investor
- is_motorcycle_owner
- is_multilingual
- is_pet_owner
- is_political_contributor
- is_renter
- is_rv_owner
- is_speaks_english
- is_truck_owner
- is_vacation_traveler
- practices_diy

### Interest Clusters

- interested_aerobics
- interested_antiques_collector
- interested_arts_and_crafts
- interested_baseball
- interested_basketball
- interested_bird_watching
- interested_boating_sailing
- interested_camping_hiking
- interested_cars
- interested_charity
- interested_cigars
- interested_coins_collector
- interested_cooking
- interested_cruise_travel
- interested_dieting
- interested_entertainment
- interested_epicurean
- interested_fine_arts_collector
- interested_fishing
- interested_fitness
- interested_football
- interested_gambling
- interested_gardening
- interested_golf
- interested_healthy_living
- interested_hockey
- interested_home_decor
- interested_home_improvement
- interested_home_study
- interested_hunting
- interested_knitting_quilting_sewing
- interested_motor_racing
- interested_movies
- interested_music
- interested_musical_instruments
- interested_nascar
- interested_outdoors
- interested_outdoors_hunting
- interested_photography
- interested_scuba
- interested_self_improvement
- interested_snow_skiing
- interested_soccer
- interested_sports_memorabilia_collector
- interested_stamps_collector
- interested_tennis
- interested_walking
- interested_woodworking

### Donation/Charity Clusters

- avg_donation_size
- donated_animal_cause
- donated_arts_cultural_cause
- donated_childrens_cause
- donated_conservative_cause_recently
- donated_environmental_cause
- donated_health_cause
- donated_liberal_cause_recently
- donated_political_cause_recently
- donated_political_social_cause_recently
- donated_religious_cause
- donated_veterans_cause
- number_charities
- number_donations

### Content/Reading Clusters

- reads_avid_reader
- reads_bible_devotional
- reads_books_on_tape
- reads_childrens
- reads_computer_it
- reads_cooking_culinary
- reads_country_lifestyle
- reads_entertainment
- reads_fashion
- reads_fiction
- reads_finance
- reads_health_remedies
- reads_history
- reads_interior_decorating
- reads_magazines
- reads_medical_health
- reads_military
- reads_science_fiction
- reads_science_technology
- reads_sports
- reads_world_news_politics
- subscribes_magazines

### Catalog/Publisher Clusters

- number_active_magazine_subscriptions
- number_catalogs
- number_cooking_catalogs
- number_cooking_publishers
- number_family_related_catalogs
- number_family_related_publishers
- number_gardening_catalogs
- number_gardening_publishers
- number_home_decorating_catalogs
- number_home_decorating_publishers
- number_home_living_catalogs
- number_home_living_publishers
- number_housewares_catalogs
- number_housewares_publishers
- number_magazine_auto_renewals
- number_magazine_expirations
- number_magazine_subscriptions
- number_outdoors_catalogs
- number_outdoors_publishers
- number_publishers
- number_publishier_titles

### Intent Clusters

- consumer_intent_category
- intent_topic_high

### Political Clusters

- political_party_affiliation

### Credit Clusters

- number_credit_lines_in_household

---

## Valid Domain Values

The `domain` parameter in `get_cluster` and `domains` array in `get_person` accept different sets of values:

### For `get_cluster` - 14 Cluster Domains

| Domain       | Description                                                       |
| ------------ | ----------------------------------------------------------------- |
| purchase     | Purchase behavior, transaction history, and spending patterns     |
| demographic  | Age, gender, education, ethnicity, marital status, and generation |
| intent_topic | Consumer intent signals and topic interests                       |
| interest     | Hobbies, activities, and personal interests                       |
| financial    | Financial status, credit, income, net worth, and investments      |
| geographic   | Location-based attributes and regional characteristics            |
| engagement   | Interaction metrics and engagement behaviors                      |
| firmographic | Business and company attributes (B2B data)                        |
| affinity     | Brand affinities, product category preferences                    |
| content      | Content consumption patterns, reading habits, media preferences   |
| employment   | Job titles, occupations, and career information                   |
| household    | Household composition, family structure, and home attributes      |
| lifestyle    | Lifestyle choices, behaviors, and life stage indicators           |
| political    | Political affiliations, donations, and civic engagement           |

### For `get_person` - 22 Person Domains

| Domain          | Description                               | Maps to Table          |
| --------------- | ----------------------------------------- | ---------------------- |
| address         | Physical addresses                        | ingress.person_address |
| affinity        | Brand and category affinities             | ingress.person_affinity |
| content         | Content consumption patterns              | ingress.person_content |
| demographic     | Demographics (age, gender, education)     | ingress.person_demographic |
| email           | Email addresses                           | ingress.person_email |
| employment      | Job and career information                | ingress.person_employment |
| financial       | Financial status and credit               | ingress.person_financial |
| household       | Household composition                     | ingress.person_household |
| id              | Identity information                      | ingress.person_id |
| intent_category | Intent categories                         | ingress.person_intent_category |
| intent_topic    | Intent topics                             | ingress.person_intent_topic |
| interest        | Interests and hobbies                     | ingress.person_interest |
| lifestyle       | Lifestyle choices                         | ingress.person_lifestyle |
| maid            | Mobile advertising IDs                    | ingress.person_maid |
| name            | Person names                              | ingress.person_name |
| phone           | Phone numbers                             | ingress.person_phone |
| political       | Political data                            | ingress.person_political |
| purchase        | Purchase history                          | ingress.person_purchase |

---

## Common Response Structures

### CustomerProfile Type

The `CustomerProfile` interface defines the structure returned for person data:

```typescript
interface CustomerProfile {
  person_id: string;
  name?: {
    first?: string;
    last?: string;
    full?: string;
    middle?: string;
    prefix?: string;
    suffix?: string;
  };
  addresses?: any[];
  emails?: any[];
  phones?: any[];
  mobile_ad_ids?: any[];
  affinity?: any;
  content?: any;
  demographic?: any;
  employment?: any;
  financial?: any;
  household?: any;
  intent?: any;
  interest?: any;
  lifestyle?: any;
  political?: any;
  purchase?: any;
}
```

**Note:** The actual data returned from the database includes raw `json_content` fields and normalized columns from the joined tables. The CustomerProfile type represents the intended structure but may not fully match current implementation.

### MCP Response Wrapper

All tool responses follow the MCP protocol format:

**Success:**

```typescript
{
  content: [
    {
      type: "text",
      text: string, // JSON stringified result
    },
  ];
}
```

**Error:**

```typescript
{
  content: [
    {
      type: "text",
      text: string  // Error message
    }
  ],
  isError: true
}
```

---

## Error Codes and Messages

### Standard Error Patterns

| Error Pattern                                  | Cause                                                            | Resolution                                         |
| ---------------------------------------------- | ---------------------------------------------------------------- | -------------------------------------------------- |
| "Identity resolution failed: ..."              | Database error, invalid identifier format, or connectivity issue | Check identifier format and database connection    |
| "Failed to retrieve person profiles: ..."      | Database error or invalid person_ids                             | Verify person_ids exist and database is accessible |
| "Person search failed: ..."                    | Database error or invalid search terms                           | Verify search terms and database connection        |
| "Cluster analytics failed: ..."                | Invalid cluster name/domain, database error, or parsing failure  | Verify cluster_name and domain are valid           |
| "Maximum 1000 person IDs allowed per request"  | Too many person_ids in get_person                                | Reduce number of person_ids to 1000 or fewer       |
| "Maximum limit is 200"                         | Limit exceeds 200 in find_persons                                | Set limit between 1 and 200                        |
| "Analytics depth must be between 5 and 50"     | Invalid analytics_depth in get_cluster                           | Set analytics_depth between 5 and 50               |
| "At least one search term is required"         | Empty demographic_search_terms array                             | Provide at least one valid search term             |
| "Cluster not found: {name} in domain {domain}" | Cluster does not exist or wrong domain                           | Verify cluster_name and domain combination         |
| "Failed to parse cluster analytics data: ..."  | Corrupted JSON in cluster_topk field                             | Contact database administrator                     |

---

## Best Practices

### Identity Resolution

- **Batch Processing**: Send multiple identifiers in a single request rather than making individual calls
- **Type Specification**: Use explicit type objects `{ type: "email", value: "..." }` for better performance when dealing with ambiguous formats
- **Hash Support**: Use the `hash` parameter when working with hashed identifiers (`md5`, `sha1`, `sha256`) to query the appropriate indexed columns
- **Privacy**: Prefer hashed values over plaintext when possible for better privacy protection

### Person Lookup

- **Batch Retrieval**: Leverage the 1000 person ID limit to fetch profiles in bulk
- **Domain Selection**: Request only the domains you need (e.g., `["name", "email"]` instead of all 22 domains)
- **ID Management**: Store and reuse person_ids from previous queries to avoid redundant identity resolution

### Demographic Search

- **Search Strategy**: Start with broader terms and add specificity as needed
- **Term Selection**: Use well-known demographic values (see examples in tool description)
- **Limit Tuning**: Start with smaller limits (50-100) for faster responses, increase as needed
- **AND Logic**: Remember all terms must match - fewer terms = more results

### Cluster Analytics

- **Domain Selection**: Ensure cluster_name matches the domain (e.g., "gender" is in "demographic" domain)
- **Analytics Depth**: Use default (10) for quick analysis, increase to 50 for comprehensive insights
- **Metric Interpretation**:
  - Use predictors to understand what drives cluster membership
  - Use discriminators to understand what makes the cluster unique
  - Use exemplars to find representative individuals
- **Caching**: Cluster analytics change infrequently - consider caching results

### General Recommendations

- **Error Handling**: Always implement error handling for database connectivity and invalid inputs
- **Rate Limiting**: While not enforced in code, be mindful of database load with high-frequency requests
- **Credit Management**: Monitor credit usage if credit system is activated (currently commented out)
- **Response Size**: Be aware that responses can be large - implement streaming or pagination in your client
- **Authentication**: Ensure bearer token is valid and has necessary permissions

---

## Performance Considerations

### Query Patterns

- **LIKE Operator**: Multiple LIKE operations on json_content can be expensive for large datasets
- **LEFT JOINs**: All queries use LEFT JOINs across multiple normalized tables - expect moderate latency
- **Result Limits**: Queries have built-in limits (1000 for most data fetches) to prevent timeout
- **ClickHouse Optimization**: Queries are optimized for ClickHouse's columnar storage

### Response Times

- **Identity Resolution**: ~200-1000ms depending on number of identifiers and matches
- **Person Lookup**: ~100-500ms for batches up to 1000 IDs
- **Demographic Search**: ~300-2000ms depending on search complexity and result size
- **Cluster Analytics**: ~100-300ms for single cluster lookup

### Scalability

- **Concurrent Requests**: Server handles multiple concurrent sessions via StreamableHTTPServerTransport
- **Session Management**: Each user gets isolated MCP server instance
- **Database Connection**: Singleton ClickHouse client shared across requests
- **Memory Usage**: Large result sets can consume significant memory - implement streaming for production use

---

## Known Limitations and Issues

### Implementation Issues

1. **Typo in Cluster Query**: The `getCluster` query uses `cluser_name` instead of `cluster_name` in the WHERE clause (see note in get_cluster tool documentation)
2. **CustomerProfile Mismatch**: The TypeScript `CustomerProfile` interface does not match actual database schema
3. **Credit System**: Credit tracking is implemented but commented out

### Data Quality

- **json_content Fields**: Many tables store data in json_content strings requiring parsing
- **Type Safety**: Database responses are typed as `any` rather than specific interfaces
- **Missing Validation**: Limited validation of search term formats and values

### Functional Limitations

- **No Pagination**: Large result sets return all at once - no cursor or pagination support
- **No Sorting**: Results are not sorted by any specific criteria
- **No Filtering**: Cannot filter by specific fields in get_person or resolve_identities beyond domain selection
- **Fixed Schema**: Cannot dynamically select specific fields from json_content
- **No Aggregations**: Cannot get counts, averages, or other aggregations

### Future Enhancements

- Implement proper pagination for large result sets
- Add field-specific filtering capabilities
- Fix typos and implement incomplete features
- Add stronger TypeScript typing
- Implement credit system and rate limiting
- Add query result caching
- Support for custom cluster definitions
- Aggregation and analytics endpoints

---

## Credits and Rate Limiting

### Current Implementation

- **Credit System**: Implemented but currently disabled (commented out in code)
- **Credit Cost**: Each tool call would decrement credits by 1 when enabled
- **Service**: `UserSessionService.decrementCredits(userId)` is the intended mechanism
- **Rate Limiting**: No rate limiting implemented at MCP server level

### Future Credit System

When enabled, the credit system will:

- Track credits per user via DynamoDB UserSessionService
- Decrement 1 credit per successful tool call
- Return errors when credits are exhausted
- Support credit replenishment through external systems

**Recommendation**: Implement your own rate limiting and usage tracking at the API gateway or application level until the credit system is activated.

---

## Support and Troubleshooting

### Common Issues

**Issue: "Cluster not found" error**

- **Cause**: Invalid cluster_name/domain combination or typo in query
- **Fix**: Verify cluster_name from valid list and ensure domain matches
- **Workaround**: Try different domains or check for case sensitivity

**Issue: No results from find_persons**

- **Cause**: Search terms too specific or no matching demographic data
- **Fix**: Try broader search terms or fewer terms
- **Debug**: Check search_stats in response for execution details

**Issue: Identity resolution returns empty results**

- **Cause**: Identifiers not in database or incorrect format
- **Fix**: Verify identifier format and try different identifiers
- **Note**: Not all identifiers will match - check resolution_stats

**Issue: Slow query performance**

- **Cause**: Large result sets or complex search criteria
- **Fix**: Reduce limit parameter, use more specific search terms
- **Optimize**: Consider caching frequently accessed data

### Debugging Tips

1. Check the `search_stats` and `resolution_stats` in responses for execution metrics
2. Start with small datasets and increase gradually
3. Test each tool independently before combining
4. Monitor database query logs for slow queries
5. Verify bearer token is valid and has permissions

---

## Version History

**v0.1.0** (Current)

- Initial MCP server implementation
- Four core tools: resolve_identities, get_person, find_persons, get_cluster
- StreamableHTTPServerTransport support
- Bearer token authentication
- ClickHouse database integration
- 346 cluster names and 14 cluster domains supported
- 22 person domains supported

---

## Technical Specifications

### Dependencies

- `@modelcontextprotocol/sdk` - MCP protocol implementation
- `zod` - Schema validation
- `@clickhouse/client` - Database connectivity

### Database Schema

- **Database**: ClickHouse
- **Schema**: `ingress`
- **Tables**:
  - `identity_person_deterministic` - Identifier to person_id mapping (emails, phones with hash support)
  - `person_id` - Core person identity data
  - `person_name` - Name information
  - `person_email` - Email contacts
  - `person_phone` - Phone contacts
  - `person_demographic` - Demographic attributes
  - `person_lifestyle` - Lifestyle and behavioral data
  - `person_address` - Physical addresses
  - `person_affinity` - Affinities
  - `person_content` - Content data
  - `person_employment` - Employment data
  - `person_financial` - Financial data
  - `person_household` - Household data
  - `person_intent_category` - Intent categories
  - `person_intent_topic` - Intent topics
  - `person_interest` - Interests
  - `person_maid` - Mobile advertising IDs
  - `person_political` - Political data
  - `person_purchase` - Purchase data
  - `cluster` - Semantic cluster definitions and analytics

### Transport Protocol

- **Type**: StreamableHTTPServerTransport
- **Session Management**: Per-user isolated sessions
- **Serialization**: JSON
- **Content Type**: text/plain for responses

---

**Document Version**: 1.2
**Last Updated**: 2025-10-10
**Server Version**: 0.1.0
