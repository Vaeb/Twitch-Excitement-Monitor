import type { CommandRaw } from '../../commandSetup';
import { log, chat } from '../../utils';

export const command: CommandRaw = {
    cmds: ['ping'],
    desc: 'Check the application status',
    params: [],
    func: async ({ channelName }) => {
        chat(channelName, 'LUL');
        log('Pinged!');
    },
};
