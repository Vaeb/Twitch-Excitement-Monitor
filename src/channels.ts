import axios from 'axios';
import { HelixUser } from 'twitch';
import type { EventSubSubscription } from 'twitch-eventsub';

import { authData, channelNames, listener } from './twitchSetup';
import { PercentileActivity } from './models';
import {
    log, formatTime, getDateString, hiddenSpace, isChannelLive, getChannel, isRoot,
} from './utils';

interface RecentMessage {
    timestamp: number;
    message: string;
}

interface Activity {
    n: number;
    min: number;
    avg: number;
    peak: number;
    sortedActivities: number[];
    updates: number;
    hypeActivities: number[];
    hypeStart: number;
}

const saveAfterUptime = 1000 * 60 * 60;
const statusChangeRealAfter = 1000 * 60 * 60;
const windowSeconds = 60; // 30 | Larger = Scenario | Smaller = Moment/Event
const hypePercent = 0.95; // 0.9
const intervalFreq = 1000 * 1; // 1
const windowMs = 1000 * windowSeconds;
const storeWithDataSize = 1000; // 10000

const maxChannelNameLen = channelNames.reduce((acc, channelName) => Math.max(acc, channelName.length), 0);

const formatDecimal = (num: number | null, fractionDigits = 2, maxLength = 5) => num?.toFixed(fractionDigits)?.padStart(maxLength, '0');

const rollingAverage = (oldAvg: number, newN: number, newValue: number) => oldAvg * ((newN - 1) / newN) + newValue / newN;

const lerp = (a: number, b: number, f: number) => a + f * (b - a);

export default class Channel {
    static numChannels = 0;

    channelName: string;

    channelNumber: number;

    channelNamePadded: string;

    helixChannel: HelixUser;

    channelId: string;

    streamLive = true;

    liveStatusChangedStamp = 0;

    // private lastMessageLower = '';

    private startTick = Infinity;

    recentMessages: RecentMessage[] = [];

    activityData: Activity = {
        n: 0, min: Infinity, avg: 0, peak: 0, sortedActivities: [], updates: 0, hypeActivities: [], hypeStart: 0,
    };

    hypeActive = false;

    hypeThreshold: number | null = null;

    canStore = false;

    canSave = false;

    constructor(channelName: string, channelNumber: number, helixChannel: HelixUser, streamLive: boolean) {
        this.channelName = channelName;
        this.channelNumber = channelNumber;
        this.channelNamePadded = channelName.padEnd(maxChannelNameLen, ' ');
        this.helixChannel = helixChannel;
        this.channelId = helixChannel.id;
        this.streamLive = streamLive;
        if (!isRoot(this.channelName)) this.monitorHype();
        log('Setup channel:', this.channelName);
    }

    public static async createAsync(channelName: string): Promise<Channel | null> {
        const channelNumber = ++Channel.numChannels;

        const helixChannel = await getChannel(channelName);
        const streamLive = !!(await isChannelLive(channelName));

        if (helixChannel === null) return null;

        const channel = new Channel(channelName, channelNumber, helixChannel, streamLive);
        await channel.makeLiveListeners();

        return channel;
    }

    public async updateHelixChannel(): Promise<HelixUser | null> {
        const helixChannel = await getChannel(this.channelId, 'id');
        if (helixChannel === null) return null;
        this.helixChannel = helixChannel;
        return helixChannel;
    }

    public resetMonitorData(): void {
        this.hypeActive = false;
        this.activityData.hypeActivities = [];
        this.activityData.hypeStart = 0;
        this.activityData.sortedActivities = [];
        this.recentMessages = [];
        this.startTick = Infinity;
        this.canSave = false;
        this.canStore = false;
    }

    private liveStatusChanged() {
        const nowStamp = +new Date();
        if (nowStamp - this.liveStatusChangedStamp > statusChangeRealAfter) {
            this.liveStatusChangedStamp = nowStamp;
            log('Updated liveStatusChangedStamp');
        }
    }

    private async makeLiveListeners(): Promise<{ onlineSubscription: EventSubSubscription<any>, offlineSubscription: EventSubSubscription<any> }> {
        const onlineSubscription = await listener.subscribeToStreamOnlineEvents(this.channelId, (e) => {
            log(`${e.broadcasterDisplayName} just went live!`);
            this.resetMonitorData();
            this.liveStatusChanged();
            this.streamLive = true;
        });

        const offlineSubscription = await listener.subscribeToStreamOfflineEvents(this.channelId, (e) => {
            log(`${e.broadcasterDisplayName} just went offline`);
            this.streamLive = false;
            this.liveStatusChanged();
            this.resetMonitorData();
        });

        log('Setup live listeners!');

        return { onlineSubscription, offlineSubscription };
    }

