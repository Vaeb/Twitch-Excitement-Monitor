import axios from 'axios';
import type { HelixStream, HelixUser } from 'twitch';
import type { EventSubSubscription } from 'twitch-eventsub';

import { authData, channelNames, listener } from './twitchSetup';
import { ActivityMixed, IActivityMixedDoc } from './models';
import {
    log, formatElapsed, getDateString, hiddenSpace, isChannelLive, getChannel, isRoot, formatTime, getLatestVod, getNumPosition,
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
    hypeActivities: { activityNum: number; activityNumRaw: number }[];
    hypeStart: number;
}

const monitorAfterUptime = 1000 * 60 * 60;
const statusChangeRealAfter = 1000 * 60 * 60;
const windowSeconds = 60; // 30 | Larger = Scenario | Smaller = Moment/Event
const hypePercentile = 0.95; // 0.9
const watchStreamDataInterval = 1000 * 60;
const monitorInterval = 1000 * 1; // 1
const windowMs = 1000 * windowSeconds;
const storeWithDataSize = 1000; // 10000

const maxChannelNameLen = channelNames
    .filter(channelName => !isRoot(channelName))
    .reduce((acc, channelName) => Math.max(acc, channelName.length), 0);

const formatDecimal = (num: number | null, maxLength = 5, separator = ' ', fractionDigits = 2) => {
    if (num == null || num === Infinity || num === -Infinity) return 'N/A'.padStart(maxLength, ' ');

    return num.toFixed(fractionDigits)?.padStart(maxLength, separator);
};

const formatInt = (num: number | null, maxLength = 3, separator = ' ', mult = 1) => {
    if (num == null || num === Infinity || num === -Infinity) return 'N/A'.padStart(maxLength, ' ');

    return String(Math.round(num * mult)).padStart(maxLength, separator);
};

const rollingAverage = (oldAvg: number, newN: number, newValue: number) => oldAvg * ((newN - 1) / newN) + newValue / newN;

const lerp = (a: number, b: number, f: number) => a + f * (b - a);

export default class Channel {
    static numChannels = 0;

    channelName: string;

    channelNumber: number;

    channelNamePadded: string;

    helixChannel: HelixUser;

    helixStream: HelixStream | null;

    channelId: string;

    streamLive = false;

    liveStatusChangedStamp = 0;

    // private lastMessageLower = '';

    private startTick = Infinity;

    recentMessages: RecentMessage[] = [];

    activityValues: IActivityMixedDoc[] = [];

    activityData: Activity = {
        n: 0,
        min: Infinity,
        avg: -Infinity,
        peak: -Infinity,
        sortedActivities: [],
        updates: 0,
        hypeActivities: [],
        hypeStart: 0,
    };

    hypeActive = false;

    hypeThreshold: number | null = null;

    canStore = false;

    constructor(
        channelName: string,
        channelNumber: number,
        helixChannel: HelixUser,
        helixStream: HelixStream | null,
        streamLive: boolean,
        liveStamp: number
    ) {
        this.channelName = channelName;
        this.channelNumber = channelNumber;
        this.channelNamePadded = channelName.padStart(maxChannelNameLen, ' ');
        this.helixChannel = helixChannel;
        this.helixStream = helixStream;
        this.channelId = helixChannel.id;
        this.streamLive = streamLive;
        this.liveStatusChangedStamp = liveStamp;
        if (!isRoot(this.channelName)) {
            this.watchStreamData();
            this.monitorHype();
        }
        log('Setup channel:', this.channelName);
    }

    public static async createAsync(channelName: string): Promise<Channel | null> {
        const channelNumber = ++Channel.numChannels;

        const helixChannel = await getChannel(channelName);
        const streamLive = !!(await isChannelLive(channelName));

        if (helixChannel === null) return null;

        const helixStream = await helixChannel.getStream();

        let liveStamp = 0;
        if (helixStream) {
            liveStamp = +helixStream.startDate;
        }

        const channel = new Channel(channelName, channelNumber, helixChannel, helixStream, streamLive, liveStamp);
        await channel.makeLiveListeners();

        return channel;
    }

    public async updateHelixChannel(): Promise<HelixUser | null> {
        const helixChannel = await getChannel(this.channelId, 'id');
        if (helixChannel === null) return null;
        this.helixChannel = helixChannel;
        return helixChannel;
    }

