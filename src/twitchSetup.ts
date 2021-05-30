import { promises as fs } from 'fs';
import { RefreshableAuthProvider, StaticAuthProvider } from 'twitch-auth';
import { ChatClient } from 'twitch-chat-client';

console.log('Setting up twitch client...');

interface AuthData {
    clientId: string;
    clientId2: string;
    clientSecret: string;
    accessToken: string;
    expiryTimestamp: number;
    refreshToken: string;
}

const fetchAuth = async (): Promise<AuthData> => JSON.parse(String(await fs.readFile('./src/auth.json', 'utf-8')));

const authData = await fetchAuth();
const auth = new RefreshableAuthProvider(
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

            console.log('>>> Refreshing to:', accessToken, refreshToken, expiryDate);
            await fs.writeFile('./src/auth.json', JSON.stringify(authDataNew, null, 4), 'utf-8');
        },
    }
);

export const chatClient = new ChatClient(auth, { channels: ['vaeben'] });
await chatClient.connect();

console.log('Twitch client connected!');
