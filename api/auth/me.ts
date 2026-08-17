export default async function handler(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  const authHeader = req.headers['authorization'] || '';
  const token = authHeader.replace(/^Bearer\s+/i, '');

  let role: 'ADMIN' | 'BLIND_USER' | 'CAREGIVER' = 'BLIND_USER';
  let email = 'user@watchora.app';
  let fullName = 'Suhasita Rani';

  if (token.includes('admin')) {
    role = 'ADMIN';
    email = 'admin@watchora.app';
    fullName = 'Admin User';
  } else if (token.includes('care')) {
    role = 'CAREGIVER';
    email = 'caregiver@watchora.app';
    fullName = 'Caregiver User';
  }

  res.status(200).json({
    user: {
      id: `usr_${role.toLowerCase()}`,
      email,
      fullName,
      role,
      preferredLanguage: 'en',
    },
  });
}
