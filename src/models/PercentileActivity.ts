import mongoose from 'mongoose';

const { Schema, model } = mongoose;

const PercentileActivitySchema = new Schema({
    channelName: { type: String, required: true },
    percentile: { type: Number, required: true },
    activity: { type: Number, required: true },
    n: { type: Number, required: true },
});

export interface IPercentileActivity {
    channelName: string;
    percentile: number;
    activity: number;
    n: number;
}

export const PercentileActivity = model<IPercentileActivity>('PercentileActivity', PercentileActivitySchema);
