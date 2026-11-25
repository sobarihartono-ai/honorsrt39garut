import type { NextFunction, Request, Response } from 'express';
import type { DecodedIdToken } from 'firebase-admin/auth';
import { getOrCreateUser } from '../db/workspaceRepo.ts';
import { adminAuth } from '../lib/firebase-admin.ts';

export interface AuthRequest extends Request {
  user?: DecodedIdToken;
}

export const requireAuth = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Sesi sinkronisasi tidak ditemukan.' });
    return;
  }

  const token = authHeader.slice('Bearer '.length).trim();
  if (!token) {
    res.status(401).json({ error: 'Token sesi tidak valid.' });
    return;
  }

  try {
    const decodedToken = await adminAuth.verifyIdToken(token);
    const provider = decodedToken.firebase?.sign_in_provider;
    const isAnonymous = provider === 'anonymous' || !decodedToken.email;

    if (!isAnonymous && decodedToken.email && decodedToken.email_verified === false) {
      res.status(401).json({ error: 'Akun belum terverifikasi.' });
      return;
    }

    await getOrCreateUser(decodedToken.uid, decodedToken.email || '', isAnonymous);
    req.user = decodedToken;
    next();
  } catch (error) {
    console.error('Error verifying Firebase ID token:', error);
    res.status(401).json({ error: 'Sesi sinkronisasi berakhir. Memuat ulang sesi...' });
  }
};
