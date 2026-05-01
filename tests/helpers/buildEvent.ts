import { ethers } from 'ethers';

export type BuildEventInput = {
  txHash?: string;
  logIndex?: number;
  blockNumber?: number;
  blockHash?: string;
  token?: string;
  integrator?: string;
  integratorFee?: string;
  lifiFee?: string;
  args?: ethers.utils.Result | undefined;
};

const DEFAULT_TX_HASH = '0xABCDEF1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF1234567890';
const DEFAULT_BLOCK_HASH = '0xDEADBEEFDEADBEEFDEADBEEFDEADBEEFDEADBEEFDEADBEEFDEADBEEFDEADBEEF';
const DEFAULT_TOKEN = '0xc2132D05D31c914a87C6611C10748AEb04B58e8F';
const DEFAULT_INTEGRATOR = '0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE';
const DEFAULT_INTEGRATOR_FEE = '1000000';
const DEFAULT_LIFI_FEE = '200000';

export const buildEvent = (overrides: BuildEventInput = {}): ethers.Event => {
  // args can be explicitly undefined for the missing-args test
  // do not replace that with default args
  const args =
    'args' in overrides
      ? overrides.args
      : (Object.assign([], {
          _token: overrides.token ?? DEFAULT_TOKEN,
          _integrator: overrides.integrator ?? DEFAULT_INTEGRATOR,
          _integratorFee: ethers.BigNumber.from(overrides.integratorFee ?? DEFAULT_INTEGRATOR_FEE),
          _lifiFee: ethers.BigNumber.from(overrides.lifiFee ?? DEFAULT_LIFI_FEE),
        }) as unknown as ethers.utils.Result);

  return {
    transactionHash: overrides.txHash ?? DEFAULT_TX_HASH,
    logIndex: overrides.logIndex ?? 7,
    blockNumber: overrides.blockNumber ?? 78_600_500,
    blockHash: overrides.blockHash ?? DEFAULT_BLOCK_HASH,
    args,
  } as unknown as ethers.Event;
};
