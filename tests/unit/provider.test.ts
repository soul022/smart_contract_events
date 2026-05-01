import { ethers } from 'ethers';
import { CHAINS } from '../../src/chains';
import {
  buildContract,
  buildProvider,
  getCurrentBlock,
  probeRpc,
  verifyContractCode,
} from '../../src/chain/provider';

describe('chain provider helpers', () => {
  it('builds JsonRpcProvider with the chain RPC timeout', () => {
    const polygon = CHAINS.find((c) => c.name === 'polygon')!;
    const provider = buildProvider(polygon);
    const connection = provider.connection as { url?: string; timeout?: number };
    expect(connection.url).toBe(process.env.POLYGON_RPC_URL);
    expect(connection.timeout).toBe(polygon.rpcTimeoutMs);
  });

  it('builds a contract at the configured chain address', () => {
    const polygon = CHAINS.find((c) => c.name === 'polygon')!;
    const provider = new ethers.providers.JsonRpcProvider();
    const contract = buildContract(polygon, provider);
    expect(contract.address.toLowerCase()).toBe(polygon.contractAddress);
  });

  it('delegates current block lookup to the provider', async () => {
    const provider = {
      getBlockNumber: jest.fn().mockResolvedValue(123),
    } as unknown as ethers.providers.Provider;
    await expect(getCurrentBlock(provider)).resolves.toBe(123);
  });

  it('probeRpc returns the current block on success', async () => {
    const polygon = CHAINS.find((c) => c.name === 'polygon')!;
    const provider = {
      getBlockNumber: jest.fn().mockResolvedValue(456),
    } as unknown as ethers.providers.Provider;
    await expect(probeRpc(provider, polygon)).resolves.toBe(456);
  });

  it('probeRpc rethrows when the provider call fails', async () => {
    const polygon = CHAINS.find((c) => c.name === 'polygon')!;
    const provider = {
      getBlockNumber: jest.fn().mockRejectedValue(new Error('econnrefused')),
    } as unknown as ethers.providers.Provider;
    await expect(probeRpc(provider, polygon)).rejects.toThrow(/econnrefused/);
  });

  it('verifyContractCode passes when bytecode exists at the configured contract', async () => {
    const polygon = CHAINS.find((c) => c.name === 'polygon')!;
    const provider = {
      getCode: jest.fn().mockResolvedValue('0x60806040'),
    } as unknown as ethers.providers.Provider;
    await expect(verifyContractCode(provider, polygon)).resolves.toBeUndefined();
    expect(provider.getCode).toHaveBeenCalledWith(polygon.contractAddress);
  });

  it('verifyContractCode rejects when no bytecode exists at the configured contract', async () => {
    const polygon = CHAINS.find((c) => c.name === 'polygon')!;
    const provider = {
      getCode: jest.fn().mockResolvedValue('0x'),
    } as unknown as ethers.providers.Provider;
    await expect(verifyContractCode(provider, polygon)).rejects.toThrow(/No contract bytecode/);
  });
});
