import { chatClient, channels } from '../twitchSetup';
import { commands } from '../commandSetup';
import { log } from '../utils';

log('| Setting up events...');

const secondsElapsed = 20;
const timeWindow = 1000 * secondsElapsed;
const recent: any = {};
const activity: any = {};
let isHype = false;
let startTick = Infinity;
let lastMessage = '';
// let messagePointer = 0;

for (const channel of channels) {
    recent[channel] = [];
    activity[channel] = { n: 0, avg: 0, peak: 0 };
}

chatClient.onMessage((channelIrc, user, message) => {
    const messageLower = message.toLowerCase().trim();
    const lastMessageNow = lastMessage;
    lastMessage = messageLower;
    const channel = channelIrc.substring(1);

    if (messageLower !== lastMessageNow) {
        const recentMessages = recent[channel];
        recentMessages.push({ timestamp: +new Date(), message });
    }

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
    if (canStart === false) canStart = +new Date() - startTick >= timeWindow;

    for (const channel of channels) {
        const recentMessages = recent[channel];
        const activityData = activity[channel];
        let activityNum = 0;
        let recentMessagesNow = [];

        if (recentMessages.length > 0) {
            const { n, avg } = activityData;
            // const messagePointerNow = ++messagePointer;
            const numMessages = recentMessages.length;
            const cutoffStamp = +new Date() - timeWindow;

            let firstMessageIdx = numMessages;
            for (let i = 0; i < numMessages; i++) {
                if (recentMessages[i].timestamp >= cutoffStamp) { // Include if message is on cutoff time
                    firstMessageIdx = i;
                    break;
                }
            }

            recent[channel] = recentMessages.slice(firstMessageIdx);
            recentMessagesNow = recentMessages;
            activityNum = recentMessagesNow.length / secondsElapsed;

            if (activityNum > 0 && canStart) {
                const newN = n + 1;
                activityData.n = newN;
                activityData.avg = avg * (n / newN) + activityNum / newN;
                if (activityNum > activityData.peak) activityData.peak = activityNum;
            }
        }

        if (activityNum > 0) console.log('channel', channel, 'activityNum', activityNum, 'n', activityData.n, 'avg', activityData.avg, 'peak', activityData.peak);
    }
}, 1000);

log('Events ready!');
