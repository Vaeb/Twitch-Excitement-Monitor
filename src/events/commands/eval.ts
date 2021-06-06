/* eslint-disable @typescript-eslint/no-unused-expressions */

import util from 'util';
import childProcess from 'child_process';

import type { CommandRaw } from '../../commandSetup';
import * as utils from '../../utils';
import * as twitchSetup from '../../twitchSetup';
import * as channels from '../../channels';

const { format } = util;
const { execFile } = childProcess;
const { log, chat } = utils;
const { apiClient, apiClient2, channelNames, chatClient } = twitchSetup;
const { channels: c } = channels;
const a = apiClient;

const execFileAsync = util.promisify(execFile);

export const command: CommandRaw = {
    cmds: ['eval'],
    desc: 'Test the mongo db is working',
    params: [],

    func: async ({
        channelName, cmdArgs,
    }) => {
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
