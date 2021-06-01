import { promises as fs } from 'fs';
import { ApiClient } from 'twitch';
import { RefreshableAuthProvider, StaticAuthProvider, ClientCredentialsAuthProvider } from 'twitch-auth';
import { ChatClient } from 'twitch-chat-client';
import { EventSubListener } from 'twitch-eventsub';
import { NgrokAdapter } from 'twitch-eventsub-ngrok';

import { log } from './utilsSetup';

log('| Setting up twitch client...');

export const channelNames = ['buddha', 'vaeben', 'bananaofwild'] as const;

interface AuthData {
    clientId: string;
    clientId2: string;
    clientSecret: string;
    accessToken: string;
    expiryTimestamp: number;
    refreshToken: string;
    webhook: string;
    randomFixedString: string;
}

const fetchAuth = async (): Promise<AuthData> => JSON.parse(String(await fs.readFile('./src/auth.json', 'utf-8')));

export const authData = await fetchAuth();
const authProvider = new RefreshableAuthProvider(
    new StaticAuthProvider(authData.clientId, authData.accessToken),
    {
        clientSecret: authData.clientSecret,
        refreshToken: authData.refreshToken,
        expiry: authData.expiryTimestamp ? new Date(authData.expiryTimestamp) : null,
        onRefresh: async ({ accessToken, refreshToken, expiryDate }) => {
            const authDataNew = {
                ...authData,
                accessToken,
                refreshToken,
                expiryTimestamp: expiryDate ? expiryDate.getTime() : null,
            };

            log('>>> Refreshing to:', accessToken, refreshToken, expiryDate);
            await fs.writeFile('./src/auth.json', JSON.stringify(authDataNew, null, 4), 'utf-8');
        },
    }
);

const authProvider2 = new ClientCredentialsAuthProvider(authData.clientId, authData.clientSecret);

export const apiClient = new ApiClient({ authProvider });

export const apiClient2 = new ApiClient({ authProvider: authProvider2 });

await apiClient2.helix.eventSub.deleteAllSubscriptions();

export const listener = new EventSubListener(apiClient2, new NgrokAdapter(), authData.randomFixedString);
await listener.listen();

export const chatClient = new ChatClient(authProvider, { channels: [...channelNames] });
await chatClient.connect();

log('Twitch client connected!');
