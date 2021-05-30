import type { CommandRaw } from '../../commandSetup';
import { log, chat } from '../../utils';

export const command: CommandRaw = {
    cmds: ['ping'],
    desc: 'Check the application status',
    params: [],
    func: async ({ channel }) => {
        chat(channel, 'LUL');
        log('Pinged!');
    },
};
