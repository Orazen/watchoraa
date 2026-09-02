export default async function handler(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  let body = req.body || {};
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { body = {}; }
  }

  const email = (body.email || '').trim().toLowerCase();
  const fullName = body.fullName || (email ? email.split('@')[0] : 'Watchora User');
  // Demo signup always yields a plain demo user — role was previously inferred
  // from the email substring, which let anyone self-register as ADMIN/CAREGIVER.
  const role = 'BLIND_USER';
  if (!email) {
    res.status(400).json({ error: 'A valid email is required' });
    return;
  }

  const user = {
    id: `usr_${Date.now()}`,
    email: email || 'user@watchora.app',
    fullName,
    role,
    preferredLanguage: 'en',
  };

  res.status(201).json({
    token: `demo-token-${role.toLowerCase()}-${Date.now()}`,
    refreshToken: `demo-refresh-${role.toLowerCase()}-${Date.now()}`,
    user,
  });
}
