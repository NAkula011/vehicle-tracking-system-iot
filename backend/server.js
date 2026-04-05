const express = require('express');
const cors = require('cors');
const http = require('http');
const mqtt = require('mqtt');
const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const jwksClient = require('jwks-rsa');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const server = http.createServer(app);

const PORT = Number(process.env.PORT || 3000);
const MQTT_URL = process.env.MQTT_URL || 'mqtt://broker.hivemq.com';
const MQTT_TOPICS = (process.env.MQTT_TOPIC || 'vehicle/+/location,vehicle/+/status,vehicle/+/ack')
  .split(',')
  .map(topic => topic.trim())
  .filter(Boolean);
const CORS_ORIGIN = process.env.CORS_ORIGIN || 'http://localhost:8080,http://localhost:5173';
const ALLOWED_ORIGINS = CORS_ORIGIN
  .split(',')
  .map(origin => origin.trim())
  .filter(Boolean);

function isAllowedOrigin(origin) {
  if (!origin) {
    return true;
  }

  if (ALLOWED_ORIGINS.includes(origin)) {
    return true;
  }

  try {
    const url = new URL(origin);
    return url.hostname.endsWith('.vercel.app');
  } catch {
    return false;
  }
}

const corsOrigin = (origin, callback) => {
  if (isAllowedOrigin(origin)) {
    callback(null, true);
    return;
  }

  callback(new Error(`CORS blocked for origin: ${origin}`));
};

app.use(cors({ origin: corsOrigin }));
app.use(express.json());

const io = new Server(server, {
  cors: {
    origin: (origin, callback) => {
      if (isAllowedOrigin(origin)) {
        callback(null, true);
        return;
      }

      callback(new Error(`Socket CORS blocked for origin: ${origin}`));
    },
    methods: ['GET', 'POST'],
  },
});

let latestLocation = null;
const DEVICE_TIMEOUT_MS = Number(process.env.DEVICE_TIMEOUT_MS || 4000);
const DEVICE_TOPIC_PREFIX = process.env.DEVICE_TOPIC_PREFIX || 'vehicle';
const DEFAULT_INGEST_TENANT_ID = process.env.DEFAULT_INGEST_TENANT_ID || null;

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SUPABASE_JWT_AUDIENCE = process.env.SUPABASE_JWT_AUDIENCE || 'authenticated';

const hasSupabaseConfig = Boolean(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY);
if (!hasSupabaseConfig) {
  console.warn('[supabase] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. DB-backed APIs are disabled.');
}

const supabaseAdmin = hasSupabaseConfig
  ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
  : null;

const issuer = SUPABASE_URL ? `${SUPABASE_URL.replace(/\/$/, '')}/auth/v1` : null;
const jwksUri = issuer ? `${issuer}/.well-known/jwks.json` : null;
const jwks = jwksUri
  ? jwksClient({
      jwksUri,
      cache: true,
      cacheMaxEntries: 5,
      cacheMaxAge: 60 * 60 * 1000,
      rateLimit: true,
      jwksRequestsPerMinute: 10,
    })
  : null;

function getSigningKey(header, callback) {
  if (!jwks) {
    callback(new Error('Supabase JWKS not configured'));
    return;
  }

  jwks.getSigningKey(header.kid, (error, key) => {
    if (error) {
      callback(error);
      return;
    }

    const signingKey = key?.getPublicKey();
    callback(null, signingKey);
  });
}

function verifyAccessToken(accessToken) {
  return new Promise((resolve, reject) => {
    // Preferred path: local JWT verification using Supabase JWKS
    if (issuer && jwks) {
      jwt.verify(
        accessToken,
        getSigningKey,
        {
          algorithms: ['RS256'],
          issuer,
          audience: SUPABASE_JWT_AUDIENCE,
        },
        (error, decoded) => {
          if (error) {
            reject(error);
            return;
          }

          resolve(decoded);
        }
      );
      return;
    }

    // Fallback path: verify by asking Supabase Auth directly
    if (!supabaseAdmin) {
      reject(new Error('Supabase JWT verification is not configured'));
      return;
    }

    supabaseAdmin.auth.getUser(accessToken)
      .then(({ data, error }) => {
        if (error) {
          reject(new Error(error.message || 'Invalid token'));
          return;
        }

        if (!data?.user?.id) {
          reject(new Error('Invalid token'));
          return;
        }

        resolve({
          sub: data.user.id,
          email: data.user.email || null,
          aud: data.user.aud,
        });
      })
      .catch(error => {
        reject(error);
      });
  });
}

