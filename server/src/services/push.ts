import apn from 'apn';

// APNs credentials come from environment variables.
// APNS_KEY      — contents of the .p8 key file (or path via APNS_KEY_PATH)
// APNS_KEY_ID   — 10-char key ID from Apple Developer
// APNS_TEAM_ID  — 10-char team ID from Apple Developer
// APNS_BUNDLE_ID — app bundle identifier (default: com.unnamed.app)
// APNS_PRODUCTION — set to "true" for production APNs endpoint

let provider: apn.Provider | null = null;

function getProvider(): apn.Provider | null {
  if (provider) return provider;

  const keyId = process.env.APNS_KEY_ID;
  const teamId = process.env.APNS_TEAM_ID;
  const keyPath = process.env.APNS_KEY_PATH;
  const keyContents = process.env.APNS_KEY;

  if (!keyId || !teamId || (!keyPath && !keyContents)) return null;

  const options: apn.ProviderOptions = {
    token: {
      key: keyContents ? Buffer.from(keyContents) : keyPath!,
      keyId,
      teamId,
    },
    production: process.env.APNS_PRODUCTION === 'true',
  };

  provider = new apn.Provider(options);
  return provider;
}

const BUNDLE_ID = process.env.APNS_BUNDLE_ID ?? 'com.unnamed.app';

export interface ApprovalPushPayload {
  sessionId: string | null;
  executionId: string;
  approvalId: string;
  action: string;
}

export async function sendApprovalPush(deviceToken: string, payload: ApprovalPushPayload): Promise<void> {
  const p = getProvider();
  if (!p) return;

  const note = new apn.Notification();
  note.expiry = Math.floor(Date.now() / 1000) + 3600;
  note.badge = 1;
  note.sound = 'default';
  note.alert = { title: 'Action needed', body: `${payload.action} is waiting for your approval` };
  note.topic = BUNDLE_ID;
  note.aps.category = 'APPROVALS';
  note.payload = {
    sessionId: payload.sessionId,
    executionId: payload.executionId,
    approvalId: payload.approvalId,
  };

  const result = await p.send(note, deviceToken);
  if (result.failed.length > 0) {
    const err = result.failed[0];
    console.error('[apns] Push failed:', err.error ?? err.response);
    if (err.response?.reason === 'BadDeviceToken' || err.response?.reason === 'Unregistered') {
      throw new Error('DeviceNotRegistered');
    }
  }
}

export async function sendChatMessagePush(deviceToken: string, sessionId: string, preview: string): Promise<void> {
  const p = getProvider();
  if (!p) return;

  const note = new apn.Notification();
  note.expiry = Math.floor(Date.now() / 1000) + 3600;
  note.sound = 'default';
  note.alert = { title: 'New message', body: preview };
  note.topic = BUNDLE_ID;
  note.aps.category = 'CHAT_MESSAGE';
  note.payload = { sessionId };

  const result = await p.send(note, deviceToken);
  if (result.failed.length > 0) {
    const err = result.failed[0];
    console.error('[apns] Push failed:', err.error ?? err.response);
    if (err.response?.reason === 'BadDeviceToken' || err.response?.reason === 'Unregistered') {
      throw new Error('DeviceNotRegistered');
    }
  }
}
