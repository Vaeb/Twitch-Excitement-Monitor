import type { CommandRaw } from '../../commandSetup';
import { chat } from '../../utils';
import { PercentileActivity } from '../../models';
import { channels } from '../../channels';
import type { ChannelName } from '../../channels';

export const command: CommandRaw = {
    cmds: ['clearactivity'],
    desc: "Clear a channel's activity data",
    params: ['channel_name'],
    func: async ({ channelName, user, cmdArgs }) => {
        if (user !== 'vaeben') return;
        if (cmdArgs.length < 1) return;

        const channelNameUse = cmdArgs[0] as ChannelName;

        chat(channelName, `Clearing all activity data for channel ${channelNameUse}...`);

        PercentileActivity.deleteMany({ channelName: channelNameUse })
            .then(() => {
                chat(channelName, 'Cleared activity data.');
                const channelUse = channels[channelNameUse];
                channelUse.updateHypeThreshold();
            })
            .catch((err) => {
                chat(channelName, 'Clear errored:', err);
            });
    },
};
