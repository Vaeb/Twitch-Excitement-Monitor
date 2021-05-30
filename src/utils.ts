import util from 'util';

import { chatClient } from './twitchSetup';
import { log } from './utilsSetup';

export * from './utilsSetup';

export const chat = (channel: string, ...messages: any[]): Promise<void> => {
    let message = messages.map(msg => util.format(msg)).join(' ');
    if (message.length > 499) message = `${message.substr(0, 496)}...`;

    log(...messages);
    return chatClient.say(channel, message);
};
