import { chatClient, channels } from '../twitchSetup';
import { commands } from '../commandSetup';
import { log } from '../utils';

log('| Setting up events...');

const windowSeconds = 30; // 30
const waitForDataSeconds = 90; // 1 day
const hypePercent = 0.8; // 0.9
const intervalFreq = 1000 * 2; // 2
const windowMs = 1000 * windowSeconds;
const waitForDataWindow = 1000 * waitForDataSeconds;
const recent: any = {};
const activity: { [key: string]: Activity } = {};
let hypeActive = false;
let startTick = Infinity;
let lastMessage = '';
// let messagePointer = 0;

interface Activity {
    n: number;
    min: number;
    avg: number;
    peak: number;
    sortedActivities: number[];
}

for (const channel of channels) {
    recent[channel] = [];
    activity[channel] = {
        n: 0, min: Infinity, avg: 0, peak: 0, sortedActivities: [],
    };
}

chatClient.onMessage((channelIrc, user, message) => {
    const messageLower = message.toLowerCase().trim();
    // const lastMessageNow = lastMessage;
    lastMessage = messageLower;
    const channel = channelIrc.substring(1);

    // if (messageLower !== lastMessageNow) {
    const recentMessages = recent[channel];
    recentMessages.push({ timestamp: +new Date(), message });
    // }

    if (startTick === Infinity) startTick = +new Date();

    if (!['vaeben', 'morlega'].includes(user)) return;

    const [messageCmd, ...messageArgs] = message.trim().split(/\s+/g);

    const command = commands.find(({ cmds }) => cmds[messageCmd]);

    if (!command) return;

    log(user, 'sent command', `'${command.name}'`, 'in', `'${channelIrc}'`, ...(messageArgs.length ? ['with args', messageArgs] : []), `('${message}')`);

    command.func({
        channel,
        user,
        rawMessage: message,
        cmdArgs: messageArgs,
    });
});

// Check for sub-mode + emote-mode + slow-mode + follower-x-mode

let canStart = false;
setInterval(() => {
    if (canStart === false) canStart = +new Date() - startTick >= windowMs;

    for (const channel of channels) {
        const recentMessages = recent[channel];
        const activityData = activity[channel];
        const { n, avg, sortedActivities } = activityData;
        let activityNum = 0;
        let recentMessagesNow = [];

        if (recentMessages.length > 0) {
            // const messagePointerNow = ++messagePointer;
            const numMessages = recentMessages.length;
            const cutoffStamp = +new Date() - windowMs;

            let firstMessageIdx = numMessages;
            for (let i = 0; i < numMessages; i++) {
                if (recentMessages[i].timestamp >= cutoffStamp) { // Include if message is on cutoff time
                    firstMessageIdx = i;
                    break;
                }
            }

            recent[channel] = recentMessages.slice(firstMessageIdx);
            recentMessagesNow = recentMessages;
            activityNum = recentMessagesNow.length / windowSeconds;

            if (activityNum > 0 && canStart) {
                const newN = n + 1;
                activityData.n = newN;
                activityData.avg = avg * (n / newN) + activityNum / newN;
                if (activityNum > activityData.peak) activityData.peak = activityNum;
                if (activityNum < activityData.min) activityData.min = activityNum;

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

                if (+new Date() - startTick > waitForDataWindow) {
                    const hypeActivityIdx = Math.ceil((sortedActivities.length - 1) * hypePercent);
                    const isHype = activityNum >= sortedActivities[hypeActivityIdx];
                    if (!hypeActive && isHype) {
                        hypeActive = true;
                        log('channel', channel, `Hype detected (over ${sortedActivities[hypeActivityIdx]})!`);
                    } else if (hypeActive && !isHype) {
                        hypeActive = false;
                        log('channel', channel, '...hype ended');
                    }
                }
            }
        }

        if (activityNum > 0) {
            log(
                'channel', channel,
                '| hype', hypeActive,
                '| activityNum', activityNum,
                '| n', activityData.n,
                '| min', activityData.min,
                '| avg', activityData.avg,
                '| peak', activityData.peak
            );
        }
    }
}, intervalFreq);

log('Events ready!');
