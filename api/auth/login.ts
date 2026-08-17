export default async function handler(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  let body = req.body || {};
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch {
      body = {};
    }
  }

  const email = (body.email || '').trim().toLowerCase();
  const password = (body.password || '').trim();

  const ACCOUNTS: Record<string, { role: 'ADMIN' | 'BLIND_USER' | 'CAREGIVER'; fullName: string; pass: string }> = {
    'admin@watchora.app': { role: 'ADMIN', fullName: 'Admin User', pass: 'AdminPass123!' },
    'user@watchora.app': { role: 'BLIND_USER', fullName: 'Suhasita Rani', pass: 'UserPass123!' },
    'caregiver@watchora.app': { role: 'CAREGIVER', fullName: 'Caregiver User', pass: 'CarePass123!' },
  };

  const account = ACCOUNTS[email];

  if (account) {
    if (account.pass !== password) {
      res.status(401).json({ error: 'Incorrect email or password' });
      return;
    }

    const user = {
      id: `usr_${account.role.toLowerCase()}`,
      email,
      fullName: account.fullName,
      role: account.role,
      preferredLanguage: 'en',
    };

    res.status(200).json({
      token: `demo-token-${account.role.toLowerCase()}-${Date.now()}`,
      refreshToken: `demo-refresh-${account.role.toLowerCase()}-${Date.now()}`,
      user,
    });
    return;
  }

  // Generic fallback user login if non-standard demo email
  if (email && password) {
    const role: 'ADMIN' | 'BLIND_USER' | 'CAREGIVER' = email.includes('admin')
      ? 'ADMIN'
      : email.includes('care')
      ? 'CAREGIVER'
      : 'BLIND_USER';

    const user = {
      id: `usr_${Date.now()}`,
      email,
      fullName: email.split('@')[0] || 'Watchora User',
      role,
      preferredLanguage: 'en',
    };

    res.status(200).json({
      token: `demo-token-${role.toLowerCase()}-${Date.now()}`,
      refreshToken: `demo-refresh-${role.toLowerCase()}-${Date.now()}`,
      user,
    });
    return;
  }

  res.status(400).json({ error: 'Please enter your email and password' });
}
