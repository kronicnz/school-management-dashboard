// @ts-nocheck
// deno-lint-ignore-file
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import { dedupeById, matchesOrgUnitPath } from "./shared.ts"

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
}

function jsonResponse(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
    status,
  })
}

/** Converts a Google ID to a deterministic UUID v5-like string */
async function googleIdToUuid(googleId: string): Promise<string> {
  const data = new TextEncoder().encode("google-workspace:" + googleId)
  const hashBuffer = await crypto.subtle.digest("SHA-1", data)
  const hash = new Uint8Array(hashBuffer)
  hash[6] = (hash[6] & 0x0f) | 0x50
  hash[8] = (hash[8] & 0x3f) | 0x80
  const hex = Array.from(hash.slice(0, 16))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

/** Obtains an OAuth Access Token from Google */
async function getGoogleAccessToken(clientId: string, clientSecret: string, refreshToken: string): Promise<string> {
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }).toString(),
  })

  if (!response.ok) {
    const err = await response.text()
    throw new Error(`Failed to refresh Google token: ${err}`)
  }

  const data = await response.json()
  if (!data.access_token) {
    throw new Error("No access token returned from Google")
  }

  return data.access_token
}

/** Fetches users from Google Directory API with strict orgUnitPath matching */
async function fetchGoogleUsersForOrgPath(accessToken: string, targetOrgPath: string): Promise<any[]> {
  const cleanPath = targetOrgPath.startsWith("/") ? targetOrgPath : `/${targetOrgPath}`
  const validUsers: any[] = []
  let pageToken: string | null = null

  do {
    // encodeURI preserves literal '/' slashes so Google Admin API recognizes orgUnitPath correctly
    const queryParams = new URLSearchParams({
      customer: "my_customer",
      maxResults: "500",
      includeOrgUnitChildUsers: "true",
    })
    if (pageToken) queryParams.set("pageToken", pageToken)

    const apiUrl = `https://admin.googleapis.com/admin/directory/v1/users?${queryParams.toString()}&orgUnitPath=${encodeURI(cleanPath)}`

    const response = await fetch(apiUrl, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
      },
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Google API error for ${cleanPath} (${response.status}): ${errorText}`)
    }

    const data = await response.json()
    const fetchedUsers = data.users || []

    // Strict in-memory verification: ensure returned users belong strictly to target OU branch
    for (const user of fetchedUsers) {
      if (matchesOrgUnitPath(user.orgUnitPath, cleanPath)) {
        validUsers.push(user)
      }
    }

    pageToken = data.nextPageToken || null
  } while (pageToken)

  return validUsers
}

/** Upserts records into Supabase in configurable batch sizes */
async function batchUpsert(
  supabase: any,
  table: "students" | "staff" | "assets",
  records: any[],
  batchSize = 100
): Promise<number> {
  let syncCount = 0
  for (let i = 0; i < records.length; i += batchSize) {
    const batch = records.slice(i, i + batchSize)
    const { error } = await supabase.from(table).upsert(batch, { onConflict: "id" })
    if (error) {
      throw new Error(`Upsert error on table '${table}' at offset ${i}: ${error.message}`)
    }
    syncCount += batch.length
  }
  return syncCount
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORS_HEADERS })
  }

  try {
    const body = await req.json()

    const supabaseUrl = Deno.env.get("SUPABASE_URL")
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
    if (!supabaseUrl || !supabaseKey) {
      return jsonResponse({ error: "Missing Supabase environment configuration" }, 500)
    }

    const refreshToken = Deno.env.get("GOOGLE_REFRESH_TOKEN")
    const clientId = Deno.env.get("GOOGLE_CLIENT_ID")
    const clientSecret = Deno.env.get("GOOGLE_CLIENT_SECRET")
    if (!refreshToken || !clientId || !clientSecret) {
      return jsonResponse({ error: "Missing Google OAuth environment credentials" }, 400)
    }

    const authHeader = req.headers.get("Authorization") ?? ""
    if (!authHeader.startsWith("Bearer ")) {
      return jsonResponse({ error: "Missing authorization token" }, 401)
    }

    const supabase = createClient(supabaseUrl, supabaseKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false },
    })

    const { data: userRes, error: userError } = await supabase.auth.getUser()
    if (userError || !userRes.user) {
      return jsonResponse({ error: "Unable to identify the current user" }, 401)
    }

    const { data: roleRows, error: roleError } = await supabase
      .from("user_roles")
      .select("role, active, effective_from, effective_to")
      .eq("profile_id", userRes.user.id)

    if (roleError) {
      return jsonResponse({ error: roleError.message }, 400)
    }

    const activeRoles = (roleRows || [])
      .filter((row) => row.active && (!row.effective_from || new Date(row.effective_from).getTime() <= Date.now()) && (!row.effective_to || new Date(row.effective_to).getTime() >= Date.now()))
      .map((row) => row.role)

    const allowedRoles = new Set(["principal", "deputy_principal", "counsellor_delegate", "leadership_delegate"])
    if (!activeRoles.some((role) => allowedRoles.has(role))) {
      return jsonResponse({ error: "insufficient_privilege" }, 403)
    }

    const accessToken = await getGoogleAccessToken(clientId, clientSecret, refreshToken)

    // ==========================================
    // 1. Staff Sync
    // ==========================================
    if (body?.type === "staff") {
      const staffRecordsById = new Map<string, any>()
      const targetOrgPaths = Array.isArray(body?.orgUnitPaths) && body.orgUnitPaths.length > 0
        ? body.orgUnitPaths
        : typeof body?.orgUnitPath === "string" && body.orgUnitPath.trim().length > 0
          ? [body.orgUnitPath]
        : ["/Accounts/Automated/Staff", "/Accounts/Manual/Administrators"]
      const now = new Date().toISOString()

      for (const targetOrgPath of targetOrgPaths) {
        const rawUsers = await fetchGoogleUsersForOrgPath(accessToken, targetOrgPath)

        for (const user of rawUsers) {
          const firstName = user.name?.givenName || ""
          const lastName = user.name?.familyName || ""
          const email = user.primaryEmail || ""
          if (!firstName && !lastName && !email) continue

          const uuid = await googleIdToUuid(user.id)
          staffRecordsById.set(uuid, {
            id: uuid,
            first_name: firstName,
            last_name: lastName,
            email: email,
            phone: null,
            role: null,
            department: null,
            hire_date: now,
            status: "active",
            created_at: now,
            updated_at: now,
            org_unit_path: user.orgUnitPath || targetOrgPath,
          })
        }
      }

      const staffRecords = dedupeById(Array.from(staffRecordsById.values()))

      if (staffRecords.length === 0) {
        return jsonResponse({ staffSyncCount: 0, errors: [], message: "No staff users found in specified OU" }, 200)
      }

      const staffSyncCount = await batchUpsert(supabase, "staff", staffRecords)
      return jsonResponse({ staffSyncCount, errors: [] }, 200)
    }

    // ==========================================
    // 2. Students Sync
    // ==========================================
    if (body?.type === "students") {
      const targetPaths: string[] = Array.isArray(body?.orgUnitPaths) && body.orgUnitPaths.length > 0
        ? body.orgUnitPaths
        : ["/Accounts/Automated/Students/Year 7", "/Accounts/Automated/Students/Year 8"]

      const studentRecordsById = new Map<string, any>()
      const yearCounts: Record<string, number> = {}
      const now = new Date().toISOString()

      for (const orgPath of targetPaths) {
        const yearGroupMatch = orgPath.match(/Year\s*\d+/i)
        const yearGroup = yearGroupMatch ? yearGroupMatch[0] : "Student"
        yearCounts[yearGroup] = 0

        const rawUsers = await fetchGoogleUsersForOrgPath(accessToken, orgPath)

        for (const user of rawUsers) {
          const firstName = user.name?.givenName || ""
          const lastName = user.name?.familyName || ""
          const email = user.primaryEmail || ""
          if (!firstName && !lastName && !email) continue

          const uuid = await googleIdToUuid(user.id)
          studentRecordsById.set(uuid, {
            id: uuid,
            first_name: firstName,
            last_name: lastName,
            email: email,
            phone: null,
            date_of_birth: null,
            class_id: null,
            parent_name: null,
            parent_phone: null,
            enrollment_date: now,
            status: "active",
            room_number: null,
            created_at: now,
            updated_at: now,
            grade_level: yearGroup,
            org_unit_path: user.orgUnitPath || orgPath,
            year_group: yearGroup,
          })
          yearCounts[yearGroup]++
        }
      }

      const studentRecords = dedupeById(Array.from(studentRecordsById.values()))

      if (studentRecords.length === 0) {
        return jsonResponse({ syncCount: 0, year7Count: 0, year8Count: 0, errors: [], message: "No student users found in specified OUs" }, 200)
      }

      const syncCount = await batchUpsert(supabase, "students", studentRecords)
      return jsonResponse({
        syncCount,
        year7Count: yearCounts["Year 7"] || 0,
        year8Count: yearCounts["Year 8"] || 0,
        errors: [],
      }, 200)
    }

    // ==========================================
    // 3. Assets / ChromeOS Devices Sync
    // ==========================================
    if (body?.type === "assets") {
      let pageToken: string | null = null
      const deviceRecordsById = new Map<string, any>()
      const seenAssetTags = new Set<string>()
      const now = new Date().toISOString()

      // Pre-fetch existing assets from database to map existing IDs and avoid unique constraint violations
      const { data: existingAssets } = await supabase
        .from("assets")
        .select("id, serial_number, asset_tag")

      const existingBySerial = new Map<string, string>()
      const existingByTag = new Map<string, string>()

      if (existingAssets) {
        for (const asset of existingAssets) {
          if (asset.serial_number) existingBySerial.set(asset.serial_number, asset.id)
          if (asset.asset_tag) existingByTag.set(asset.asset_tag, asset.id)
        }
      }

      do {
        const queryParams = new URLSearchParams({
          maxResults: "500",
        })
        if (pageToken) queryParams.set("pageToken", pageToken)

        const apiUrl = `https://admin.googleapis.com/admin/directory/v1/customer/my_customer/devices/chromeos?${queryParams.toString()}`

        const response = await fetch(apiUrl, {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            Accept: "application/json",
          },
        })

        if (!response.ok) {
          const errorText = await response.text()
          throw new Error(`Google ChromeOS API error (${response.status}): ${errorText}`)
        }

        const data = await response.json()
        const devices = data.chromeosdevices || []

        for (const dev of devices) {
          const serialNumber = dev.serialNumber || null
          const rawAssetTag = (dev.annotatedAssetId && dev.annotatedAssetId.trim() !== "")
            ? dev.annotatedAssetId.trim()
            : null

          // Determine initial asset tag fallback
          let assetTag = rawAssetTag || serialNumber || dev.deviceId

          // Avoid asset_tag collisions within the current incoming batch
          if (seenAssetTags.has(assetTag)) {
            assetTag = `${assetTag}_${serialNumber || dev.deviceId}`
          }
          seenAssetTags.add(assetTag)

          // Preserve existing record primary key if matching serial or asset_tag exists in DB
          const matchedId = (serialNumber && existingBySerial.get(serialNumber)) ||
                            existingByTag.get(assetTag) ||
                            await googleIdToUuid(dev.deviceId)

          deviceRecordsById.set(String(matchedId), {
            id: matchedId,
            asset_tag: assetTag,
            name: dev.model || "Google ChromeOS Device",
            category: "Chromebook",
            model: dev.model || "ChromeOS",
            serial_number: serialNumber,
            status: dev.status === "DISABLED" ? "maintenance" : "available",
            location: dev.annotatedLocation || dev.orgUnitPath || "Main Campus",
            condition: "good",
            notes: `OS Version: ${dev.osVersion || "N/A"} | Last Sync: ${dev.lastSync || "N/A"}`,
            updated_at: now,
          })
        }

        pageToken = data.nextPageToken || null
      } while (pageToken)

      const deviceRecords = dedupeById(Array.from(deviceRecordsById.values()))

      if (deviceRecords.length === 0) {
        return jsonResponse({ syncCount: 0, errors: [], message: "No ChromeOS devices found" }, 200)
      }

      const syncCount = await batchUpsert(supabase, "assets", deviceRecords)
      return jsonResponse({ syncCount, errors: [] }, 200)
    }

    return jsonResponse({ error: "Invalid sync type specified" }, 400)
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : "Unknown error occurred" }, 500)
  }
})
