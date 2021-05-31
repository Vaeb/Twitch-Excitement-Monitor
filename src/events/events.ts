import { chatClient } from '../twitchSetup';
import { channels } from '../channels';
import type { ChannelName } from '../channels';
import { commands } from '../commandSetup';
import { log } from '../utils';

log('| Setting up events...');

chatClient.onMessage((channelIrc, user, message) => {
    const channelName = channelIrc.substring(1) as ChannelName;
    channels[channelName].onNewMessage(channelIrc, user, message);

    if (!['vaeben', 'morlega'].includes(user)) return;

    const [messageCmd, ...messageArgs] = message.trim().split(/\s+/g);

    const command = commands.find(({ cmds }) => cmds[messageCmd]);

    // console.log(command, messageCmd, message);

    if (!command) return;

    log(user, 'sent command', `'${command.name}'`, 'in', `'${channelIrc}'`, ...(messageArgs.length ? ['with args', messageArgs] : []), `('${message}')`);

    command.func({
        channelName,
        user,
        rawMessage: message,
        cmdArgs: messageArgs,
    });
});

// Check for sub-mode + emote-mode + slow-mode + follower-x-mode

log('Events ready!');
