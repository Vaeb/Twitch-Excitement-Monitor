import util from 'util';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

export const forwardSlashes = (strPath: string): string => strPath.replace(/\\/g, '/');

export const getDirName = (meta: any): { __filename: string, __dirname: string } => {
    const __filename = forwardSlashes(fileURLToPath(meta.url));
    const __dirname = forwardSlashes(dirname(__filename));
    return { __filename, __dirname };
};

export const tzOffset = 1000 * 60 * -60;

export const getDateUk = (date = new Date()): Date => new Date(date.getTime() - tzOffset);

export const getDateString = (date = new Date()): string => {
    const iso = getDateUk(date).toISOString();
    return `${iso.substr(0, 10)} ${iso.substr(11, 8)}`;
};

export const makeLogMessage = (...messages: any[]): string => {
    let logMessage = messages.map(msg => util.format(msg)).join(' ');

    const dateString = getDateString();
    if (logMessage[0] === '\n') {
        const startingLines = (logMessage.match(/^\n+/) || [])[0];
        logMessage = `${startingLines}[${dateString}] ${logMessage.substring(startingLines.length)}`;
    } else {
        logMessage = `[${dateString}] ${logMessage}`;
    }

    return logMessage;
};

export const log = (...messages: any[]): void => {
    console.log(makeLogMessage(...messages));
};
