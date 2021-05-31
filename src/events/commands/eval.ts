/* eslint-disable @typescript-eslint/no-unused-expressions */

import util from 'util';
import childProcess from 'child_process';

import type { CommandRaw } from '../../commandSetup';
import * as utils from '../../utils';
import * as twitchSetup from '../../twitchSetup';

const { format } = util;
const { execFile } = childProcess;
const { log, chat } = utils;

const execFileAsync = util.promisify(execFile);

twitchSetup;

export const command: CommandRaw = {
    cmds: ['eval'],
    desc: 'Test the mongo db is working',
    params: [],

    func: async ({
        channelName, cmdArgs,
    }) => {
        const channels = await import('../../channels'); // Imported in runtime due to module-cycle
        const commands = await import('../../commandSetup');
        // const db = await dbPromise;
        // const dbClips = db.collection('clips');
        const argsFull = cmdArgs.join(' ');
        const send = chat.bind(this, channelName);

        const code = `(async () => {\n${argsFull}\n})()`;

        try {
            const result = await eval(code);

            if (result !== undefined) {
                send(`Output: ${format(result)}`);
            } else {
                log('Undefined output:', result);
            }
        } catch (err) {
            send(`Error: ${format(err)}`);
        }
    },
};
