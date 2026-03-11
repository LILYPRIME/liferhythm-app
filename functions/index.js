const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { setGlobalOptions } = require('firebase-functions/v2');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { defineSecret } = require('firebase-functions/params');
const logger = require('firebase-functions/logger');
const webpush = require('web-push');

initializeApp();
const db = getFirestore();
setGlobalOptions({ region: 'asia-northeast1', maxInstances: 1 });

const vapidPrivateKeySecret = defineSecret('VAPID_PRIVATE_KEY');
const VAPID_PUBLIC_KEY = 'BC7x5ZbVgGVjHp3ShAUa0VqxELCWtrKicpwEb6e48DJWQBVsKJNVUNtdWq6NEOrGn4fOYoZejWKTjYimj_3eWO0';
const VAPID_SUBJECT = 'mailto:daqiaoling0@gmail.com';
const COLLECTIONS = ['users', 'guests'];
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function configureWebPush() {
  const privateKey = vapidPrivateKeySecret.value();
  if (!privateKey) {
    throw new Error('VAPID_PRIVATE_KEY is not configured');
  }
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, privateKey);
}

function normalizePushState(pushState) {
  if (!pushState || typeof pushState !== 'object') {
    return { subscribed: false, endpoint: '', subscription: null, updatedAt: null };
  }
  return {
    subscribed: !!pushState.subscribed,
    endpoint: pushState.endpoint || '',
    subscription: pushState.subscription || null,
    updatedAt: pushState.updatedAt || null,
  };
}

function normalizeSession(session) {
  return {
    sessionId: session.sessionId || `acc_${Math.random().toString(36).slice(2, 10)}`,
    entertainmentId: session.entertainmentId || '',
    entertainmentName: session.entertainmentName || '',
    price: Number(session.price) || 0,
    durationMinutes: Number(session.durationMinutes) || 0,
    startedAt: Number(session.startedAt) || 0,
    warnAt: Number(session.warnAt) || 0,
    endAt: Number(session.endAt) || 0,
    status: session.status === 'expired' ? 'expired' : 'active',
    warnSentAt: session.warnSentAt ? Number(session.warnSentAt) : null,
    endSentAt: session.endSentAt ? Number(session.endSentAt) : null,
    resetAppliedAt: session.resetAppliedAt ? Number(session.resetAppliedAt) : null,
  };
}

function buildTimeoutEvent(session, endedAt) {
  return {
    sessionId: session.sessionId,
    entertainmentId: session.entertainmentId,
    entertainmentName: session.entertainmentName,
    endedAt,
    dismissedAt: null,
  };
}

function buildPayload(type, session) {
  const encodedSessionId = encodeURIComponent(session.sessionId);
  const url = `./?event=session_end&sid=${encodedSessionId}`;

  if (type === 'warning_5m') {
    return {
      title: '\u26a0\ufe0f \u6b8b\u308a5\u5206',
      body: `${session.entertainmentName || '\u5a2f\u697d'} \u306f\u6b8b\u308a5\u5206\u3067\u3059\u3002\u30ad\u30ea\u306e\u3088\u3044\u3068\u3053\u308d\u3067\u623b\u308a\u307e\u3057\u3087\u3046\u3002`,
      type,
      sessionId: session.sessionId,
      entertainmentId: session.entertainmentId,
      entertainmentName: session.entertainmentName,
      url,
      renotify: false,
    };
  }

  return {
    title: '\u23f0 \u6642\u9593\u304c\u6765\u307e\u3057\u305f',
    body: `${session.entertainmentName || '\u5a2f\u697d'} \u306e\u5229\u7528\u6642\u9593\u304c\u7d42\u4e86\u3057\u307e\u3057\u305f\u3002`,
    type,
    sessionId: session.sessionId,
    entertainmentId: session.entertainmentId,
    entertainmentName: session.entertainmentName,
    url,
    renotify: true,
  };
}

function shouldDropSubscription(error) {
  return error && (error.statusCode === 404 || error.statusCode === 410);
}

async function sendPush(subscription, payload) {
  await webpush.sendNotification(subscription, JSON.stringify(payload));
}

async function processDoc(docRef, docData) {
  const now = Date.now();
  const access = docData.access && typeof docData.access === 'object' ? { ...docData.access } : {};
  const sessions = Array.isArray(docData.accessSessions) ? docData.accessSessions.map(normalizeSession) : [];
  const pushState = normalizePushState(docData.pushState);
  let nextPushState = { ...pushState };
  let lastTimeoutEvent = docData.lastTimeoutEvent && typeof docData.lastTimeoutEvent === 'object' ? { ...docData.lastTimeoutEvent } : null;
  let changed = false;
  const payloads = [];

  for (const session of sessions) {
    if (!session.endAt) {
      continue;
    }

    if (session.status !== 'expired' && session.warnAt && session.warnAt <= now && session.endAt > now && !session.warnSentAt) {
      session.warnSentAt = now;
      changed = true;
      if (pushState.subscription) {
        payloads.push(buildPayload('warning_5m', session));
      }
    }

    if (session.status !== 'expired' && session.endAt <= now) {
      session.status = 'expired';
      session.endSentAt = session.endSentAt || now;
      session.resetAppliedAt = session.resetAppliedAt || now;
      access[session.entertainmentId] = null;
      lastTimeoutEvent = buildTimeoutEvent(session, session.endSentAt);
      changed = true;
      if (pushState.subscription) {
        payloads.push(buildPayload('session_end', session));
      }
    }
  }

  const keepSessions = sessions.filter((session) => session.status === 'active' || session.endAt > now - SESSION_TTL_MS);
  if (keepSessions.length !== sessions.length) {
    changed = true;
  }

  if (pushState.subscription && payloads.length > 0) {
    for (const payload of payloads) {
      try {
        await sendPush(pushState.subscription, payload);
      } catch (error) {
        logger.error('push send failed', { path: docRef.path, error: error.message, statusCode: error.statusCode || null });
        if (shouldDropSubscription(error)) {
          nextPushState = {
            subscribed: false,
            endpoint: '',
            subscription: null,
            updatedAt: now,
          };
          changed = true;
          break;
        }
      }
    }
  }

  if (!changed) {
    return false;
  }

  const updates = {
    access,
    accessSessions: keepSessions,
    lastTimeoutEvent: lastTimeoutEvent || null,
  };

  if (JSON.stringify(nextPushState) !== JSON.stringify(pushState)) {
    updates.pushState = nextPushState;
  }

  if (docRef.parent.id === 'guests') {
    updates.lastActive = now;
  }

  await docRef.set(updates, { merge: true });
  return true;
}

async function processCollection(name) {
  const snapshot = await db.collection(name).get();
  let updated = 0;

  for (const doc of snapshot.docs) {
    try {
      const didChange = await processDoc(doc.ref, doc.data() || {});
      if (didChange) {
        updated += 1;
      }
    } catch (error) {
      logger.error('doc processing failed', { path: doc.ref.path, error: error.message });
    }
  }

  return updated;
}

exports.dispatchAccessNotifications = onSchedule(
  {
    schedule: 'every 1 minutes',
    timeZone: 'Asia/Tokyo',
    memory: '256MiB',
    secrets: [vapidPrivateKeySecret],
  },
  async () => {
    configureWebPush();
    const result = {};
    for (const name of COLLECTIONS) {
      result[name] = await processCollection(name);
    }
    logger.info('dispatchAccessNotifications finished', result);
  }
);
