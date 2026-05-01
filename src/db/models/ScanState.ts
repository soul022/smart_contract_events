import { getModelForClass, index, modelOptions, prop } from '@typegoose/typegoose';

@modelOptions({
  schemaOptions: { collection: 'scan_state', timestamps: true },
})
@index({ chainId: 1, contractAddress: 1 }, { unique: true })
export class ScanState {
  @prop({ required: true })
  public chainId!: number;

  @prop({ required: true })
  public contractAddress!: string;

  @prop({ required: true })
  public lastScannedBlock!: number;

  // bumped on every successful run so idle chains still look fresh in /health
  @prop()
  public lastRunAt?: Date;
}

export const ScanStateModel = getModelForClass(ScanState);
