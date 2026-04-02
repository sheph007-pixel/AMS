# CLAUDE.md — Kennion AMS Development Rules

## Schema Management

- Schema versions are preserved and never overwritten
- Field mappings are explicit, not assumed from code
- Schema validation (XSD structural) and business validation (data rules) are separate concerns
- New XML fields must be reviewed via the admin Schema Management section before adoption into production behavior
- Admin-managed schema and field mappings are the source of truth for XML ingestion and reporting
- FieldMapping is keyed by xmlPath (string), not strictly tied to SchemaField — XML can contain fields not in XSD
- Coverage metrics are based on discovered XML fields at runtime, not SchemaField entries from XSD

## XML Ingestion

- If an active SchemaVersion exists, use mapping-driven import (`importWithMappings`)
- If no active schema, fall back to legacy hardcoded import (`importLegacy`) safely
- Enrollment qualification: EmploymentStatus must be "Active", EnrollmentType must be "Current"
- CoverageEndDate is compared against the snapshot month start, not today
- COBRA plan types are excluded from production reports
- CarrierSetting.excluded carriers are filtered during cache build

## Data Type Defaults

- Business identifiers (IDs, ZIPs, SSNs, policy numbers, plan codes, carrier/member identifiers, phone numbers) default to string handling
- Date and dateTime fields remain typed where the feed is consistent
- Optional fields are handled safely — missing/null must not break ingestion
- Inferred schemas are treated as modifiable and versioned, not as permanent contracts
- Looser ingestion is preferred over brittle ingestion, as long as downstream validation is explicit

## Reporting

- Production dashboard data is pre-computed during cache rebuild and served from ReportCache
- Compact JSON keys in cache (2-letter), expanded in API response
- CoverageLevel from Enrollment is used as the Grouping column (contains both "Employee" and age bands like "30-39")
- Carrier income method (PEPM, PERCENT_PREMIUM, NONE) and rate come from CarrierSetting table

## Architecture

- Next.js 15 App Router, Prisma 5.22 + PostgreSQL, Tailwind CSS
- Deployed on Railway (avoid native npm dependencies)
- fast-xml-parser for all XML/XSD parsing (no additional XML libraries)
- Admin section is PIN-locked (PIN: 8787)
- Report caches rebuilt after each import and carrier setting change
