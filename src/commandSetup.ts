import path from 'path';
import glob from 'glob';

import './twitchSetup';
import { log } from './utilsSetup';

log('| Setting up commands...');

export interface CommandFuncParams {
    channel: string;
    user: string;
    rawMessage: string;
    cmdArgs: string[];
}

export interface CommandRaw {
    name?: string;
    cmds: string[];
    desc?: string;
    params: string[];
    func: (params: CommandFuncParams) => any;
}

export interface Command {
    name: string;
    cmds: { [key: string]: boolean };
    desc: string;
    params: string[];
    func: (params: CommandFuncParams) => any;
}

export const commands: Command[] = [];
const prefix = '';

await Promise.all(glob.sync('./dist/events/commands/**/*.js').map(async (file) => {
    const filePath = `./${path.relative('./dist', file)}`.replace(/\\/g, '/');

    log('Importing:', filePath);

    const { command }: { command: CommandRaw } = await import(filePath);

    if (!command) {
        log('Command data not found:', file);
        return;
    }

    const newCommand = {} as Command;
    newCommand.name = command.name ?? command.cmds[0];
    newCommand.cmds = Object.assign({}, ...command.cmds.map((cmd: string) => ({ [`${prefix}${cmd.toLowerCase()}`]: true })));
    newCommand.desc = command.desc ?? 'Command description not provided';
    newCommand.params = command.params;
    newCommand.func = command.func;

    commands.push(newCommand);

    log('Added command:', newCommand.name);
}));

log('Commands ready!');
