#!/usr/bin/env node

import { AppContext, AppContextError } from "./config";
import { WebhookECS } from "./services";

try {
    const appContext = new AppContext({
        appConfigFileKey: 'APP_CONFIG',
    });

    new WebhookECS(appContext, appContext.appConfig.Stack.VpcInfra);
} catch (error) {
    if (error instanceof AppContextError) {
        console.error('[AppContextError]:', error.message);
    } else {
        console.error('[Error]: not-handled-error', error);
    }
}