function safeJsonParse(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

async function upsertDeviceInDb(deviceUid, updates = {}) {
  if (!supabaseAdmin || !deviceUid) {
    return null;
  }

  const normalizedUid = String(deviceUid).trim().toUpperCase();

  const { data: existingDevice, error: fetchError } = await supabaseAdmin
    .from('devices')
    .select('id, tenant_id, metadata')
    .eq('device_uid', normalizedUid)
    .maybeSingle();

  if (fetchError) {
    console.error('[supabase] device lookup failed:', fetchError.message);
    return null;
  }

  if (!existingDevice) {
    if (!DEFAULT_INGEST_TENANT_ID) {
      console.warn(`[supabase] Device ${normalizedUid} not found and DEFAULT_INGEST_TENANT_ID is not set`);
      return null;
    }

    const insertPayload = {
      device_uid: normalizedUid,
      tenant_id: DEFAULT_INGEST_TENANT_ID,
      label: normalizedUid,
      status: updates.status || 'online',
      last_seen: updates.last_seen || new Date().toISOString(),
      metadata: updates.metadata || {},
    };

    const { data: inserted, error: insertError } = await supabaseAdmin
      .from('devices')
      .insert(insertPayload)
      .select('id, device_uid, tenant_id, status, last_seen, metadata')
      .single();

    if (insertError) {
      console.error('[supabase] device insert failed:', insertError.message);
      return null;
    }

    return inserted;
  }

  const updatePayload = {
    ...updates,
    metadata: {
      ...(existingDevice.metadata || {}),
      ...(updates.metadata || {}),
    },
  };

  const { data: updated, error: updateError } = await supabaseAdmin
    .from('devices')
    .update(updatePayload)
    .eq('id', existingDevice.id)
    .select('id, device_uid, tenant_id, status, last_seen, metadata')
    .single();

  if (updateError) {
    console.error('[supabase] device update failed:', updateError.message);
    return null;
  }

  return updated;
}

async function insertDeviceEvent(deviceId, type, payload) {
  if (!supabaseAdmin || !deviceId) {
    return;
  }

  const { error } = await supabaseAdmin
    .from('device_events')
    .insert({
      device_id: deviceId,
      type,
      payload,
    });

  if (error) {
    console.error('[supabase] device event insert failed:', error.message);
  }
}

async function updateCommandFromAck(ackPayload) {
  if (!supabaseAdmin || !ackPayload?.commandId) {
    return;
  }

  const status = String(ackPayload.status || 'acknowledged').toLowerCase();
  const finalStatus = ['acknowledged', 'failed', 'timeout', 'sent'].includes(status)
    ? status
    : 'acknowledged';

  const { error } = await supabaseAdmin
    .from('commands')
    .update({
      status: finalStatus,
      ack_at: new Date().toISOString(),
    })
    .eq('id', ackPayload.commandId);

  if (error) {
    console.error('[supabase] command ack update failed:', error.message);
  }
}

async function getAuthorizedDevice(userId, deviceUid) {
  if (!supabaseAdmin) {
    throw new Error('Supabase is not configured');
  }

  const normalizedUid = String(deviceUid || '').trim().toUpperCase();
  if (!normalizedUid) {
    return { device: null, role: null };
  }

  const { data: device, error: deviceError } = await supabaseAdmin
    .from('devices')
    .select('id, device_uid, label, status, last_seen, metadata, tenant_id')
    .eq('device_uid', normalizedUid)
    .maybeSingle();

  if (deviceError) {
    throw new Error(deviceError.message);
  }

  if (!device) {
    return { device: null, role: null };
  }

  const { data: membership, error: membershipError } = await supabaseAdmin
    .from('user_devices')
    .select('role')
    .eq('user_id', userId)
    .eq('device_id', device.id)
    .maybeSingle();

  if (membershipError) {
    throw new Error(membershipError.message);
  }

  if (!membership) {
    return { device: null, role: null };
  }

  return { device, role: membership.role || 'viewer' };
}

async function getUserProfile(userId) {
  if (!supabaseAdmin) {
    throw new Error('Supabase is not configured');
  }

  const { data: profile, error } = await supabaseAdmin
    .from('profiles')
    .select('id, tenant_id, email')
    .eq('id', userId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return profile || null;
}

function extractBearerToken(authHeader) {
  if (!authHeader) return null;
  const [scheme, token] = String(authHeader).split(' ');
  if (!scheme || !token || scheme.toLowerCase() !== 'bearer') return null;
  return token.trim();
}

async function requireAuth(req, res, next) {
  try {
    const token = extractBearerToken(req.headers.authorization);
    if (!token) {
      return res.status(401).json({ error: 'Missing bearer token' });
    }

    const decoded = await verifyAccessToken(token);
    req.user = {
      id: decoded.sub,
      email: decoded.email || null,
      claims: decoded,
    };

    return next();
  } catch (error) {
    return res.status(401).json({ error: `Invalid token: ${error.message}` });
  }
}
const deviceRegistry = new Map();

function upsertDevice(deviceId, partial = {}) {
  if (!deviceId) return;
  const existing = deviceRegistry.get(deviceId) || { deviceId, connected: false, lastSeen: null };
  deviceRegistry.set(deviceId, {
    ...existing,
    ...partial,
    deviceId,
  });
}

function getDevicesState() {
  return Array.from(deviceRegistry.values())
    .sort((a, b) => a.deviceId.localeCompare(b.deviceId));
}

function emitDevicesState() {
  io.emit('devices-state', {
    devices: getDevicesState(),
    updatedAt: new Date().toISOString(),
  });
}

function normalizeLocation(topic, message) {
  const raw = message.toString().trim();
  const topicParts = topic.split('/');
  const deviceIdFromTopic = topicParts.length >= 3 ? topicParts[1] : 'unknown-device';
  const base = {
    topic,
    deviceId: deviceIdFromTopic,
    vehicleId: deviceIdFromTopic,
    raw,
    timestamp: new Date().toISOString(),
  };

  try {
    const parsed = JSON.parse(raw);
    const latitude = Number(parsed?.latitude ?? parsed?.lat);
    const longitude = Number(parsed?.longitude ?? parsed?.lng ?? parsed?.lon);

    if (
      parsed &&
      typeof parsed === 'object' &&
      Number.isFinite(latitude) &&
      Number.isFinite(longitude)
    ) {
      return {
        ...base,
        ...parsed,
        latitude,
        longitude,
        deviceId: deviceIdFromTopic,
        vehicleId: deviceIdFromTopic,
      };
    }
  } catch {
    // fall through to comma-separated parsing
  }

  const [latitudeText, longitudeText, speedText] = raw.split(',').map(part => part.trim());
  const latitude = Number(latitudeText);
  const longitude = Number(longitudeText);

  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return null;
  }

  const speed = speedText ? Number(speedText) : undefined;

  return {
    ...base,
    latitude,
    longitude,
    ...(Number.isFinite(speed) ? { speed } : {}),
  };
}

app.get('/health', (_req, res) => {
  res.json({
    ok: true,
    mqttConnected: Boolean(mqttClient && mqttClient.connected),
    supabaseConfigured: Boolean(supabaseAdmin),
  });
});

app.get('/api/latest-location', (_req, res) => {
  res.json({ latestLocation });
});

app.get('/api/devices', requireAuth, async (req, res) => {
  if (!supabaseAdmin) {
    return res.status(503).json({ error: 'Supabase is not configured in backend' });
  }

  const userId = req.user.id;
  const { data: links, error: linksError } = await supabaseAdmin
    .from('user_devices')
    .select('device_id, role')
    .eq('user_id', userId);

  if (linksError) {
    return res.status(500).json({ error: linksError.message });
  }

  if (!links || links.length === 0) {
    return res.json({ devices: [] });
  }

  const deviceIds = links.map(link => link.device_id);
  const roleByDeviceId = new Map(links.map(link => [link.device_id, link.role || 'viewer']));

  const { data: devices, error: devicesError } = await supabaseAdmin
    .from('devices')
    .select('id, device_uid, label, status, last_seen, metadata, tenant_id')
    .in('id', deviceIds)
    .order('device_uid', { ascending: true });

  if (devicesError) {
    return res.status(500).json({ error: devicesError.message });
  }

  const payload = (devices || []).map(device => ({
    id: device.id,
    deviceId: String(device.device_uid || '').toUpperCase(),
    label: device.label || device.device_uid,
    status: device.status,
    lastSeen: device.last_seen,
    metadata: device.metadata || {},
    tenantId: device.tenant_id,
    role: roleByDeviceId.get(device.id) || 'viewer',
  }));

  return res.json({ devices: payload });
});

app.post('/api/devices/claim', requireAuth, async (req, res) => {
  if (!supabaseAdmin) {
    return res.status(503).json({ error: 'Supabase is not configured in backend' });
  }

  const userId = req.user.id;
  const deviceUid = String(req.body?.deviceUid || '').trim().toUpperCase();
  const label = String(req.body?.label || '').trim();

  if (!deviceUid) {
    return res.status(400).json({ error: 'deviceUid is required' });
  }

  let profile;
  try {
    profile = await getUserProfile(userId);
  } catch (error) {
    return res.status(500).json({ error: error.message || 'Failed to load user profile' });
  }

  if (!profile?.tenant_id) {
    return res.status(400).json({ error: 'User tenant is not initialized' });
  }

  const { data: existingDevice, error: existingDeviceError } = await supabaseAdmin
    .from('devices')
    .select('id, tenant_id, device_uid, label')
    .eq('device_uid', deviceUid)
    .maybeSingle();

  if (existingDeviceError) {
    return res.status(500).json({ error: existingDeviceError.message });
  }

  let device = existingDevice;
  if (!device) {
    const { data: inserted, error: insertError } = await supabaseAdmin
      .from('devices')
      .insert({
        device_uid: deviceUid,
        tenant_id: profile.tenant_id,
        label: label || deviceUid,
        status: 'offline',
      })
      .select('id, tenant_id, device_uid, label')
      .single();

    if (insertError) {
      return res.status(500).json({ error: insertError.message || 'Failed to initialize device' });
    }

    device = inserted;
  }

  if (device.tenant_id !== profile.tenant_id) {
    return res.status(403).json({ error: 'This device belongs to another account/tenant' });
  }

  const { data: existingLink, error: linkLookupError } = await supabaseAdmin
    .from('user_devices')
    .select('user_id, role')
    .eq('device_id', device.id)
    .eq('user_id', userId)
    .maybeSingle();

  if (linkLookupError) {
    return res.status(500).json({ error: linkLookupError.message });
  }

  if (!existingLink) {
    const { error: linkInsertError } = await supabaseAdmin
      .from('user_devices')
      .insert({
        user_id: userId,
        device_id: device.id,
        role: 'owner',
      });

    if (linkInsertError) {
      return res.status(500).json({ error: linkInsertError.message || 'Failed to assign device ownership' });
    }
  }

  if (label && label !== (device.label || '')) {
    await supabaseAdmin
      .from('devices')
      .update({ label })
      .eq('id', device.id);
  }

  return res.status(201).json({
    ok: true,
    device: {
      id: device.id,
      deviceUid: device.device_uid,
      label: label || device.label || device.device_uid,
      tenantId: device.tenant_id,
    },
  });
});

app.get('/api/commands', requireAuth, async (req, res) => {
  if (!supabaseAdmin) {
    return res.status(503).json({ error: 'Supabase is not configured in backend' });
  }

  const userId = req.user.id;
  const requestedDevice = String(req.query.deviceId || '').trim().toUpperCase();
  const limit = Math.max(1, Math.min(100, Number(req.query.limit || 20)));

  const { data: links, error: linksError } = await supabaseAdmin
    .from('user_devices')
    .select('device_id')
    .eq('user_id', userId);

  if (linksError) {
    return res.status(500).json({ error: linksError.message });
  }

  const allowedDeviceIds = (links || []).map(link => link.device_id);
  if (allowedDeviceIds.length === 0) {
    return res.json({ commands: [] });
  }

  let query = supabaseAdmin
    .from('commands')
    .select('id, device_id, command, status, requested_by, created_at, ack_at')
    .in('device_id', allowedDeviceIds)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (requestedDevice) {
    const { data: device, error: deviceError } = await supabaseAdmin
      .from('devices')
      .select('id')
      .eq('device_uid', requestedDevice)
      .maybeSingle();

    if (deviceError) {
      return res.status(500).json({ error: deviceError.message });
    }

    if (!device || !allowedDeviceIds.includes(device.id)) {
      return res.json({ commands: [] });
    }

    query = query.eq('device_id', device.id);
  }

  const { data: commands, error: commandsError } = await query;
  if (commandsError) {
    return res.status(500).json({ error: commandsError.message });
  }

  return res.json({ commands: commands || [] });
});

// Locations API: list and create user locations
app.get('/api/locations', requireAuth, async (req, res) => {
  if (!supabaseAdmin) return res.status(503).json({ error: 'Supabase is not configured' });

  try {
    const { data, error } = await supabaseAdmin
      .from('locations')
      .select('*')
      .eq('user_id', req.user.id)
      .order('created_at', { ascending: false });

    if (error) return res.status(500).json({ error: error.message });
    return res.json({ locations: data || [] });
  } catch (err) {
    return res.status(500).json({ error: String(err) });
  }
});

app.post('/api/locations', requireAuth, async (req, res) => {
  if (!supabaseAdmin) return res.status(503).json({ error: 'Supabase is not configured' });

  const { label, latitude, longitude, type = 'other', is_home = false, metadata = {} } = req.body || {};
  if (!label || typeof latitude !== 'number' || typeof longitude !== 'number') {
    return res.status(400).json({ error: 'label, latitude and longitude are required' });
  }

  try {
    const payload = {
      user_id: req.user.id,
      label,
      latitude,
      longitude,
      type,
      is_home,
      metadata,
    };

    const { data: inserted, error: insertError } = await supabaseAdmin
      .from('locations')
      .insert(payload)
      .select('*')
      .single();

    if (insertError) return res.status(500).json({ error: insertError.message });

    if (is_home) {
      await supabaseAdmin
        .from('locations')
        .update({ is_home: false })
        .eq('user_id', req.user.id)
        .neq('id', inserted.id);
    }

    return res.status(201).json({ location: inserted });
  } catch (err) {
    return res.status(500).json({ error: String(err) });
  }
});

app.post('/api/device/:deviceId/command', requireAuth, async (req, res) => {
  const deviceId = String(req.params.deviceId || '').trim();
  const command = String(req.body?.command || '').trim().toUpperCase();
  const userId = req.user.id;

  console.log(`[api] command request: device=${deviceId}, command=${command}`);

  if (!deviceId) {
    return res.status(400).json({ error: 'deviceId is required' });
  }

  const validCommands = new Set(['START_ENGINE', 'STOP_ENGINE', 'LOCK', 'UNLOCK']);
  if (!validCommands.has(command)) {
    return res.status(400).json({ error: 'Invalid command' });
  }

  if (!supabaseAdmin) {
    return res.status(503).json({ error: 'Supabase is not configured in backend' });
  }

  let authDevice;
  let role;
  try {
    const result = await getAuthorizedDevice(userId, deviceId);
    authDevice = result.device;
    role = result.role;
  } catch (error) {
    return res.status(500).json({ error: error.message || 'Device authorization lookup failed' });
  }

  if (!authDevice) {
    return res.status(403).json({ error: `No access to device '${deviceId}'` });
  }

  if (String(role).toLowerCase() === 'viewer') {
    return res.status(403).json({ error: 'Viewer role cannot send commands' });
  }

  const lastSeenMs = authDevice.last_seen ? new Date(authDevice.last_seen).getTime() : 0;
  const dbSaysOnline = authDevice.status === 'online' && Number.isFinite(lastSeenMs) && (Date.now() - lastSeenMs <= 120000);
  if (!dbSaysOnline) {
    return res.status(409).json({ error: `Device '${deviceId}' is currently offline` });
  }

  if (!mqttClient.connected) {
    return res.status(503).json({ error: 'MQTT broker is not connected' });
  }

  const normalizedDeviceUid = String(authDevice.device_uid || deviceId).toUpperCase();
  const topic = `${DEVICE_TOPIC_PREFIX}/${normalizedDeviceUid}/command`;
  const payload = JSON.stringify({
    deviceId: normalizedDeviceUid,
    command,
    requestedBy: userId,
    timestamp: new Date().toISOString(),
  });

  const { data: commandRow, error: commandInsertError } = await supabaseAdmin
    .from('commands')
    .insert({
      device_id: authDevice.id,
      command,
      status: 'queued',
      requested_by: userId,
    })
    .select('id, created_at')
    .single();

  if (commandInsertError) {
    return res.status(500).json({ error: commandInsertError.message || 'Failed to create command row' });
  }

  const commandId = commandRow.id;
  const commandPayload = JSON.stringify({
    commandId,
    deviceId: normalizedDeviceUid,
    command,
    requestedBy: userId,
    timestamp: new Date().toISOString(),
  });

  mqttClient.publish(topic, commandPayload, { qos: 1 }, async publishError => {
    if (publishError) {
      await supabaseAdmin
        .from('commands')
        .update({ status: 'failed', ack_at: new Date().toISOString() })
        .eq('id', commandId);
      return res.status(500).json({ error: publishError.message || 'Failed to publish command' });
    }

    await supabaseAdmin
      .from('commands')
      .update({ status: 'sent' })
      .eq('id', commandId);

    console.log(`[mqtt] COMMAND sent -> ${topic}: ${commandPayload}`);
    io.emit('command-status', {
      ok: true,
      commandId,
      deviceId: normalizedDeviceUid,
      command,
      topic,
      timestamp: new Date().toISOString(),
    });

    return res.status(202).json({ ok: true, commandId, deviceId: normalizedDeviceUid, command, topic });
  });
});

function emitDeviceStatus() {
  const now = Date.now();
  let anyConnected = false;

  for (const [deviceId, device] of deviceRegistry.entries()) {
    const lastSeenTs = device.lastSeen ? new Date(device.lastSeen).getTime() : 0;
    const connected = Number.isFinite(lastSeenTs) && now - lastSeenTs <= DEVICE_TIMEOUT_MS;
    if (connected) {
      anyConnected = true;
    }

    deviceRegistry.set(deviceId, {
      ...device,
      connected,
    });
  }

  const latestDeviceId = latestLocation?.deviceId ?? latestLocation?.vehicleId ?? null;
  const latestDeviceConnected = latestDeviceId ? deviceRegistry.get(latestDeviceId)?.connected : false;
  const firstConnectedDevice = getDevicesState().find(device => device.connected);
  const activeDeviceId = latestDeviceConnected
    ? latestDeviceId
    : (firstConnectedDevice?.deviceId ?? null);

  io.emit('device-status', {
    connected: anyConnected,
    deviceId: activeDeviceId,
    lastSeen: activeDeviceId ? (deviceRegistry.get(activeDeviceId)?.lastSeen ?? null) : null,
  });
  emitDevicesState();
  return anyConnected;
}

function emitSpecificDeviceStatus(connected, deviceId) {
  upsertDevice(deviceId, {
    connected,
    lastSeen: new Date().toISOString(),
  });

  io.emit('device-status', {
    connected,
    deviceId: deviceId || null,
    lastSeen: new Date().toISOString(),
  });
  emitDevicesState();
}

app.post('/api/location', (req, res) => {
  const { latitude, longitude, speed, vehicleId, gsmSignal, engineOn, locked } = req.body || {};
  const parsedLatitude = Number(latitude);
  const parsedLongitude = Number(longitude);

  if (!Number.isFinite(parsedLatitude) || !Number.isFinite(parsedLongitude)) {
    return res.status(400).json({ error: 'latitude and longitude are required' });
  }

  const payload = {
    vehicleId: vehicleId || 'VH-2024-IOT',
    latitude: parsedLatitude,
    longitude: parsedLongitude,
    ...(Number.isFinite(Number(speed)) ? { speed: Number(speed) } : {}),
    ...(Number.isFinite(Number(gsmSignal)) ? { gsmSignal: Math.max(0, Math.min(5, Number(gsmSignal))) } : {}),
    ...(typeof engineOn === 'boolean' ? { engineOn } : {}),
    ...(typeof locked === 'boolean' ? { locked } : {}),
    topic: 'manual/api',
    raw: JSON.stringify(req.body || {}),
    timestamp: new Date().toISOString(),
  };

  latestLocation = payload;
  upsertDevice(payload.vehicleId, {
    connected: true,
    lastSeen: payload.timestamp,
    latestLocation: {
      latitude: payload.latitude,
      longitude: payload.longitude,
      speed: payload.speed,
    },
  });
  io.emit('location', payload);
  emitDeviceStatus();

  return res.status(201).json(payload);
});

app.use((_req, res) => {
  res.status(404).json({ error: 'Not found' });
});

io.on('connection', socket => {
  console.log(`[socket] connected: ${socket.id}`);

  if (latestLocation) {
    socket.emit('location', latestLocation);
  }

  socket.emit('device-status', {
    connected: getDevicesState().some(device => device.connected),
    deviceId: latestLocation?.deviceId ?? latestLocation?.vehicleId ?? null,
    lastSeen: latestLocation?.timestamp ?? null,
  });

  socket.emit('devices-state', {
    devices: getDevicesState(),
    updatedAt: new Date().toISOString(),
  });

  socket.on('disconnect', () => {
    console.log(`[socket] disconnected: ${socket.id}`);
  });
});

const mqttClient = mqtt.connect(MQTT_URL, {
  keepalive: 5,
  reconnectPeriod: 1000,
});

mqttClient.on('connect', () => {
  console.log(`[mqtt] connected to ${MQTT_URL}`);
  if (MQTT_TOPICS.length === 0) {
    console.warn('[mqtt] no topics configured');
    return;
  }

  mqttClient.subscribe(MQTT_TOPICS, error => {
    if (error) {
      console.error('[mqtt] subscribe error:', error.message);
      return;
    }

    console.log(`[mqtt] subscribed to ${MQTT_TOPICS.join(', ')}`);
  });
});

mqttClient.on('message', (topic, message) => {
  console.log('RECEIVED:', topic, message.toString());

  if (topic.endsWith('/ack')) {
    const ackPayload = safeJsonParse(message.toString()) || {};
    updateCommandFromAck(ackPayload);
    io.emit('command-status', {
      ok: true,
      commandId: ackPayload.commandId || null,
      status: ackPayload.status || 'acknowledged',
      deviceId: ackPayload.deviceId || null,
      timestamp: new Date().toISOString(),
    });
    return;
  }

  if (topic.endsWith('/status')) {
    const topicParts = topic.split('/');
    const deviceId = (topicParts.length >= 3 ? topicParts[1] : 'unknown-device').toUpperCase();
    const statusText = message.toString().trim().toLowerCase();
    const isOnline = statusText === 'online' || statusText === '1' || statusText === 'true';

    if (!isOnline) {
      upsertDevice(deviceId, {
        connected: false,
        lastSeen: new Date().toISOString(),
      });
      upsertDeviceInDb(deviceId, {
        status: 'offline',
        last_seen: new Date().toISOString(),
        metadata: {
          source: 'mqtt-status',
          statusPayload: statusText,
        },
      });
      emitSpecificDeviceStatus(false, deviceId);
      console.log(`[mqtt] Device ${deviceId} reported OFFLINE`);
      return;
    }

    upsertDevice(deviceId, {
      connected: true,
      lastSeen: new Date().toISOString(),
    });
    upsertDeviceInDb(deviceId, {
      status: 'online',
      last_seen: new Date().toISOString(),
      metadata: {
        source: 'mqtt-status',
        statusPayload: statusText,
      },
    });
    emitSpecificDeviceStatus(true, deviceId);
    console.log(`[mqtt] Device ${deviceId} reported ONLINE`);
    return;
  }

  const location = normalizeLocation(topic, message);

  if (!location) {
    console.warn(`[mqtt] ignored invalid payload on ${topic}: ${message.toString()}`);
    return;
  }

  latestLocation = location;
  const normalizedDeviceId = String(location.deviceId ?? location.vehicleId ?? '').toUpperCase();

  upsertDevice(normalizedDeviceId, {
    connected: true,
    lastSeen: new Date(location.timestamp).toISOString(),
    latestLocation: {
      latitude: location.latitude,
      longitude: location.longitude,
      speed: location.speed,
    },
  });
  upsertDeviceInDb(normalizedDeviceId, {
    status: 'online',
    last_seen: new Date(location.timestamp).toISOString(),
    metadata: {
      source: 'mqtt-location',
      latitude: location.latitude,
      longitude: location.longitude,
      speed: location.speed,
      gsmSignal: location.gsmSignal,
      engineOn: location.engineOn,
      locked: location.locked,
    },
  }).then(device => {
    if (!device?.id) return;

    insertDeviceEvent(device.id, 'telemetry', {
      topic,
      raw: location.raw || null,
      latitude: location.latitude,
      longitude: location.longitude,
      speed: location.speed,
      gsmSignal: location.gsmSignal,
      engineOn: location.engineOn,
      locked: location.locked,
      timestamp: location.timestamp,
    });
  });

  io.emit('location', location);
  emitDeviceStatus();
  console.log(`[mqtt] Device: ${normalizedDeviceId} | Topic: ${topic} | Payload: ${location.raw ?? `${location.latitude},${location.longitude}`}`);
});

setInterval(() => {
  emitDeviceStatus();
}, 1000);

mqttClient.on('error', error => {
  console.error('[mqtt] error:', error.message);
});

server.listen(PORT, () => {
  console.log(`Backend running on http://localhost:${PORT}`);
});