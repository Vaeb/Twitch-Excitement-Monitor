import util from 'util';
import type { HelixUser, HelixVideo } from 'twitch';

import { apiClient, chatClient } from './twitchSetup';
import { log } from './utilsSetup';

export * from './utilsSetup';

export const hiddenSpace = '︀';

export const round = (num: number, inc: number): number => (inc == 0 ? num : Math.floor(num / inc + 0.5) * inc);

export const toFixedCut = (num: number, decimals: number): string => Number(num.toFixed(decimals)).toString();

export const formatElapsed = (time: number): string => {
    let timeStr;
    let formatStr;

    const numSeconds = round(time / 1000, 0.1);
    const numMinutes = round(time / (1000 * 60), 0.1);
    const numHours = round(time / (1000 * 60 * 60), 0.1);
    const numDays = round(time / (1000 * 60 * 60 * 24), 0.1);
    const numWeeks = round(time / (1000 * 60 * 60 * 24 * 7), 0.1);
    const numMonths = round(time / (1000 * 60 * 60 * 24 * 30.42), 0.1);
    const numYears = round(time / (1000 * 60 * 60 * 24 * 365.2422), 0.1);

    if (numSeconds < 1) {
        timeStr = toFixedCut(time, 0);
        formatStr = `${timeStr} millisecond`;
    } else if (numMinutes < 1) {
        timeStr = toFixedCut(numSeconds, 1);
        formatStr = `${timeStr} second`;
    } else if (numHours < 1) {
        timeStr = toFixedCut(numMinutes, 1);
        formatStr = `${timeStr} minute`;
    } else if (numDays < 1) {
        timeStr = toFixedCut(numHours, 1);
        formatStr = `${timeStr} hour`;
    } else if (numWeeks < 1) {
        timeStr = toFixedCut(numDays, 1);
        formatStr = `${timeStr} day`;
    } else if (numMonths < 1) {
        timeStr = toFixedCut(numWeeks, 1);
        formatStr = `${timeStr} week`;
    } else if (numYears < 1) {
        timeStr = toFixedCut(numMonths, 1);
        formatStr = `${timeStr} month`;
    } else {
        timeStr = toFixedCut(numYears, 1);
        formatStr = `${timeStr} year`;
    }

    if (timeStr !== '1') formatStr += 's';

    return formatStr;
};

export const formatTime = (date: Date, useTwitchSymbols = false): string => {
    const hours = `0${date.getUTCHours()}`.substr(-2);
    const minutes = `0${date.getMinutes()}`.substr(-2);
    const seconds = `0${date.getSeconds()}`.substr(-2);
    const formattedTime = `${hours}${useTwitchSymbols ? 'h' : ':'}${minutes}${useTwitchSymbols ? 'm' : ':'}${seconds}${useTwitchSymbols ? 's' : ''}`;
    return formattedTime;
};

export const chat = (channelName: string, ...messages: any[]): Promise<void> => {
    let message = messages.map(msg => util.format(msg)).join(' ');
    if (message.length > 499) message = `${message.substr(0, 496)}...`;

    log(...messages);
    return chatClient.say(channelName, message);
};

type LookupType = 'name' | 'id';

export const getChannels = async (lookup: string[], lookupType: LookupType = 'name'): Promise<HelixUser[] | null> => {
    let user: HelixUser[] | null = null;
    if (lookupType === 'name') {
        user = await apiClient.helix.users.getUsersByNames(lookup);
    } else if (lookupType === 'id') {
        user = await apiClient.helix.users.getUsersByIds(lookup);
    }
    if (!user) return null;
    return user;
};

export const getChannel = async (lookup: string, lookupType: LookupType = 'name'): Promise<HelixUser | null> => {
    let user: HelixUser | null = null;
    if (lookupType === 'name') {
        user = await apiClient.helix.users.getUserByName(lookup);
    } else if (lookupType === 'id') {
        user = await apiClient.helix.users.getUserById(lookup);
    }
    if (!user) return null;
    return user;
};

export const getChannelId = async (userName: string): Promise<string | null> => {
    const user = await getChannel(userName);
    if (!user) return null;
    return user.id;
};

export const isChannelLive = async (userName: string): Promise<boolean | null> => {
    const user = await apiClient.helix.users.getUserByName(userName);
    if (!user) return null;
    return await user.getStream() !== null;
};

export const isRoot = (channelName: string): boolean => ['vaeben', 'bananaofwild'].includes(channelName);

export const isAdmin = (channelName: string): boolean => ['vaeben', 'bananaofwild', 'morlega'].includes(channelName);

export const getLatestVod = async (userId: string): Promise<HelixVideo | null> => {
    const vod = (await apiClient.helix.videos.getVideosByUser(userId, { limit: '1', type: 'archive', orderBy: 'time' })).data[0];
    if (!vod) return null;
    return vod;
};
