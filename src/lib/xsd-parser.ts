import { XMLParser } from "fast-xml-parser";

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * XSD Parser — Extracts field inventory from XSD schema files.
 *
 * Uses fast-xml-parser (already installed) to parse the XSD as XML,
 * then walks the xs:element/xs:complexType/xs:sequence tree to build
 * a flat list of fields with paths, types, and constraints.
 *
 * No native dependencies. Railway-safe.
 */

export interface ParsedField {
  xmlPath: string;
  elementName: string;
  xmlType: string;
  isRequired: boolean;
  isRepeating: boolean;
  isNillable: boolean;
  isAttribute: boolean;
  parentPath: string | null;
  depth: number;
  sortOrder: number;
}

// ─── XSD Namespace Helpers ──────────────────────────────────────────────────

function stripNs(tag: string): string {
  // "xs:element" → "element", "xsd:complexType" → "complexType"
  const i = tag.indexOf(":");
  return i >= 0 ? tag.substring(i + 1) : tag;
}

function findByLocalName(obj: any, localName: string): any {
  if (!obj || typeof obj !== "object") return undefined;
  // Try common prefixes and bare name
  for (const prefix of ["xs:", "xsd:", ""]) {
    const key = `${prefix}${localName}`;
    if (obj[key] !== undefined) return obj[key];
  }
  // Try any key that ends with :localName
  for (const key of Object.keys(obj)) {
    if (stripNs(key) === localName) return obj[key];
  }
  return undefined;
}

function getAttr(obj: any, name: string): string | undefined {
  if (!obj) return undefined;
  return obj[`@_${name}`] ?? obj[name];
}

// ─── Main Parser ────────────────────────────────────────────────────────────

const xsdParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  isArray: (name) => {
    const local = stripNs(name);
    return ["element", "attribute", "sequence", "choice", "all", "enumeration",
            "complexType", "simpleType", "group", "any"].includes(local);
  },
});

export function parseXsdToFields(xsdContent: string): ParsedField[] {
  const parsed = xsdParser.parse(xsdContent);
  const fields: ParsedField[] = [];
  let sortCounter = 0;

  // Find the root schema element
  const schema = findByLocalName(parsed, "schema") || parsed;

  // Collect named types for resolution
  const namedTypes = new Map<string, any>();
  const complexTypes = toArray(findByLocalName(schema, "complexType"));
  for (const ct of complexTypes) {
    const name = getAttr(ct, "name");
    if (name) namedTypes.set(name, ct);
  }
  const simpleTypes = toArray(findByLocalName(schema, "simpleType"));
  for (const st of simpleTypes) {
    const name = getAttr(st, "name");
    if (name) namedTypes.set(name, st);
  }

  // Walk top-level elements
  const topElements = toArray(findByLocalName(schema, "element"));
  for (const el of topElements) {
    walkElement(el, "", 0);
  }

  function walkElement(el: any, parentPath: string, depth: number) {
    const name = getAttr(el, "name");
    if (!name) return;

    const path = parentPath ? `${parentPath}.${name}` : name;
    const minOccurs = parseInt(getAttr(el, "minOccurs") ?? "1", 10);
    const maxOccurs = getAttr(el, "maxOccurs") ?? "1";
    const nillable = getAttr(el, "nillable") === "true";
    const typeName = getAttr(el, "type") || "";

    // Resolve type
    let resolvedType = typeName || "xs:string";
    const isBuiltIn = resolvedType.includes(":") || resolvedType.startsWith("xs") || resolvedType.startsWith("xsd");

    fields.push({
      xmlPath: path,
      elementName: name,
      xmlType: resolvedType,
      isRequired: minOccurs > 0,
      isRepeating: maxOccurs === "unbounded" || parseInt(maxOccurs, 10) > 1,
      isNillable: nillable,
      isAttribute: false,
      parentPath: parentPath || null,
      depth,
      sortOrder: sortCounter++,
    });

    // Walk inline complexType children
    const inlineCt = findByLocalName(el, "complexType");
    const ct = inlineCt
      ? (Array.isArray(inlineCt) ? inlineCt[0] : inlineCt)
      : (!isBuiltIn && namedTypes.has(resolvedType) ? namedTypes.get(resolvedType) : null);

    if (ct) {
      walkComplexType(ct, path, depth + 1);
    }
  }

  function walkComplexType(ct: any, parentPath: string, depth: number) {
    // Walk sequence/choice/all children
    for (const container of ["sequence", "choice", "all"]) {
      const seqs = toArray(findByLocalName(ct, container));
      for (const seq of seqs) {
        const children = toArray(findByLocalName(seq, "element"));
        for (const child of children) {
          walkElement(child, parentPath, depth);
        }
      }
    }

    // Walk direct child elements (some XSD structures nest elements directly)
    const directElements = toArray(findByLocalName(ct, "element"));
    for (const child of directElements) {
      walkElement(child, parentPath, depth);
    }

    // Walk attributes
    const attrs = toArray(findByLocalName(ct, "attribute"));
    for (const attr of attrs) {
      const name = getAttr(attr, "name");
      if (!name) continue;
      const path = parentPath ? `${parentPath}.@${name}` : `@${name}`;
      const use = getAttr(attr, "use") || "optional";
      const type = getAttr(attr, "type") || "xs:string";

      fields.push({
        xmlPath: path,
        elementName: `@${name}`,
        xmlType: type,
        isRequired: use === "required",
        isRepeating: false,
        isNillable: false,
        isAttribute: true,
        parentPath: parentPath || null,
        depth,
        sortOrder: sortCounter++,
      });
    }

    // Walk extension base (xs:complexContent > xs:extension)
    const complexContent = findByLocalName(ct, "complexContent");
    if (complexContent) {
      const ext = findByLocalName(
        Array.isArray(complexContent) ? complexContent[0] : complexContent,
        "extension"
      );
      if (ext) {
        const base = getAttr(Array.isArray(ext) ? ext[0] : ext, "base");
        const extObj = Array.isArray(ext) ? ext[0] : ext;
        if (base && namedTypes.has(base)) {
          walkComplexType(namedTypes.get(base), parentPath, depth);
        }
        // Walk extension's own sequence/attributes
        walkComplexType(extObj, parentPath, depth);
      }
    }

    // Walk simpleContent extension (for attributes on simple elements)
    const simpleContent = findByLocalName(ct, "simpleContent");
    if (simpleContent) {
      const ext = findByLocalName(
        Array.isArray(simpleContent) ? simpleContent[0] : simpleContent,
        "extension"
      );
      if (ext) {
        walkComplexType(Array.isArray(ext) ? ext[0] : ext, parentPath, depth);
      }
    }
  }

  return fields;
}

