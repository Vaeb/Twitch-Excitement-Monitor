import axios from 'axios';

import './models';
import { authData } from './twitchSetup';
import './commandSetup';
import './events/events';
import { log } from './utils';

axios.post(authData.webhook, {
    content: '> Starting twitch-hype-monitor!',
}).catch(err => log(err));

log('| Twitch-Hype-Monitor ready!');
