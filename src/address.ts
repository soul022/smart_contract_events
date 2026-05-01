import { ethers } from 'ethers';

export const normalizeAddress = (input: string): string => {
  return ethers.utils.getAddress(input).toLowerCase();
};

export const tryNormalizeAddress = (input: string): string | null => {
  try {
    return normalizeAddress(input);
  } catch {
    return null;
  }
};
