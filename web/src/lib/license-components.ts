export const LICENSE_COMPONENTS = {
  orbitfs_base: { code: "orbitfs_base", name: "OrbitFS Base System", legacy: ["orbitfs_panel"] },
  orbitfs_mcp: { code: "orbitfs_mcp", name: "OrbitFS MCP", legacy: [] },
  orbitfs_apex: { code: "orbitfs_apex", name: "OrbitFS Apex System", legacy: ["orbitfs_sorter"] },
  orbitfs_studio: { code: "orbitfs_studio", name: "OrbitFS Studio", legacy: [] },
} as const;

export type LicenseComponentCode = keyof typeof LICENSE_COMPONENTS;

const aliasToCanonical = Object.values(LICENSE_COMPONENTS).reduce<Record<string, LicenseComponentCode>>((map, item) => {
  map[item.code] = item.code as LicenseComponentCode;
  for (const alias of item.legacy) map[alias] = item.code as LicenseComponentCode;
  return map;
}, {});

export function canonicalComponentCode(value: unknown): LicenseComponentCode | null {
  const key = String(value || "").trim().toLowerCase();
  return aliasToCanonical[key] || null;
}

export function canonicalComponentList(value: unknown): LicenseComponentCode[] | null {
  if (!Array.isArray(value)) return null;
  return [...new Set(value.map(canonicalComponentCode).filter(Boolean))] as LicenseComponentCode[];
}

/**
 * Accept canonical component codes and their historic aliases at the website API
 * boundary. This is runtime compatibility only: the website licence system keeps
 * its own Supabase data and does not depend on the legacy Cloudflare/D1 system.
 */
export function compatibleComponentList(value: unknown): string[] | null {
  const canonical = canonicalComponentList(value);
  if (!canonical) return null;
  const compatible = new Set<string>();
  for (const code of canonical) {
    compatible.add(code);
    for (const alias of LICENSE_COMPONENTS[code].legacy) compatible.add(alias);
  }
  return [...compatible];
}

export function licenseComponentName(value: unknown) {
  const code = canonicalComponentCode(value);
  return code ? LICENSE_COMPONENTS[code].name : String(value || "");
}

export const LICENSE_COMPONENT_OPTIONS = Object.values(LICENSE_COMPONENTS);
