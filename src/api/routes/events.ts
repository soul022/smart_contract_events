import { NextFunction, Request, Response, Router } from 'express';
import { FeeCollectedEventModel } from '../../db/models/FeeCollectedEvent';
import { parseEventsQuery } from '../validation';

export const eventsRouter = Router();

eventsRouter.get(
  '/events',
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const result = parseEventsQuery(req.query as Record<string, unknown>);
    if (!result.ok) {
      res.status(400).json({ error: result.error });
      return;
    }
    const { integrator, limit, offset, chainId, contractAddress, token } = result.value;
    try {
      const predicate: Record<string, unknown> = { integrator };
      if (chainId !== undefined) predicate.chainId = chainId;
      if (contractAddress !== undefined) predicate.contractAddress = contractAddress;
      if (token !== undefined) predicate.token = token;
      const docs = await FeeCollectedEventModel.find(predicate)
        .sort({ blockNumber: -1, logIndex: -1, chainId: 1, txHash: 1 })
        .skip(offset)
        .limit(limit)
        .lean();
      const data = docs.map((d) => ({
        chainId: d.chainId,
        txHash: d.txHash,
        logIndex: d.logIndex,
        blockNumber: d.blockNumber,
        blockHash: d.blockHash,
        contractAddress: d.contractAddress,
        token: d.token,
        integrator: d.integrator,
        integratorFee: d.integratorFee,
        lifiFee: d.lifiFee,
      }));
      res.status(200).json({
        data,
        pagination: { limit, offset, returned: data.length },
      });
    } catch (err) {
      next(err);
    }
  },
);