    public async resetMonitorData(): Promise<void> {
        this.helixChannel
            .getStream()
            .then((helixStream) => {
                this.helixStream = helixStream;
            })
            .catch((err) => {
                log('Error fetching helixStream in resetMonitorData:');
                console.error(err);
            });
        this.hypeActive = false;
        this.activityData.hypeActivities = [];
        this.activityData.hypeStart = 0;
        this.activityData.sortedActivities = [];
        this.recentMessages = [];
        this.startTick = Infinity;
        this.canStore = false;
    }

    private liveStatusChanged() {
        const nowStamp = +new Date();
        if (nowStamp - this.liveStatusChangedStamp > statusChangeRealAfter) {
            this.liveStatusChangedStamp = nowStamp;
            log('Updated liveStatusChangedStamp');
        }
    }

    private async makeLiveListeners(): Promise<{
        onlineSubscription: EventSubSubscription<any>;
        offlineSubscription: EventSubSubscription<any>;
    }> {
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

    private watchStreamData() {
        setInterval(() => {
            this.helixChannel
                .getStream()
                .then((helixStream) => {
                    const oldHelixStream = this.helixStream;
                    this.helixStream = helixStream;
                    if (oldHelixStream !== null && this.helixStream === null) {
                        log('>>> helixStream is now null!');
                        this.resetMonitorData();
                    }
                })
                .catch((err) => {
                    log('Error fetching helixStream:');
                    console.error(err);
                });
        }, watchStreamDataInterval);
    }

    private addSortedActivity(activityNum: number) {
        const { n, sortedActivities } = this.activityData;
        let { avg } = this.activityData;

        if (avg === -Infinity) avg = 0;

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

        // return insertAt / (numActivities || 1);
    }

    private getHypeAtX(x: number, sortedActivities = this.activityData.sortedActivities) {
        // if (sortedActivities.length === 0) return null;

        const decimalIdx = (sortedActivities.length - 1) * x;
        const smallerHypeIdx = Math.floor(decimalIdx);
        const largerHypeIdx = Math.ceil(decimalIdx);

        const smallerHype = sortedActivities[smallerHypeIdx];
        const largerHype = sortedActivities[largerHypeIdx];

        if (smallerHype === largerHype) return smallerHype;

        return lerp(smallerHype, largerHype, decimalIdx - smallerHypeIdx);
    }

    public async checkHype(hypeThreshold: number, activityNum: number, activityNumRaw: number, cutoffStamp: number): Promise<void> {
        const { hypeActivities, hypeStart } = this.activityData;

        const isHype = activityNum >= hypeThreshold;
        if (!this.hypeActive && isHype) {
            this.hypeActive = true;
            const hypeStartNew = new Date(cutoffStamp);
            this.activityData.hypeStart = +hypeStartNew;

            const vod = await getLatestVod(this.channelId);
            let vodStampUrl = null;

            if (vod) {
                const vodTimestamp = formatTime(new Date((+hypeStartNew - 1000 * 16) - +(this.helixStream as HelixStream).startDate), true);
                vodStampUrl = `${vod.url}?t=${vodTimestamp}`;
            }

            const outStrFields = [
                `Hype Detected-${this.channelNamePadded}   `,
                `Time: ${getDateString(hypeStartNew)}`,
                `Current hype threshold: ${formatDecimal(hypeThreshold)}!`,
            ];
            const outStr = outStrFields.join(' | ');
            log(`${hiddenSpace}\n${outStr}`);
            axios
                .post(authData.webhook, {
                    content: `<@107593015014486016>\n\`\`\`${outStr}\`\`\` ${vodStampUrl ? `URL: ${vodStampUrl}` : ''}`,
                })
                .catch(err => log(err));
        } else if (this.hypeActive && !isHype) {
            this.hypeActive = false;
            this.activityData.hypeActivities = [];
            this.activityData.hypeStart = 0;
            let minHype = Infinity;
            let maxHype = -1;
            const avgHypeData = hypeActivities.reduce(
                (acc, hype) => {
                    if (hype.activityNum < minHype) minHype = hype.activityNum;
                    if (hype.activityNum > maxHype) maxHype = hype.activityNum;
                    acc.hype += hype.activityNum;
                    acc.hypeRaw += hype.activityNumRaw;
                    return acc;
                },
                { hype: 0, hypeRaw: 0 }
            );
            const avgHype = avgHypeData.hype / hypeActivities.length;
            const avgHypeRaw = avgHypeData.hypeRaw / hypeActivities.length;
            const elapsedTimeStr = formatElapsed(+new Date() - hypeStart);
            const outStrFields = [
                `......Hype Ended-${this.channelNamePadded}`,
                `Lasted: ${elapsedTimeStr}`,
                `Min-Hype: ${formatDecimal(minHype)}`,
                `Avg-Hype: ${formatDecimal(avgHype)}`,
                `Avg-Hype-Raw: ${formatDecimal(avgHypeRaw)}`,
                `Max-Hype: ${formatDecimal(maxHype)}`,
            ];
            const outStr = outStrFields.join(' | ');
            log(`${hiddenSpace}\n${outStr}`);
            axios
                .post(authData.webhook, {
                    content: `\`\`\`${outStr}\`\`\``,
                })
                .catch(err => log(err));
        }

        if (this.hypeActive) {
            hypeActivities.push({ activityNum, activityNumRaw });
        }
    }

    public async fetchHypeThreshold(): Promise<{
        hypePercentile: number;
        hypeThreshold: number;
        activityDocs: IActivityMixedDoc[];
    } | null> {
        const activityDocs = await ActivityMixed.find({ channelName: this.channelName }).sort({ percentile: 1 });
        const hypeDoc = activityDocs.find(activityDoc => activityDoc.percentile == hypePercentile);

        if (hypeDoc) {
            this.hypeThreshold = hypeDoc.activity;
            log(`[${this.channelName}] Hype threshold for ${hypePercentile} found:`, this.hypeThreshold);
            return { hypePercentile, hypeThreshold: this.hypeThreshold, activityDocs };
        }

        this.hypeThreshold = null;
        log(`[${this.channelName}] No hype threshold stored for percentile ${hypePercentile}`);
        return null;
    }

    public async saveHypeData(): Promise<void> {
        log('>>> Storing hype data...');

        if (this.activityData.sortedActivities.length < 1000) return;

        const sortedActivities = [...this.activityData.sortedActivities];

        this.streamLive = !!(await isChannelLive(this.channelName));

        if (this.streamLive === false) {
            this.resetMonitorData();
            return;
        }

        const keyPercents: number[] = [];
        for (let x = 0; x < 8; x++) keyPercents.push(x / 1e1);
        for (let x = 80; x < 99; x++) keyPercents.push(x / 1e2);
        for (let x = 990; x < 999; x++) keyPercents.push(x / 1e3);
        for (let x = 9990; x <= 9999; x++) keyPercents.push(x / 1e4);
        keyPercents.push(1);

        for (const x of keyPercents) {
            const activityThreshold = this.getHypeAtX(x, sortedActivities);
            log(this.channelName, x, activityThreshold); // do moving mean

            const activityMixedOld = await ActivityMixed.findOne({ channelName: this.channelName, percentile: x });

            if (activityMixedOld) {
                const nOld = activityMixedOld.n;
                const activityOld = activityMixedOld.activity;
                const nNew = nOld + 1;
                const activityNew = rollingAverage(activityMixedOld.activity, nNew, activityThreshold);
                activityMixedOld.n = nNew;
                activityMixedOld.activity = activityNew;
                activityMixedOld
                    .save()
                    .then(() => {
                        log('Updated:', {
                            channelName: this.channelName,
                            percentile: x,
                            nOld,
                            nNew,
                            activityOld,
                            activityThreshold,
                            activityNew,
                        });
                    })
                    .catch((err) => {
                        log('Updating ActivityMixed errored:');
                        console.error(err);
                    });
            } else {
                ActivityMixed.create({ channelName: this.channelName, percentile: x, activity: activityThreshold, n: 1 })
                    .then(() => {
                        log('Created:', { channelName: this.channelName, percentile: x, activity: activityThreshold, n: 1 });
                    })
                    .catch((err) => {
                        log('Creating ActivityMixed errored:');
                        console.error(err);
                    });
            }
        }

        this.activityData.sortedActivities = [];
        this.activityData.updates++;
        this.fetchHypeThreshold().then((result) => {
            if (result == null) return;
            this.activityValues = result.activityDocs;
        });
    }

    private async monitorHype() {
        const thresholdData = await this.fetchHypeThreshold();
        if (thresholdData) this.activityValues = thresholdData.activityDocs;

        setInterval(() => {
            if (this.streamLive === false || this.helixStream === null || this.helixStream.viewers === 0) return;

            const nowStamp = +new Date();
            const numViewers = this.helixStream.viewers;

            if (this.canStore === false) this.canStore = nowStamp - this.startTick >= windowMs && nowStamp - this.liveStatusChangedStamp >= monitorAfterUptime;

            let activityNum = 0;
            let activityNumRaw = 0;
            let nowHypeX = -Infinity;
            let recentMessagesNow = [];
            const { hypeThreshold, activityValues } = this;

            if (this.recentMessages.length > 0) {
                // const messagePointerNow = ++messagePointer;
                const numMessages = this.recentMessages.length;
                const cutoffStamp = nowStamp - windowMs;

                let firstMessageIdx = numMessages;
                for (let i = 0; i < numMessages; i++) {
                    if (this.recentMessages[i].timestamp >= cutoffStamp) {
                        // Include if message is on cutoff time
                        firstMessageIdx = i;
                        break;
                    }
                }

                this.recentMessages = this.recentMessages.slice(firstMessageIdx);
                recentMessagesNow = this.recentMessages;
                activityNum = (recentMessagesNow.length * 1e5) / (windowSeconds * numViewers);
                activityNumRaw = recentMessagesNow.length / windowSeconds;

                let higherIndex = activityValues.length;
                for (let i = 0; i < activityValues.length; i++) {
                    if (activityNum <= activityValues[i].activity) {
                        higherIndex = i;
                        break;
                    }
                }

                if (higherIndex === 0) {
                    nowHypeX = 0;
                } else if (higherIndex === activityValues.length) {
                    nowHypeX = 1;
                } else {
                    const lowerActivity = activityValues[higherIndex - 1];
                    const higherActivity = activityValues[higherIndex];
                    nowHypeX = lerp(lowerActivity.percentile, higherActivity.percentile, getNumPosition(activityNum, lowerActivity.activity, higherActivity.activity));
                }

                if (activityNum > 0) {
                    if (this.canStore) {
                        this.addSortedActivity(activityNum);

                        if (this.activityData.sortedActivities.length === storeWithDataSize) {
                            // addSortedActivity sole usage must be in scope
                            this.saveHypeData();
                        }
                    }

                    if (hypeThreshold != null) {
                        this.checkHype(hypeThreshold, activityNum, activityNumRaw, cutoffStamp);
                    }
                }
            }

            if (activityNum > 0) {
                const outStr = [
                    `Channel${this.channelNumber}: ${this.channelNamePadded}`,
                    `| Viewers${this.channelNumber}: ${String(numViewers).padStart(6, ' ')}`,
                    `| SortedArr${this.channelNumber}: ${String(this.activityData.sortedActivities.length).padStart(4, ' ')}`,
                    `| Updates${this.channelNumber}: ${String(this.activityData.updates).padStart(4, ' ')}`,
                    `| Hype${this.channelNumber}: ${String(this.hypeActive).padStart(5, ' ')}`,
                    `| Act-Raw${this.channelNumber}: ${formatDecimal(activityNumRaw)}`,
                    `| Act${this.channelNumber}: ${formatDecimal(activityNum, 6)}`,
                    `| Hype-Threshold${this.channelNumber}: ${formatDecimal(hypeThreshold)}`,
                    `| H-T-Curr${this.channelNumber}: ${formatDecimal(
                        this.getHypeAtX(hypePercentile, this.activityData.sortedActivities)
                    )}`,
                    `| X${this.channelNumber}: ${`${formatInt(nowHypeX, 3, ' ', 100)}%`}`,
                    `| Avg${this.channelNumber}: ${formatDecimal(this.activityData.avg)}`,
                    `| Peak${this.channelNumber}: ${formatDecimal(this.activityData.peak)}`,
                ].join(' ');
                log(`${outStr}\n${'-'.repeat(Math.floor(outStr.length * 1.12))}`);
            }
        }, monitorInterval);
    }
}

export { channelNames } from './twitchSetup';

export type ChannelName = typeof channelNames[number];

export const channels = {} as { [key in ChannelName]: Channel };

for (const channelName of channelNames) {
    const channel = await Channel.createAsync(channelName);
    if (channel !== null) {
        channels[channelName] = channel;
    }
}
