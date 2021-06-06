import mongoose from 'mongoose';
import type { Document } from 'mongoose';

const { Schema, model } = mongoose;

const ActivityMixedSchema = new Schema({
    channelName: { type: String, required: true },
    percentile: { type: Number, required: true },
    activity: { type: Number, required: true },
    n: { type: Number, required: true },
});

export interface IActivityMixed {
    channelName: string;
    percentile: number;
    activity: number;
    n: number;
}

export type IActivityMixedDoc = IActivityMixed & Document<any, any>;

export const ActivityMixed = model<IActivityMixed>('ActivityMixed', ActivityMixedSchema, 'activitymixed');