// ─── Infer Schema from XML ──────────────────────────────────────────────────

/**
 * Infer a field inventory from a sample XML file (no XSD needed).
 * Walks the parsed XML tree and discovers all element paths, types, etc.
 */
export function inferFieldsFromXml(xmlContent: string): ParsedField[] {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
  });
  const parsed = parser.parse(xmlContent);
  const fields: ParsedField[] = [];
  const seenPaths = new Set<string>();
  let sortCounter = 0;

  function walk(obj: any, parentPath: string, depth: number) {
    if (!obj || typeof obj !== "object") return;

    const entries = Array.isArray(obj) ? obj : [obj];
    for (const item of entries) {
      if (typeof item !== "object" || item === null) continue;
      for (const [key, value] of Object.entries(item)) {
        if (key === "#text") continue;

        const isAttr = key.startsWith("@_");
        const cleanKey = isAttr ? `@${key.substring(2)}` : key;
        const path = parentPath ? `${parentPath}.${cleanKey}` : cleanKey;

        if (seenPaths.has(path)) {
          // Check if it's repeating (appears in array context)
          const existing = fields.find(f => f.xmlPath === path);
          if (existing && Array.isArray(value)) {
            existing.isRepeating = true;
          }
          // Still walk children for deeper discovery
          if (value && typeof value === "object" && !isAttr) {
            walk(value, path, depth + 1);
          }
          continue;
        }
        seenPaths.add(path);

        const inferredType = inferType(value);
        const isRepeating = Array.isArray(value);

        fields.push({
          xmlPath: path,
          elementName: cleanKey,
          xmlType: inferredType,
          isRequired: false, // Can't determine from single sample
          isRepeating,
          isNillable: true, // Assume nullable for inferred
          isAttribute: isAttr,
          parentPath: parentPath || null,
          depth,
          sortOrder: sortCounter++,
        });

        // Recurse into objects/arrays
        if (value && typeof value === "object" && !isAttr) {
          walk(value, path, depth + 1);
        }
      }
    }
  }

  walk(parsed, "", 0);
  return fields;
}

function inferType(value: any): string {
  if (value === null || value === undefined) return "xs:string";
  if (Array.isArray(value)) {
    return value.length > 0 ? inferType(value[0]) : "xs:string";
  }
  if (typeof value === "object") return "xs:complexType";
  if (typeof value === "boolean") return "xs:boolean";
  if (typeof value === "number") {
    return Number.isInteger(value) ? "xs:integer" : "xs:decimal";
  }
  const s = String(value);
  // Date patterns
  if (/^\d{4}-\d{2}-\d{2}T/.test(s)) return "xs:dateTime";
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return "xs:date";
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(s)) return "xs:date";
  // Number-like
  if (/^-?\d+$/.test(s) && s.length < 15) return "xs:integer";
  if (/^-?\d+\.\d+$/.test(s)) return "xs:decimal";
  return "xs:string";
}

// ─── Extract XML Paths ──────────────────────────────────────────────────────

/**
 * Extract all unique dot-paths from a parsed XML string.
 * Used for test UI, validation, and mapping coverage calculation.
 */
export function extractXmlPaths(xmlContent: string): string[] {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
  });
  const parsed = parser.parse(xmlContent);
  const paths = new Set<string>();

  function walk(obj: any, prefix: string) {
    if (!obj || typeof obj !== "object") return;
    const items = Array.isArray(obj) ? obj : [obj];
    for (const item of items) {
      if (typeof item !== "object" || item === null) continue;
      for (const [key, value] of Object.entries(item)) {
        if (key === "#text") continue;
        const path = prefix ? `${prefix}.${key}` : key;
        paths.add(path);
        if (value && typeof value === "object") {
          walk(value, path);
        }
      }
    }
  }

  walk(parsed, "");
  return Array.from(paths).sort();
}

function toArray(val: any): any[] {
  if (!val) return [];
  return Array.isArray(val) ? val : [val];
}