    public onNewMessage(channelIrc: string, user: string, message: string): void {
        if (this.streamLive === false) return;

        const messageLower = message.toLowerCase().trim();

        // this.lastMessageLower = messageLower;
        this.recentMessages.push({ timestamp: +new Date(), message: messageLower });

        if (this.startTick === Infinity) this.startTick = +new Date();
    }

    private addSortedActivity(activityNum: number) {
        const { n, avg, sortedActivities } = this.activityData;

        const newN = n + 1;
        this.activityData.n = newN;
        this.activityData.avg = rollingAverage(avg, newN, activityNum);
        if (activityNum > this.activityData.peak) this.activityData.peak = activityNum;
        if (activityNum < this.activityData.min) this.activityData.min = activityNum;

        const numActivities = sortedActivities.length;
        const sortedMiddleIdx = Math.floor(numActivities / 2);
        let insertAt = -1;
        if (activityNum > sortedActivities[sortedMiddleIdx]) {
            for (let i = sortedMiddleIdx; i < numActivities; i++) {
                if (activityNum <= sortedActivities[i]) {
                    insertAt = i;
                    break;
                }
            }
            if (insertAt === -1) insertAt = numActivities;
        } else {
            for (let i = Math.min(sortedMiddleIdx + 1, numActivities - 1); i >= 0; i--) {
                if (activityNum >= sortedActivities[i]) {
                    insertAt = i + 1;
                    break;
                }
            }
            if (insertAt === -1) insertAt = 0;
        }
        // log('insertAt', insertAt);
        sortedActivities.splice(insertAt, 0, activityNum);
    }

    private getHypeAtX(x: number, sortedActivities = this.activityData.sortedActivities) {
        const decimalIdx = (sortedActivities.length - 1) * x;
        const smallerHypeIdx = Math.floor(decimalIdx);
        const largerHypeIdx = Math.ceil(decimalIdx);

        const smallerHype = sortedActivities[smallerHypeIdx];
        const largerHype = sortedActivities[largerHypeIdx];

        if (smallerHype === largerHype) return smallerHype;

        return lerp(smallerHype, largerHype, decimalIdx - smallerHypeIdx);
    }

    private checkHype(hypeThreshold: number, activityNum: number, cutoffStamp: number) {
        const { hypeActivities, hypeStart } = this.activityData;

        const isHype = activityNum >= hypeThreshold;
        if (!this.hypeActive && isHype) {
            this.hypeActive = true;
            const hypeStartNew = new Date(cutoffStamp);
            this.activityData.hypeStart = +hypeStartNew;
            const outStrFields = [
                `Hype Detected-${this.channelNamePadded}   `,
                `Time: ${getDateString(hypeStartNew)}`,
                `Current hype threshold: ${formatDecimal(hypeThreshold)}!`,
            ];
            const outStr = outStrFields.join(' | ');
            log(`${hiddenSpace}\n${outStr}`);
            axios.post(authData.webhook, {
                content: `<@107593015014486016>\n\`\`\`${outStr}\`\`\``,
            }).catch(err => log(err));
        } else if (this.hypeActive && !isHype) {
            this.hypeActive = false;
            this.activityData.hypeActivities = [];
            this.activityData.hypeStart = 0;
            let minHype = Infinity;
            let maxHype = -1;
            const avgHype = hypeActivities.reduce((acc, hype) => {
                if (hype < minHype) minHype = hype;
                if (hype > maxHype) maxHype = hype;
                return acc + hype;
            }, 0) / hypeActivities.length;
            const elapsedTimeStr = formatTime(+new Date() - hypeStart);
            const outStrFields = [
                `......Hype Ended-${this.channelNamePadded}`,
                `Lasted: ${elapsedTimeStr}`,
                `Min-Hype: ${formatDecimal(minHype)}`,
                `Avg-Hype: ${formatDecimal(avgHype)}`,
                `Max-Hype: ${formatDecimal(maxHype)}`,
            ];
            const outStr = outStrFields.join(' | ');
            log(`${hiddenSpace}\n${outStr}`);
            axios.post(authData.webhook, {
                content: `<@107593015014486016>\n\`\`\`${outStr}\`\`\``,
            }).catch(err => log(err));
        }

        if (this.hypeActive) {
            hypeActivities.push(activityNum);
        }
    }

    public async fetchHypeThreshold(): Promise<number | null> {
        const hypeThresholdDoc = await PercentileActivity.findOne({ percentile: hypePercent });

        if (hypeThresholdDoc) {
            this.hypeThreshold = hypeThresholdDoc.activity;
            log(`Hype threshold for ${hypePercent} found:`, this.hypeThreshold);
            return this.hypeThreshold;
        }

        this.hypeThreshold = null;
        log(`No hype threshold stored for percentile ${hypePercent}`);
        return null;
    }

