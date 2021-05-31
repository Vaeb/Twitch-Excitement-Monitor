import axios from 'axios';

import { authData, channelNames } from './twitchSetup';
import { commands } from './commandSetup';
import { log, formatTime, getDateString, hiddenSpace } from './utils';

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
    hypeActivities: number[];
    hypeStart: number;
}

const windowSeconds = 10; // 30 | Larger = Scenario | Smaller = Moment/Event
const waitForDataSeconds = 90; // 1 day
const hypePercent = 0.9; // 0.9
const intervalFreq = 1000 * 2; // 2
const windowMs = 1000 * windowSeconds;
const waitForDataWindow = 1000 * waitForDataSeconds;

const maxChannelNameLen = channelNames.reduce((acc, channelName) => Math.max(acc, channelName.length), 0);

const formatDecimal = (num: number | null, fractionDigits = 2, maxLength = 5) => num?.toFixed(fractionDigits).padStart(maxLength, '0');

export default class Channel {
    channelName: string;

    channelNumber: number;

    channelNamePadded: string;

    // private lastMessageLower = '';

    private startTick = Infinity;

    recentMessages: RecentMessage[] = [];

    activityData: Activity = {
        n: 0, min: Infinity, avg: 0, peak: 0, sortedActivities: [], hypeActivities: [], hypeStart: 0,
    };

    hypeActive = false;

    constructor(channelName: string, channelNumber: number) {
        this.channelName = channelName;
        this.channelNumber = channelNumber;
        this.channelNamePadded = channelName.padEnd(maxChannelNameLen, ' ');
        this.monitorHype();
    }

    public onNewMessage(channelIrc: string, user: string, message: string): void {
        const messageLower = message.toLowerCase().trim();

        // this.lastMessageLower = messageLower;
        this.recentMessages.push({ timestamp: +new Date(), message: messageLower });

        if (this.startTick === Infinity) this.startTick = +new Date();

        if (!['vaeben', 'morlega'].includes(user)) return;

        const [messageCmd, ...messageArgs] = message.trim().split(/\s+/g);

        const command = commands.find(({ cmds }) => cmds[messageCmd]);

        if (!command) return;

        log(user, 'sent command', `'${command.name}'`, 'in', `'${channelIrc}'`, ...(messageArgs.length ? ['with args', messageArgs] : []), `('${message}')`);

        command.func({
            channelName: this.channelName,
            user,
            rawMessage: message,
            cmdArgs: messageArgs,
        });
    }

    private monitorHype() {
        let canStart = false;
        let canCheckHypeData = false;
        setInterval(() => {
            if (canStart === false) canStart = +new Date() - this.startTick >= windowMs;
            const {
                n, avg, sortedActivities, hypeActivities, hypeStart,
            } = this.activityData;
            let activityNum = 0;
            let recentMessagesNow = [];
            let hypeThreshold = null;

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

                if (activityNum > 0 && canStart) {
                    const newN = n + 1;
                    this.activityData.n = newN;
                    this.activityData.avg = avg * (n / newN) + activityNum / newN;
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

                    if (canCheckHypeData === false) {
                        canCheckHypeData = +new Date() - this.startTick > waitForDataWindow;
                        if (canCheckHypeData === true) {
                            log(`Channel${this.channelNumber}:`, this.channelNamePadded, '| Now checking for hype!');
                        }
                    }
                    if (canCheckHypeData) {
                        const hypeActivityIdx = Math.ceil((sortedActivities.length - 1) * hypePercent);
                        hypeThreshold = sortedActivities[hypeActivityIdx];
                        const isHype = activityNum >= hypeThreshold;
                        if (!this.hypeActive && isHype) {
                            this.hypeActive = true;
                            this.activityData.hypeStart = +new Date();
                            const outStrFields = [
                                `Hype Detected-${this.channelNamePadded}   `,
                                `Time: ${getDateString(new Date(cutoffStamp))}`,
                                `Current hype threshold: ${formatDecimal(hypeThreshold)})!`,
                            ];
                            const outStr = outStrFields.join(' | ');
                            log(outStr);
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
                }
            }

            if (activityNum > 0) {
                log(
                    `Channel${this.channelNumber}:`, this.channelNamePadded,
                    `| n${this.channelNumber}:`, String(this.activityData.n).padStart(9, '0'),
                    `| Activity${this.channelNumber}:`, formatDecimal(activityNum),
                    `| Hype${this.channelNumber}:`, this.hypeActive,
                    `| Hype-Threshold${this.channelNumber}:`, formatDecimal(hypeThreshold),
                    `| Min${this.channelNumber}:`, formatDecimal(this.activityData.min),
                    `| Avg${this.channelNumber}:`, formatDecimal(this.activityData.avg),
                    `| Peak${this.channelNumber}:`, formatDecimal(this.activityData.peak)
                );
            }
        }, intervalFreq);
    }
}

export { channelNames } from './twitchSetup';

export type ChannelName = (typeof channelNames)[number];

export const channels = {} as { [key in ChannelName]: Channel };

for (let i = 0; i < channelNames.length; i++) {
    const channelName = channelNames[i];
    const channel = new Channel(channelName, i + 1);
    channels[channelName] = channel;
}
