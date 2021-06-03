import type { CommandRaw } from '../../commandSetup';
import { chat, isRoot } from '../../utils';
import { ActivityMixed } from '../../models';
import { channels } from '../../channels';
import type { ChannelName } from '../../channels';

export const command: CommandRaw = {
    cmds: ['clearactivity'],
    desc: "Clear a channel's activity data",
    params: ['channel_name'],
    func: async ({ channelName, user, cmdArgs }) => {
        if (!isRoot(user)) return;
        if (cmdArgs.length < 1) return;

        const channelNameUse = cmdArgs[0] as ChannelName;

        chat(channelName, `Clearing all activity data for channel ${channelNameUse}...`);

        ActivityMixed.deleteMany({ channelName: channelNameUse })
            .then(() => {
                chat(channelName, 'Cleared activity data.');
                const channelUse = channels[channelNameUse];
                channelUse.fetchHypeThreshold();
            })
            .catch((err) => {
                chat(channelName, 'Clear errored:', err);
            });
    },
};
