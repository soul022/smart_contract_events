import { NextFunction, Request, Response, Router } from 'express';
import mongoose from 'mongoose';
import { ScanStateModel } from '../../db/models/ScanState';

export const healthRouter = Router();

healthRouter.get(
  '/health',
  async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (mongoose.connection.readyState !== 1) {
      res.status(503).json({ status: 'degraded', mongo: 'disconnected' });
      return;
    }
    try {
      const states = await ScanStateModel.find({}).lean();
      const now = Date.now();
      const scans = states.map((s) => {
        const updatedAt = (s as { updatedAt?: Date }).updatedAt ?? new Date(0);
        // prefer lastRunAt so an idle chain at safeTip still looks fresh
        const heartbeat = s.lastRunAt ?? updatedAt;
        const ageSeconds = Math.floor((now - heartbeat.getTime()) / 1000);
        return {
          chainId: s.chainId,
          contractAddress: s.contractAddress,
          lastScannedBlock: s.lastScannedBlock,
          lastRunAt: s.lastRunAt ? s.lastRunAt.toISOString() : null,
          updatedAt: updatedAt.toISOString(),
          ageSeconds,
        };
      });
      res.status(200).json({ status: 'ok', mongo: 'connected', scans });
    } catch (err) {
      next(err);
    }
  },
);