    private async saveHypeData() {
        log('>>> Storing hype data...');

        const sortedActivities = [...this.activityData.sortedActivities];

        this.streamLive = !!(await isChannelLive(this.channelName));

        if (this.streamLive === false) return;

        const keyPercents: number[] = [];
        for (let x = 0; x < 8; x++) keyPercents.push(x / 1e1);
        for (let x = 80; x < 99; x++) keyPercents.push(x / 1e2);
        for (let x = 990; x < 999; x++) keyPercents.push(x / 1e3);
        for (let x = 9990; x <= 9999; x++) keyPercents.push(x / 1e4);
        keyPercents.push(1);

        for (const x of keyPercents) {
            const activityThreshold = this.getHypeAtX(x, sortedActivities);
            log(this.channelName, x, activityThreshold); // do moving mean

            const percentileActivityOld = await PercentileActivity.findOne({ percentile: x });

            if (percentileActivityOld) {
                const nOld = percentileActivityOld.n;
                const activityOld = percentileActivityOld.activity;
                const nNew = nOld + 1;
                const activityNew = rollingAverage(percentileActivityOld.activity, nNew, activityThreshold);
                percentileActivityOld.n = nNew;
                percentileActivityOld.activity = activityNew;
                percentileActivityOld.save()
                    .then(() => {
                        log('Updated:', {
                            channelName: this.channelName, percentile: x, nOld, nNew, activityOld, activityThreshold, activityNew,
                        });
                    })
                    .catch((err) => {
                        log('Updating PercentileActivity errored:');
                        console.error(err);
                    });
            } else {
                PercentileActivity.create({ channelName: this.channelName, percentile: x, activity: activityThreshold, n: 1 })
                    .then(() => {
                        log('Created:', { channelName: this.channelName, percentile: x, activity: activityThreshold, n: 1 });
                    })
                    .catch((err) => {
                        log('Creating PercentileActivity errored:');
                        console.error(err);
                    });
            }
        }

        this.activityData.sortedActivities = [];
        this.activityData.updates++;
        this.fetchHypeThreshold();
    }

    private async monitorHype() {
        await this.fetchHypeThreshold();

        setInterval(() => {
            if (this.streamLive === false) return;

            if (this.canStore === false) this.canStore = +new Date() - this.startTick >= windowMs;

            if (this.canSave === false) this.canSave = +new Date() - this.liveStatusChangedStamp >= saveAfterUptime;

            let activityNum = 0;
            let recentMessagesNow = [];
            const { hypeThreshold } = this;

            if (this.recentMessages.length > 0) {
                // const messagePointerNow = ++messagePointer;
                const numMessages = this.recentMessages.length;
                const cutoffStamp = +new Date() - windowMs;

                let firstMessageIdx = numMessages;
                for (let i = 0; i < numMessages; i++) {
                    if (this.recentMessages[i].timestamp >= cutoffStamp) { // Include if message is on cutoff time
                        firstMessageIdx = i;
                        break;
                    }
                }

                this.recentMessages = this.recentMessages.slice(firstMessageIdx);
                recentMessagesNow = this.recentMessages;
                activityNum = recentMessagesNow.length / windowSeconds;

                if (activityNum > 0 && this.canStore) {
                    this.addSortedActivity(activityNum);

                    if (this.activityData.sortedActivities.length === storeWithDataSize && this.canSave) {
                        this.saveHypeData();
                    }

                    if (hypeThreshold != null) {
                        this.checkHype(hypeThreshold, activityNum, cutoffStamp);
                    }
                }
            }

            if (activityNum > 0) {
                log(
                    `Channel${this.channelNumber}:`, this.channelNamePadded,
                    `| n${this.channelNumber}:`, String(this.activityData.n).padStart(9, '0'),
                    `| Hype${this.channelNumber}:`, this.hypeActive,
                    `| Activity${this.channelNumber}:`, formatDecimal(activityNum),
                    `| Hype-Threshold${this.channelNumber}:`, formatDecimal(hypeThreshold),
                    `| Min${this.channelNumber}:`, formatDecimal(this.activityData.min),
                    `| Avg${this.channelNumber}:`, formatDecimal(this.activityData.avg),
                    `| Peak${this.channelNumber}:`, formatDecimal(this.activityData.peak),
                    `| SortedArr${this.channelNumber}:`, String(this.activityData.sortedActivities.length).padStart(9, '0'),
                    `| Updates${this.channelNumber}:`, String(this.activityData.updates).padStart(6, '0')
                );
            }
        }, intervalFreq);
    }
}

export { channelNames } from './twitchSetup';

export type ChannelName = (typeof channelNames)[number];

export const channels = {} as { [key in ChannelName]: Channel };

for (const channelName of channelNames) {
    const channel = await Channel.createAsync(channelName);
    if (channel !== null) {
        channels[channelName] = channel;
    }
}
