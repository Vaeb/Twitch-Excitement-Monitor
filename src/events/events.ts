import { chatClient } from '../twitchSetup';
import { channels } from '../channels';
import type { ChannelName } from '../channels';
import { log } from '../utils';

log('| Setting up events...');

chatClient.onMessage((channelIrc, user, message) => {
    const channelName = channelIrc.substring(1) as ChannelName;
    channels[channelName].onNewMessage(channelIrc, user, message, channelName);
});

// Check for sub-mode + emote-mode + slow-mode + follower-x-mode

log('Events ready!');
