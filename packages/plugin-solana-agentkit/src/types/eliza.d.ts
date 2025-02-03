import type { Service } from "@elizaos/core";

export interface TwitterClient extends Service {
    getTrends(): Promise<Array<{ name: string }>>;
}

declare module "@elizaos/core" {
    interface ServiceTypeMap {
        TWITTER_CLIENT: TwitterClient;
    }
}

export type HandlerCallback = (response: {
    text: string;
    content: any;
}) => void;
