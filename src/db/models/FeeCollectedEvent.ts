import { getModelForClass, index, modelOptions, prop } from '@typegoose/typegoose';

@modelOptions({
  schemaOptions: { collection: 'fee_collected_events', timestamps: true },
})
@index({ chainId: 1, txHash: 1, logIndex: 1 }, { unique: true })
// Filtered queries (chainId / contractAddress / token) reuse this index
@index({ integrator: 1, blockNumber: -1, logIndex: -1 })
export class FeeCollectedEvent {
  @prop({ required: true })
  public chainId!: number;

  @prop({ required: true })
  public txHash!: string;

  @prop({ required: true })
  public logIndex!: number;

  @prop({ required: true })
  public blockNumber!: number;

  @prop({ required: true })
  public blockHash!: string;

  @prop({ required: true })
  public contractAddress!: string;

  @prop({ required: true })
  public token!: string;

  @prop({ required: true })
  public integrator!: string;

  @prop({ required: true })
  public integratorFee!: string;

  @prop({ required: true })
  public lifiFee!: string;
}

export const FeeCollectedEventModel = getModelForClass(FeeCollectedEvent);
